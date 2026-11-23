import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Busboy from 'busboy'
import Papa from 'papaparse'
import { recordCleansingHistory } from '../../features/cleansing-history'
import { useClickHouse } from '../../utils/clickhouse'

type PipelineId = 'media_humas' | 'peserta_vpl' | 'anggaran_sp2d' | 'course_es'
type EtlAction = 'preview' | 'sync_db'

interface PythonEtlResult {
  status: 'ok' | 'error'
  pipeline: PipelineId
  action: EtlAction
  targetTable?: string
  columns: string[]
  rows: Record<string, unknown>[]
  total_rows: number
  csv_path: string | null
  csv_filename: string | null
  summary: Record<string, unknown>
  message: string
}

const VALID_PIPELINES = new Set<PipelineId>([
  'media_humas',
  'peserta_vpl',
  'anggaran_sp2d',
  'course_es',
])

const VALID_ACTIONS = new Set<EtlAction>(['preview', 'sync_db'])
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_RAW_TEXT_BYTES = 10 * 1024 * 1024
const PYTHON_TIMEOUT_MS = 120_000

const PIPELINE_TARGET_TABLES: Record<PipelineId, string> = {
  media_humas: 'dataset.publikasi_media',
  peserta_vpl: 'db_vpl.vpl_series_atax',
  anggaran_sp2d: 'dataset.anggaran',
  course_es: 'dataset.course_sibangkom',
}

function getSafeTmpDir(): string {
  const configured = (process.env.ETL_TMP_DIR || '').trim()
  return configured ? path.resolve(configured) : path.resolve(os.tmpdir())
}

function makeTempFilePath(prefix: string, ext: string): string {
  const tmpDir = getSafeTmpDir()
  fs.mkdirSync(tmpDir, { recursive: true })
  const safeExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  const filename = `${prefix}_${randomUUID()}${safeExt}`
  const resolved = path.resolve(tmpDir, filename)
  if (!resolved.startsWith(tmpDir + path.sep)) {
    throw createError({ statusCode: 400, message: 'Path file sementara tidak valid.' })
  }
  return resolved
}

function cleanupFileQuietly(filePath: string | null): void {
  if (!filePath) return
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {
    // ignore cleanup error
  }
}

function validateIsoDate(value: string, label: string): string {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw createError({ statusCode: 400, message: `${label} harus berformat YYYY-MM-DD.` })
  }
  const parsed = new Date(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw createError({ statusCode: 400, message: `${label} tidak valid.` })
  }
  return trimmed
}

function readMultipartRequest(event: Parameters<typeof defineEventHandler>[0] extends (e: infer E) => unknown ? E : never): Promise<{
  fields: Record<string, string>
  uploadedFilePath: string | null
  uploadedOriginalName: string | null
}> {
  return new Promise((resolve, reject) => {
    const req = event.node.req
    const headers = req.headers
    const fields: Record<string, string> = {}
    let uploadedFilePath: string | null = null
    let uploadedOriginalName: string | null = null
    let fileLimitExceeded = false
    let fileWritePromise: Promise<void> | null = null
    let settled = false

    const fail = (err: Error) => {
      if (settled) return
      settled = true
      cleanupFileQuietly(uploadedFilePath)
      reject(err)
    }

    let busboy: ReturnType<typeof Busboy>
    try {
      busboy = Busboy({
        headers,
        limits: {
          files: 1,
          fileSize: MAX_UPLOAD_BYTES,
          fields: 20,
          fieldSize: MAX_RAW_TEXT_BYTES,
        },
      })
    } catch {
      reject(createError({ statusCode: 400, message: 'Header multipart/form-data tidak valid.' }))
      return
    }

    busboy.on('field', (name, value) => {
      fields[name] = value
    })

    busboy.on('file', (_fieldname, stream, info) => {
      const originalName = info?.filename || 'upload.bin'
      const ext = path.extname(originalName).toLowerCase()
      if (!['.xlsx', '.txt', '.csv'].includes(ext)) {
        stream.resume()
        fail(createError({ statusCode: 400, message: `Ekstensi file tidak diizinkan (${ext || 'kosong'}). Gunakan .xlsx atau .txt.` }))
        return
      }
      uploadedOriginalName = originalName
      const destPath = makeTempFilePath('etl_upload', ext)
      uploadedFilePath = destPath
      const writeStream = fs.createWriteStream(destPath)

      stream.on('limit', () => {
        fileLimitExceeded = true
        writeStream.destroy()
        stream.resume()
      })

      fileWritePromise = new Promise<void>((resWrite, rejWrite) => {
        writeStream.on('finish', () => resWrite())
        writeStream.on('error', (err) => rejWrite(err))
        stream.on('error', (err) => rejWrite(err))
      })

      stream.pipe(writeStream)
    })

    busboy.on('error', (err) => {
      fail(createError({ statusCode: 400, message: err instanceof Error ? err.message : 'Gagal membaca form upload.' }))
    })

    busboy.on('finish', async () => {
      if (settled) return
      try {
        if (fileWritePromise) {
          await fileWritePromise
        }
        if (fileLimitExceeded) {
          fail(createError({ statusCode: 413, message: 'Ukuran file melebihi batas maksimal 50 MB.' }))
          return
        }
        settled = true
        resolve({ fields, uploadedFilePath, uploadedOriginalName })
      } catch (err) {
        fail(createError({ statusCode: 400, message: err instanceof Error ? err.message : 'Gagal menyimpan file upload.' }))
      }
    })

    req.pipe(busboy)
  })
}

function runPythonRunner(
  pythonBin: string,
  args: string[],
  envVars: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const runnerPath = path.resolve(process.cwd(), 'python-etl', 'runner.py')
    if (!fs.existsSync(runnerPath)) {
      reject(createError({ statusCode: 500, message: 'Skrip python-etl/runner.py tidak ditemukan di server.' }))
      return
    }

    const child = spawn(pythonBin, [runnerPath, ...args], {
      cwd: process.cwd(),
      shell: false,
      env: {
        ...process.env,
        ...envVars,
      },
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, PYTHON_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(createError({ statusCode: 500, message: `Gagal menjalankan proses Python (${pythonBin}): ${err.message}` }))
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(createError({ statusCode: 504, message: 'Proses pipeline Python melebihi batas waktu (120 detik).' }))
        return
      }
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      })
    })
  })
}

function jsUrlKey(rawUrl: string): string {
  let clean = String(rawUrl || '').trim()
  const matches = [...clean.matchAll(/https?:\/\//gi)]
  if (matches.length > 1) {
    const last = matches[matches.length - 1]
    if (last && typeof last.index === 'number') clean = clean.slice(last.index)
  }
  try {
    const u = new URL(clean)
    const params = new URLSearchParams()
    for (const [k, v] of u.searchParams.entries()) {
      const kl = k.toLowerCase()
      if (!kl.startsWith('utm_') && kl !== 'fbclid' && kl !== 'igshid') {
        params.append(k, v)
      }
    }
    const host = u.host.toLowerCase().replace(/^www\./, '')
    const normPath = u.pathname.replace(/\/+$/, '').replace(/^\/amp(?=\/)|\/amp$/i, '')
    const qs = params.toString()
    return qs ? `${host}${normPath}?${qs}` : `${host}${normPath}`
  } catch {
    return clean.toLowerCase()
  }
}

function toMockCsvWithNames(columns: string[], rows: Record<string, unknown>[]): string {
  const data = rows.map((row) => columns.map((col) => {
    const val = row[col]
    return val === null || val === undefined ? '\\N' : val
  }))
  return Papa.unparse({ fields: columns, data })
}

async function syncRowsToMockClickHouse(
  pipeline: PipelineId,
  result: PythonEtlResult,
): Promise<PythonEtlResult> {
  const client = useClickHouse()
  const rows = result.rows || []

  if (pipeline === 'media_humas') {
    await client.command({ query: 'CREATE DATABASE IF NOT EXISTS dataset' })
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS dataset.publikasi_media (
          id UInt64,
          jenis_berita String,
          tanggal_awal Nullable(Date),
          tanggal_akhir Nullable(Date),
          nama_media Nullable(String),
          satker_code Nullable(String),
          judul_berita String,
          tautan_berita String,
          raw Nullable(String),
          link_media Nullable(String)
        ) ENGINE = MergeTree ORDER BY id
      `,
    })

    let existingRows: Array<{ id?: number; tautan_berita?: string }> = []
    try {
      const q = await client.query({
        query: 'SELECT id, tautan_berita FROM dataset.publikasi_media',
        format: 'JSONEachRow',
      })
      existingRows = await q.json<Array<{ id?: number; tautan_berita?: string }>>()
    } catch {
      existingRows = []
    }

    const existingKeys = new Set(existingRows.map((r) => jsUrlKey(String(r.tautan_berita || ''))).filter(Boolean))
    let maxId = existingRows.reduce((acc, r) => Math.max(acc, Number(r.id || 0)), 0)
    const seenBatch = new Set<string>()
    const newRecords: Record<string, unknown>[] = []

    for (const row of rows) {
      const key = jsUrlKey(String(row['TAUTAN BERITA'] || ''))
      if (!key || existingKeys.has(key) || seenBatch.has(key)) continue
      seenBatch.add(key)
      maxId += 1
      newRecords.push({ ...row, ID: maxId })
    }

    if (newRecords.length > 0) {
      const cols = ['id', 'jenis_berita', 'tanggal_awal', 'tanggal_akhir', 'nama_media', 'satker_code', 'judul_berita', 'tautan_berita', 'raw', 'link_media']
      const mappedRows = newRecords.map((r) => ({
        id: Number(r.ID),
        jenis_berita: String(r['JENIS BERITA'] ?? ''),
        tanggal_awal: r['TANGGAL AWAL'] ?? null,
        tanggal_akhir: r['TANGGAL AKHIR'] ?? null,
        nama_media: r['NAMA MEDIA'] ?? null,
        satker_code: r.SATKER_CODE ?? null,
        judul_berita: String(r['JUDUL BERITA'] ?? ''),
        tautan_berita: String(r['TAUTAN BERITA'] ?? ''),
        raw: r.RAW ?? null,
        link_media: r['LINK MEDIA'] ?? null,
      }))

      await client.insert({
        table: 'dataset.publikasi_media',
        values: toMockCsvWithNames(cols, mappedRows),
        format: 'CSVWithNames',
        columns: cols,
      })
    }

    const skipped = rows.length - newRecords.length
    return {
      ...result,
      action: 'sync_db',
      rows: newRecords,
      total_rows: newRecords.length,
      summary: {
        ...result.summary,
        inserted_count: newRecords.length,
        skipped_duplicate_count: skipped,
      },
      message: newRecords.length > 0
        ? `Berhasil menambahkan ${newRecords.length} berita baru ke dataset.publikasi_media.`
        : `Tidak ada URL baru; seluruh tautan (${rows.length} baris) sudah ada di dataset.publikasi_media.`,
    }
  }

  if (pipeline === 'peserta_vpl') {
    await client.command({ query: 'CREATE DATABASE IF NOT EXISTS db_vpl' })
    await client.command({ query: 'DROP TABLE IF EXISTS db_vpl.vpl_series_atax' })
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS db_vpl.vpl_series_atax (
          id UInt64,
          series_vpl Nullable(String),
          nama_peserta Nullable(String),
          email Nullable(String),
          jenis_kelamin Nullable(String),
          jabatan_raw Nullable(String),
          instansi_raw Nullable(String),
          jenis_instansi Nullable(String),
          asal_daerah Nullable(String),
          jabatan_clean Nullable(String),
          instansi_clean Nullable(String),
          tanggal_webinar Nullable(Date),
          judul_webinar Nullable(String),
          tahun_kegiatan UInt16
        ) ENGINE = MergeTree ORDER BY id
      `,
    })

    if (rows.length > 0) {
      const cols = result.columns
      await client.insert({
        table: 'db_vpl.vpl_series_atax',
        values: toMockCsvWithNames(cols, rows),
        format: 'CSVWithNames',
        columns: cols,
      })
    }

    return {
      ...result,
      action: 'sync_db',
      message: `Berhasil menjalankan TRUNCATE + INSERT ${rows.length} baris peserta VPL ke db_vpl.vpl_series_atax.`,
    }
  }

  if (pipeline === 'anggaran_sp2d') {
    await client.command({ query: 'CREATE DATABASE IF NOT EXISTS dataset' })
    await client.command({
      query: `
        CREATE TABLE IF NOT EXISTS dataset.anggaran (
          satker_lan String,
          tahun String,
          disagregasi String,
          klasifikasi String,
          alias String,
          pagu_anggaran String,
          sp2d_span String,
          sisa_dana String,
          persen_realisasi Float64,
          id UInt64
        ) ENGINE = MergeTree ORDER BY id
      `,
    })

    let maxId = 0
    let beforeCount = 0
    try {
      const q = await client.query({
        query: 'SELECT count() AS cnt, max(id) AS max_id FROM dataset.anggaran',
        format: 'JSONEachRow',
      })
      const agg = await q.json<Array<{ cnt?: number; max_id?: number }>>()
      beforeCount = Number(agg[0]?.cnt || 0)
      maxId = Number(agg[0]?.max_id || 0)
    } catch {
      beforeCount = 0
      maxId = 0
    }

    const numbered = rows.map((r, idx) => ({ ...r, id: maxId + 1 + idx }))
    if (numbered.length > 0) {
      const cols = result.columns
      await client.insert({
        table: 'dataset.anggaran',
        values: toMockCsvWithNames(cols, numbered),
        format: 'CSVWithNames',
        columns: cols,
      })
    }

    const afterCount = beforeCount + numbered.length
    return {
      ...result,
      action: 'sync_db',
      rows: numbered,
      total_rows: numbered.length,
      summary: {
        ...result.summary,
        id_start: numbered.length ? numbered[0]?.id : null,
        id_end: numbered.length ? numbered[numbered.length - 1]?.id : null,
        table_rows_before: beforeCount,
        table_rows_after: afterCount,
      },
      message: `Berhasil APPEND INSERT ${numbered.length} baris ke dataset.anggaran (ID ${maxId + 1} - ${maxId + numbered.length}). Total baris tabel sekarang: ${afterCount}.`,
    }
  }

  // course_es
  await client.command({ query: 'CREATE DATABASE IF NOT EXISTS dataset' })
  const sanitizedCols = (result.columns || []).map((c) => c.replace(/[^A-Za-z0-9_]/g, '_'))
  if (sanitizedCols.length > 0) {
    const colDefs = sanitizedCols.map((c) => (c === 'uuid' ? `\`${c}\` String` : `\`${c}\` Nullable(String)`)).join(', ')
    const orderByCol = sanitizedCols.includes('uuid') ? 'uuid' : sanitizedCols[0]
    await client.command({
      query: `CREATE TABLE IF NOT EXISTS dataset.course_sibangkom (${colDefs}) ENGINE = MergeTree ORDER BY \`${orderByCol}\``,
    })
    if (rows.length > 0) {
      const mappedRows = rows.map((r) => {
        const obj: Record<string, string | null> = {}
        for (const origCol of result.columns) {
          const safe = origCol.replace(/[^A-Za-z0-9_]/g, '_')
          const v = r[origCol]
          obj[safe] = v === null || v === undefined ? null : String(v)
        }
        return obj
      })
      await client.insert({
        table: 'dataset.course_sibangkom',
        values: toMockCsvWithNames(sanitizedCols, mappedRows),
        format: 'CSVWithNames',
        columns: sanitizedCols,
      })
    }
  }

  return {
    ...result,
    action: 'sync_db',
    summary: { ...result.summary, inserted_count: rows.length },
    message: `Berhasil menyinkronkan ${rows.length} dokumen Course Elasticsearch ke dataset.course_sibangkom.`,
  }
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  const config = useRuntimeConfig()
  const tempFiles: string[] = []

  let pipeline: PipelineId | null = null
  let action: EtlAction = 'preview'

  try {
    const contentType = String(getHeader(event, 'content-type') || '').toLowerCase()
    let fields: Record<string, string> = {}
    let uploadedFilePath: string | null = null

    if (contentType.includes('multipart/form-data')) {
      const parsed = await readMultipartRequest(event)
      fields = parsed.fields
      uploadedFilePath = parsed.uploadedFilePath
      if (uploadedFilePath) tempFiles.push(uploadedFilePath)
    } else {
      const body = await readBody<Record<string, unknown>>(event).catch(() => null)
      if (!body || typeof body !== 'object') {
        throw createError({ statusCode: 400, message: 'Payload permintaan ETL tidak valid.' })
      }
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined && v !== null) {
          fields[k] = String(v)
        }
      }
    }

    const rawPipeline = (fields.pipeline || '').trim() as PipelineId
    if (!VALID_PIPELINES.has(rawPipeline)) {
      throw createError({ statusCode: 400, message: 'Pipeline ETL tidak dikenali.' })
    }
    pipeline = rawPipeline

    const rawAction = ((fields.action || 'preview').trim() || 'preview') as EtlAction
    if (!VALID_ACTIONS.has(rawAction)) {
      throw createError({ statusCode: 400, message: 'Aksi ETL tidak valid (gunakan preview atau sync_db).' })
    }
    action = rawAction

    const hasRealClickHouse = Boolean(config.clickhouseUrl && String(config.clickhouseUrl).trim())
    const pythonAction: EtlAction = action === 'sync_db' && hasRealClickHouse ? 'sync_db' : 'preview'

    const args: string[] = ['--pipeline', pipeline, '--action', pythonAction]

    if (pipeline === 'media_humas') {
      const rawText = fields.rawText || ''
      if (Buffer.byteLength(rawText, 'utf8') > MAX_RAW_TEXT_BYTES) {
        throw createError({ statusCode: 413, message: 'Teks broadcast WA melebihi batas maksimal 10 MB.' })
      }
      if (uploadedFilePath) {
        const ext = path.extname(uploadedFilePath).toLowerCase()
        if (ext !== '.txt') {
          throw createError({ statusCode: 400, message: 'Pipeline Publikasi Media Humas hanya menerima file .txt.' })
        }
        args.push('--input-path', uploadedFilePath)
      } else if (rawText.trim()) {
        const textPath = makeTempFilePath('etl_wa', '.txt')
        tempFiles.push(textPath)
        fs.writeFileSync(textPath, rawText, 'utf8')
        args.push('--raw-text-file', textPath)
      } else {
        throw createError({ statusCode: 400, message: 'Masukkan teks rekap broadcast WA atau unggah file .txt.' })
      }
    } else if (pipeline === 'peserta_vpl' || pipeline === 'anggaran_sp2d') {
      if (!uploadedFilePath) {
        throw createError({ statusCode: 400, message: 'Unggah file Excel (.xlsx) terlebih dahulu.' })
      }
      if (path.extname(uploadedFilePath).toLowerCase() !== '.xlsx') {
        throw createError({ statusCode: 400, message: 'Pipeline ini hanya menerima file Excel (.xlsx).' })
      }
      args.push('--input-path', uploadedFilePath)
      if (pipeline === 'anggaran_sp2d' && fields.tanggalRealisasi && fields.tanggalRealisasi.trim()) {
        const tgl = validateIsoDate(fields.tanggalRealisasi, 'Tanggal realisasi')
        args.push('--tanggal-realisasi', tgl)
      }
    } else if (pipeline === 'course_es') {
      if (!fields.startDate || !fields.endDate) {
        throw createError({ statusCode: 400, message: 'Dari Tanggal dan Sampai Tanggal wajib diisi.' })
      }
      const startDate = validateIsoDate(fields.startDate, 'Dari Tanggal')
      const endDate = validateIsoDate(fields.endDate, 'Sampai Tanggal')
      if (startDate > endDate) {
        throw createError({ statusCode: 400, message: 'Dari Tanggal tidak boleh lebih besar dari Sampai Tanggal.' })
      }
      args.push('--start-date', startDate, '--end-date', endDate)
    }

    const pythonBin = String(config.pythonBin || process.env.PYTHON_BIN || 'python3').trim() || 'python3'
    const envVars: Record<string, string> = {
      ETL_TMP_DIR: getSafeTmpDir(),
      NUXT_CLICKHOUSE_URL: String(config.clickhouseUrl || process.env.NUXT_CLICKHOUSE_URL || ''),
      NUXT_CLICKHOUSE_USER: String(config.clickhouseUser || process.env.NUXT_CLICKHOUSE_USER || ''),
      NUXT_CLICKHOUSE_PASSWORD: String(config.clickhousePassword || process.env.NUXT_CLICKHOUSE_PASSWORD || ''),
      ELASTICSEARCH_URL: String(config.elasticsearchUrl || process.env.ELASTICSEARCH_URL || ''),
      ELASTICSEARCH_USER: String(config.elasticsearchUser || process.env.ELASTICSEARCH_USER || ''),
      ELASTICSEARCH_PASSWORD: String(config.elasticsearchPassword || process.env.ELASTICSEARCH_PASSWORD || ''),
    }

    const proc = await runPythonRunner(pythonBin, args, envVars)

    let parsedOutput: PythonEtlResult | null = null
    try {
      parsedOutput = JSON.parse(proc.stdout) as PythonEtlResult
    } catch {
      parsedOutput = null
    }

    if (!parsedOutput || proc.exitCode !== 0 || parsedOutput.status !== 'ok') {
      const errMsg = parsedOutput?.message
        || proc.stderr.trim().split('\n').pop()
        || 'Eksekusi pipeline Python gagal.'
      throw createError({
        statusCode: 422,
        statusMessage: 'Pipeline ETL gagal',
        message: errMsg,
      })
    }

    if (action === 'sync_db' && !hasRealClickHouse) {
      parsedOutput = await syncRowsToMockClickHouse(pipeline, parsedOutput)
    }

    if (action === 'sync_db') {
      try {
        const target = parsedOutput.targetTable || PIPELINE_TARGET_TABLES[pipeline]
        const [targetDb, targetTbl] = target.split('.')
        await recordCleansingHistory(useClickHouse(), {
          featureId: `etl_${pipeline}`,
          sourceDatabase: targetDb || 'etl',
          sourceTable: pipeline,
          resultTable: targetTbl || target,
          parameters: { pipeline, action, summary: parsedOutput.summary },
          sourceRows: parsedOutput.total_rows,
          filledRows: parsedOutput.total_rows,
          ambiguousRows: 0,
          durationMs: Date.now() - startedAt,
          status: 'sukses',
          message: parsedOutput.message,
          startedAt,
        })
      } catch {
        // best-effort logging
      }
    }

    const downloadToken = parsedOutput.csv_path ? path.basename(parsedOutput.csv_path) : null

    return {
      status: parsedOutput.status,
      pipeline: parsedOutput.pipeline,
      action: parsedOutput.action,
      targetTable: parsedOutput.targetTable || PIPELINE_TARGET_TABLES[pipeline],
      columns: parsedOutput.columns,
      rows: parsedOutput.rows,
      total_rows: parsedOutput.total_rows,
      csv_filename: parsedOutput.csv_filename,
      download_token: downloadToken,
      summary: parsedOutput.summary,
      message: parsedOutput.message,
    }
  } finally {
    for (const file of tempFiles) {
      cleanupFileQuietly(file)
    }
  }
})
