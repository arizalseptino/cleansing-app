import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import busboy from 'busboy'
import type { H3Event } from 'h3'
import Papa from 'papaparse'
import type { useClickHouse } from '../utils/clickhouse'
import { validateDatabase } from './metadata'

export const MAX_TEXT_BYTES = 2 * 1024 * 1024
export const MAX_COLUMNS = 200
export const PREVIEW_ROW_LIMIT = 20
export const BATCH_MAX_BYTES = 4 * 1024 * 1024
export const BATCH_MAX_ROWS = 20_000
export const STREAM_CHUNK_BYTES = 64 * 1024
const STAGED_UPLOAD_TTL_MS = 30 * 60 * 1000

export const ALLOWED_EXTENSIONS = new Set(['.csv', '.tsv', '.txt'])
export const SUPPORTED_DELIMITERS = [',', ';', '\t', '|'] as const
export type SupportedDelimiter = (typeof SUPPORTED_DELIMITERS)[number]

export const NEW_TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
export const COLUMN_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export type IngestMode = 'file' | 'text'

export type IngestRequestPayload =
  | {
      mode: 'file'
      sourceLabel: string
      filePath: string
      stagedUploadId: string | null
      ownsTempFile: boolean
      delimiterOption: string
      targetDatabase: string
      tableName: string
      columns: string[] | null
    }
  | {
      mode: 'text'
      sourceLabel: string
      textNoBom: string
      rawBufferNoBom: Buffer
      delimiterOption: string
      targetDatabase: string
      tableName: string
      columns: string[] | null
    }

export type CsvInspectionResult = {
  delimiter: SupportedDelimiter
  detectedDelimiter: SupportedDelimiter
  rawHeaders: string[]
  suggestedColumns: string[]
  previewRows: string[][]
  rowCount: number
  columnCount: number
}

type StagedUploadEntry = {
  id: string
  filePath: string
  sourceLabel: string
  createdAt: number
  lastAccessedAt: number
}

const stagedUploads = new Map<string, StagedUploadEntry>()

function safeUnlink(filePath: string): void {
  fs.promises.unlink(filePath).catch(() => {})
}

function pruneExpiredStagedUploads(): void {
  const cutoff = Date.now() - STAGED_UPLOAD_TTL_MS
  for (const [id, entry] of stagedUploads.entries()) {
    if (entry.lastAccessedAt < cutoff) {
      stagedUploads.delete(id)
      safeUnlink(entry.filePath)
    }
  }
}

const pruneTimer = setInterval(pruneExpiredStagedUploads, 5 * 60 * 1000)
pruneTimer.unref()

export function registerStagedUpload(filePath: string, sourceLabel: string): string {
  pruneExpiredStagedUploads()
  const id = randomUUID()
  const now = Date.now()
  stagedUploads.set(id, {
    id,
    filePath,
    sourceLabel,
    createdAt: now,
    lastAccessedAt: now,
  })
  return id
}

export function getStagedUpload(uploadId: string): { filePath: string; sourceLabel: string } | null {
  pruneExpiredStagedUploads()
  const entry = stagedUploads.get(uploadId)
  if (!entry) return null
  if (!fs.existsSync(entry.filePath)) {
    stagedUploads.delete(uploadId)
    return null
  }
  entry.lastAccessedAt = Date.now()
  return {
    filePath: entry.filePath,
    sourceLabel: entry.sourceLabel,
  }
}

export function releaseStagedUpload(uploadId: string): void {
  const entry = stagedUploads.get(uploadId)
  if (!entry) return
  stagedUploads.delete(uploadId)
  safeUnlink(entry.filePath)
}

export function cleanupTempFile(filePath: string): void {
  safeUnlink(filePath)
}

export function ingestError(message: string, statusCode: 400 | 404 | 409 | 413 | 500): never {
  throw createError({
    statusCode,
    statusMessage: message,
    message,
  })
}

export function isHttpError(error: unknown): error is { statusCode: number; message: string } {
  return Boolean(
    error
    && typeof error === 'object'
    && 'statusCode' in error
    && typeof error.statusCode === 'number'
    && 'message' in error
    && typeof error.message === 'string',
  )
}

export function sanitizeSourceLabel(filename: string | undefined): string {
  if (!filename) return 'file_unggah.csv'
  const base = path.basename(filename).replace(/[\u0000-\u001F\u007F]/g, '').trim()
  return (base || 'file_unggah.csv').slice(0, 120)
}

export function validateUploadExtension(filename: string | undefined): void {
  const safeName = sanitizeSourceLabel(filename)
  const ext = path.extname(safeName).toLowerCase()
  if (ext === '.xlsx' || ext === '.xls') {
    ingestError('Format Excel (.xlsx/.xls) belum didukung; gunakan ekspor CSV UTF-8 dari Excel.', 400)
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    ingestError('Ekstensi file tidak didukung. Gunakan file .csv, .tsv, atau .txt.', 400)
  }
}

export function decodePastedText(rawText: string): { textNoBom: string; bufferNoBom: Buffer } {
  const byteSize = Buffer.byteLength(rawText, 'utf8')
  if (byteSize > MAX_TEXT_BYTES) {
    ingestError('Teks yang ditempel melebihi batas maksimal 2 MB.', 413)
  }

  let cleanText = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText
  if (cleanText.includes('\u0000')) {
    ingestError('Teks mengandung karakter biner yang tidak didukung.', 400)
  }

  cleanText = cleanText.replace(/(?:\r?\n)+$/, '')
  if (!cleanText.trim()) {
    ingestError('Teks data wajib diisi.', 400)
  }

  return {
    textNoBom: cleanText,
    bufferNoBom: Buffer.from(cleanText, 'utf8'),
  }
}

export function detectDelimiter(textNoBom: string, filename?: string): SupportedDelimiter {
  const sample = textNoBom.slice(0, 65536)
  const isTsv = filename?.toLowerCase().endsWith('.tsv') ?? false

  let bestDelimiter: SupportedDelimiter = isTsv ? '\t' : ','
  let bestScore = -1

  for (const candidate of SUPPORTED_DELIMITERS) {
    const parsed = Papa.parse<string[]>(sample, {
      delimiter: candidate,
      header: false,
      preview: 25,
      skipEmptyLines: true,
    })
    if (parsed.errors.length > 0 || parsed.data.length === 0) continue

    const colCount = parsed.data[0]?.length ?? 0
    if (colCount <= 1) continue

    const allConsistent = parsed.data.every((row) => row.length === colCount)
    if (!allConsistent) continue

    const tsvBonus = isTsv && candidate === '\t' ? 5 : 0
    const score = colCount * 10 + tsvBonus
    if (score > bestScore) {
      bestScore = score
      bestDelimiter = candidate
    }
  }

  return bestDelimiter
}

export function resolveDelimiter(option: string, textNoBom: string, filename?: string): {
  delimiter: SupportedDelimiter
  detectedDelimiter: SupportedDelimiter
} {
  const detectedDelimiter = detectDelimiter(textNoBom, filename)
  const trimmed = option.trim()
  if (!trimmed || trimmed === 'auto') {
    return { delimiter: detectedDelimiter, detectedDelimiter }
  }
  const normalized = trimmed === '\\t' || trimmed === 'tab' ? '\t' : trimmed
  if ((SUPPORTED_DELIMITERS as readonly string[]).includes(normalized)) {
    return {
      delimiter: normalized as SupportedDelimiter,
      detectedDelimiter,
    }
  }
  ingestError('Pemisah kolom tidak didukung. Pilih koma, titik koma, tab, atau pipa.', 400)
}

export function sanitizeColumnNames(rawHeaders: string[]): string[] {
  const used = new Set<string>()
  return rawHeaders.map((rawHeader, index) => {
    const ascii = rawHeader
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
    let base = ascii
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')

    if (!base) {
      base = `kolom_${index + 1}`
    } else if (/^\d/.test(base)) {
      base = `kolom_${base}`
    }

    base = base.slice(0, 64).replace(/_+$/g, '') || `kolom_${index + 1}`

    let candidate = base
    let suffixNum = 2
    while (used.has(candidate)) {
      const suffix = `_${suffixNum}`
      const truncated = base.slice(0, 64 - suffix.length).replace(/_+$/g, '') || 'kolom'
      candidate = `${truncated}${suffix}`
      suffixNum += 1
    }

    used.add(candidate)
    return candidate
  })
}

export function validateTargetColumns(columns: unknown, expectedCount: number): string[] {
  if (!Array.isArray(columns)) {
    ingestError('Daftar nama kolom hasil wajib dikirim.', 400)
  }
  if (columns.length === 0 || columns.length > MAX_COLUMNS) {
    ingestError(`Jumlah kolom harus antara 1 dan ${MAX_COLUMNS}.`, 400)
  }
  if (columns.length !== expectedCount) {
    ingestError(`Jumlah nama kolom (${columns.length}) tidak sama dengan jumlah kolom data (${expectedCount}).`, 400)
  }

  const seen = new Set<string>()
  const validated: string[] = []

  for (let i = 0; i < columns.length; i += 1) {
    const raw = columns[i]
    if (typeof raw !== 'string') {
      ingestError(`Nama kolom ke-${i + 1} tidak valid.`, 400)
    }
    const name = raw.trim()
    if (!COLUMN_NAME_PATTERN.test(name)) {
      ingestError(
        `Nama kolom ke-${i + 1} ("${name || '(kosong)'}") harus diawali huruf atau garis bawah, hanya berisi huruf, angka, dan garis bawah, maksimal 64 karakter.`,
        400,
      )
    }
    if (seen.has(name)) {
      ingestError(`Nama kolom "${name}" duplikat. Setiap kolom harus memiliki nama yang unik.`, 400)
    }
    seen.add(name)
    validated.push(name)
  }

  return validated
}

export function validateNewTableName(rawName: unknown): string {
  if (typeof rawName !== 'string' || !rawName.trim()) {
    ingestError('Nama tabel baru wajib diisi.', 400)
  }
  const name = rawName.trim()
  if (!NEW_TABLE_NAME_PATTERN.test(name)) {
    ingestError(
      'Nama tabel harus diawali huruf, hanya boleh berisi huruf, angka, dan garis bawah, serta maksimal 64 karakter.',
      400,
    )
  }
  return name
}

export async function ensureTableDoesNotExist(
  client: ReturnType<typeof useClickHouse>,
  database: string,
  tableName: string,
): Promise<void> {
  await validateDatabase(client, database)
  const existing = await client.query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = {database:String} AND name = {table:String}
      LIMIT 1
    `,
    query_params: { database, table: tableName },
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: 1, max_execution_time: 15 },
  })
  const rows = await existing.json<{ name: string }[]>()
  if (rows.length > 0) {
    ingestError('Nama tabel sudah digunakan pada database tersebut. Gunakan nama lain.', 409)
  }
}

export function inspectCsvPayload(
  textNoBom: string,
  delimiterOption: string,
  filename?: string,
): CsvInspectionResult {
  if (!textNoBom.trim()) {
    ingestError('Data CSV kosong dan tidak memiliki baris judul.', 400)
  }

  const { delimiter, detectedDelimiter } = resolveDelimiter(delimiterOption, textNoBom, filename)

  const parsed = Papa.parse<string[]>(textNoBom, {
    delimiter,
    header: false,
    skipEmptyLines: false,
  })

  if (parsed.errors.length > 0) {
    const firstErr = parsed.errors[0]
    const rowLabel = typeof firstErr?.row === 'number' ? ` pada baris ke-${firstErr.row + 1}` : ''
    ingestError(`Format CSV tidak valid${rowLabel}. Periksa tanda kutip atau pemisah kolom.`, 400)
  }

  const rows = parsed.data
  if (rows.length === 0) {
    ingestError('Data CSV kosong dan tidak memiliki baris judul.', 400)
  }

  const rawHeaders = (rows[0] ?? []).map((cell) => String(cell ?? ''))
  if (rawHeaders.length === 0) {
    ingestError('Baris judul tidak memiliki kolom.', 400)
  }
  if (rawHeaders.length > MAX_COLUMNS) {
    ingestError(`Jumlah kolom (${rawHeaders.length}) melebihi batas maksimal ${MAX_COLUMNS} kolom.`, 400)
  }

  const expectedCols = rawHeaders.length
  const dataRows = rows.slice(1)
  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i] ?? []
    if (row.length !== expectedCols) {
      ingestError(
        `Baris data ke-${i + 1} memiliki ${row.length} kolom, seharusnya ${expectedCols} kolom. Periksa pemisah kolom atau baris yang rusak.`,
        400,
      )
    }
  }

  const suggestedColumns = sanitizeColumnNames(rawHeaders)
  const previewRows = dataRows
    .slice(0, PREVIEW_ROW_LIMIT)
    .map((row) => row.map((cell) => String(cell ?? '')))

  return {
    delimiter,
    detectedDelimiter,
    rawHeaders,
    suggestedColumns,
    previewRows,
    rowCount: dataRows.length,
    columnCount: expectedCols,
  }
}

function stripLeadingBomBytes(chunk: Buffer, state: { bomHandled: boolean; bomBuffer: Buffer }): Buffer {
  if (state.bomHandled) return chunk

  const combined = state.bomBuffer.length > 0 ? Buffer.concat([state.bomBuffer, chunk]) : chunk
  if (combined.length < 3) {
    // Only buffer if prefix still matches EF BB BF
    if (
      (combined.length >= 1 && combined[0] !== 0xEF)
      || (combined.length >= 2 && combined[1] !== 0xBB)
    ) {
      state.bomHandled = true
      state.bomBuffer = Buffer.alloc(0)
      return combined
    }
    state.bomBuffer = combined
    return Buffer.alloc(0)
  }

  state.bomHandled = true
  state.bomBuffer = Buffer.alloc(0)
  if (combined[0] === 0xEF && combined[1] === 0xBB && combined[2] === 0xBF) {
    return combined.subarray(3)
  }
  return combined
}

async function readHeadSample(filePath: string, maxBytes = 65536): Promise<string> {
  const fh = await fs.promises.open(filePath, 'r')
  try {
    const buf = Buffer.allocUnsafe(maxBytes)
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0)
    let slice = buf.subarray(0, bytesRead)
    if (slice.length >= 3 && slice[0] === 0xEF && slice[1] === 0xBB && slice[2] === 0xBF) {
      slice = slice.subarray(3)
    }
    // Trim incomplete trailing UTF-8 sequence if cut at 64KB boundary
    let end = slice.length
    if (end > 0) {
      let back = 0
      while (back < 3 && end - 1 - back >= 0 && (slice[end - 1 - back]! & 0xC0) === 0x80) {
        back += 1
      }
      if (end - 1 - back >= 0) {
        const lead = slice[end - 1 - back]!
        let expectedLen = 1
        if ((lead & 0xE0) === 0xC0) expectedLen = 2
        else if ((lead & 0xF0) === 0xE0) expectedLen = 3
        else if ((lead & 0xF8) === 0xF0) expectedLen = 4
        if (back + 1 < expectedLen) {
          end -= back + 1
        }
      }
    }
    slice = slice.subarray(0, end)
    let decoded: string
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(slice)
    } catch {
      ingestError('File harus dikodekan sebagai UTF-8 yang valid.', 400)
    }
    if (decoded.includes('\u0000')) {
      ingestError('Isi data mengandung karakter biner yang tidak didukung.', 400)
    }
    return decoded
  } finally {
    await fh.close()
  }
}

export async function inspectCsvFile(
  filePath: string,
  delimiterOption: string,
  filename?: string,
): Promise<CsvInspectionResult> {
  const stat = await fs.promises.stat(filePath)
  if (stat.size === 0) {
    ingestError('File yang diunggah kosong.', 400)
  }

  const sampleText = await readHeadSample(filePath)
  if (!sampleText.trim()) {
    ingestError('Data CSV kosong dan tidak memiliki baris judul.', 400)
  }

  const { delimiter, detectedDelimiter } = resolveDelimiter(delimiterOption, sampleText, filename)
  const delimByte = delimiter.charCodeAt(0)

  const utf8Decoder = new TextDecoder('utf-8', { fatal: true })
  const bomState = { bomHandled: false, bomBuffer: Buffer.alloc(0) }

  let inQuotes = false
  let atFieldStart = true
  let pendingQuoteInQuotes = false
  let pendingCR = false
  let currentColCount = 1
  let currentRecordHasContent = false
  let hasAnyNonEmptyContent = false

  let headerCols: number | null = null
  let totalRecords = 0
  let pendingEmptyLines = 0

  const headChunks: Buffer[] = []
  let collectingHead = true
  let headPendingEmptyBuffers: Buffer[] = []

  const commitLogicalRecord = (cols: number, isEmptyLine: boolean, recordSliceForHead: Buffer | null) => {
    if (isEmptyLine) {
      pendingEmptyLines += 1
      if (collectingHead && recordSliceForHead) {
        headPendingEmptyBuffers.push(recordSliceForHead)
      }
      return
    }

    if (pendingEmptyLines > 0) {
      for (let e = 0; e < pendingEmptyLines; e += 1) {
        if (headerCols === null) {
          headerCols = 1
          totalRecords = 1
        } else {
          const dataRowNum = totalRecords
          if (headerCols !== 1) {
            ingestError(
              `Baris data ke-${dataRowNum} memiliki 1 kolom, seharusnya ${headerCols} kolom. Periksa pemisah kolom atau baris yang rusak.`,
              400,
            )
          }
          totalRecords += 1
        }
      }
      if (collectingHead && headPendingEmptyBuffers.length > 0) {
        headChunks.push(...headPendingEmptyBuffers)
      }
      pendingEmptyLines = 0
      headPendingEmptyBuffers = []
    }

    if (headerCols === null) {
      if (cols > MAX_COLUMNS) {
        ingestError(`Jumlah kolom (${cols}) melebihi batas maksimal ${MAX_COLUMNS} kolom.`, 400)
      }
      headerCols = cols
      totalRecords = 1
    } else {
      const dataRowNum = totalRecords
      if (cols !== headerCols) {
        ingestError(
          `Baris data ke-${dataRowNum} memiliki ${cols} kolom, seharusnya ${headerCols} kolom. Periksa pemisah kolom atau baris yang rusak.`,
          400,
        )
      }
      totalRecords += 1
    }

    if (collectingHead && recordSliceForHead) {
      headChunks.push(recordSliceForHead)
      if (totalRecords > PREVIEW_ROW_LIMIT) {
        collectingHead = false
      }
    }
  }

  const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 })
  for await (const rawChunk of stream) {
    const rawBuf = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    const buf = stripLeadingBomBytes(rawBuf, bomState)
    if (buf.length === 0) continue

    let decoded: string
    try {
      decoded = utf8Decoder.decode(buf, { stream: true })
    } catch {
      ingestError('File harus dikodekan sebagai UTF-8 yang valid.', 400)
    }
    if (decoded.includes('\u0000')) {
      ingestError('Isi data mengandung karakter biner yang tidak didukung.', 400)
    }

    let recordStartIdx = 0
    let i = 0

    const flushHeadSliceUpTo = (endIdx: number) => {
      if (!collectingHead || endIdx <= recordStartIdx) return null
      return Buffer.from(buf.subarray(recordStartIdx, endIdx))
    }

    while (i < buf.length) {
      const b = buf[i]!

      if (pendingQuoteInQuotes) {
        pendingQuoteInQuotes = false
        if (b === 0x22) {
          i += 1
          continue
        }
        inQuotes = false
        // fall through to process byte b outside quotes
      }

      if (pendingCR) {
        pendingCR = false
        if (b === 0x0A) {
          const isEmpty = !currentRecordHasContent && currentColCount === 1
          const slice = flushHeadSliceUpTo(i + 1)
          commitLogicalRecord(currentColCount, isEmpty, slice)
          currentColCount = 1
          currentRecordHasContent = false
          atFieldStart = true
          recordStartIdx = i + 1
          i += 1
          continue
        }
        // Bare CR ended previous record; process byte b as start of new record
        const isEmpty = !currentRecordHasContent && currentColCount === 1
        const slice = flushHeadSliceUpTo(i)
        commitLogicalRecord(currentColCount, isEmpty, slice)
        currentColCount = 1
        currentRecordHasContent = false
        atFieldStart = true
        recordStartIdx = i
        // fall through to process byte b
      }

      if (inQuotes) {
        if (b === 0x22) {
          if (i + 1 < buf.length) {
            if (buf[i + 1] === 0x22) {
              i += 2
              continue
            }
            inQuotes = false
            i += 1
            continue
          }
          pendingQuoteInQuotes = true
          i += 1
          continue
        }
        i += 1
        continue
      }

      // Outside quotes
      if (b === 0x22 && atFieldStart) {
        inQuotes = true
        atFieldStart = false
        currentRecordHasContent = true
        hasAnyNonEmptyContent = true
        i += 1
        continue
      }

      if (b === delimByte) {
        currentColCount += 1
        atFieldStart = true
        hasAnyNonEmptyContent = true
        i += 1
        continue
      }

      if (b === 0x0D) {
        pendingCR = true
        i += 1
        continue
      }

      if (b === 0x0A) {
        const isEmpty = !currentRecordHasContent && currentColCount === 1
        const slice = flushHeadSliceUpTo(i + 1)
        commitLogicalRecord(currentColCount, isEmpty, slice)
        currentColCount = 1
        currentRecordHasContent = false
        atFieldStart = true
        recordStartIdx = i + 1
        i += 1
        continue
      }

      if (b !== 0x20 && b !== 0x09) {
        hasAnyNonEmptyContent = true
      }
      currentRecordHasContent = true
      atFieldStart = false
      i += 1
    }

    if (collectingHead && recordStartIdx < buf.length) {
      headChunks.push(Buffer.from(buf.subarray(recordStartIdx)))
    }
  }

  // Finalize BOM buffer if file was < 3 bytes
  if (!bomState.bomHandled && bomState.bomBuffer.length > 0) {
    try {
      utf8Decoder.decode(bomState.bomBuffer, { stream: true })
    } catch {
      ingestError('File harus dikodekan sebagai UTF-8 yang valid.', 400)
    }
    hasAnyNonEmptyContent = true
    currentRecordHasContent = true
    if (collectingHead) headChunks.push(bomState.bomBuffer)
  }

  try {
    utf8Decoder.decode()
  } catch {
    ingestError('File harus dikodekan sebagai UTF-8 yang valid.', 400)
  }

  if (pendingQuoteInQuotes) {
    pendingQuoteInQuotes = false
    inQuotes = false
  }

  if (inQuotes) {
    ingestError(`Format CSV tidak valid pada baris ke-${totalRecords + 1}. Periksa tanda kutip atau pemisah kolom.`, 400)
  }

  if (pendingCR) {
    pendingCR = false
    const isEmpty = !currentRecordHasContent && currentColCount === 1
    commitLogicalRecord(currentColCount, isEmpty, null)
    currentColCount = 1
    currentRecordHasContent = false
  } else if (currentRecordHasContent || currentColCount > 1) {
    commitLogicalRecord(currentColCount, false, null)
  }

  if (!hasAnyNonEmptyContent || totalRecords === 0 || headerCols === null) {
    ingestError('Data CSV kosong dan tidak memiliki baris judul.', 400)
  }

  const headText = Buffer.concat(headChunks)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .replace(/(?:\r?\n|\r)+$/, '')

  const headParsed = Papa.parse<string[]>(headText, {
    delimiter,
    header: false,
    skipEmptyLines: false,
  })

  if (headParsed.errors.length > 0) {
    const firstErr = headParsed.errors[0]
    const rowLabel = typeof firstErr?.row === 'number' ? ` pada baris ke-${firstErr.row + 1}` : ''
    ingestError(`Format CSV tidak valid${rowLabel}. Periksa tanda kutip atau pemisah kolom.`, 400)
  }

  const headRows = headParsed.data
  if (headRows.length === 0) {
    ingestError('Data CSV kosong dan tidak memiliki baris judul.', 400)
  }

  const rawHeaders = (headRows[0] ?? []).map((cell) => String(cell ?? ''))
  if (rawHeaders.length === 0) {
    ingestError('Baris judul tidak memiliki kolom.', 400)
  }
  if (rawHeaders.length > MAX_COLUMNS) {
    ingestError(`Jumlah kolom (${rawHeaders.length}) melebihi batas maksimal ${MAX_COLUMNS} kolom.`, 400)
  }

  const suggestedColumns = sanitizeColumnNames(rawHeaders)
  const previewRows = headRows
    .slice(1, 1 + PREVIEW_ROW_LIMIT)
    .map((row) => row.map((cell) => String(cell ?? '')))

  return {
    delimiter,
    detectedDelimiter,
    rawHeaders,
    suggestedColumns,
    previewRows,
    rowCount: Math.max(0, totalRecords - 1),
    columnCount: rawHeaders.length,
  }
}

export function createChunkedReadable(buf: Buffer, chunkSize = STREAM_CHUNK_BYTES): Readable {
  async function* generate() {
    for (let offset = 0; offset < buf.length; offset += chunkSize) {
      yield buf.subarray(offset, Math.min(offset + chunkSize, buf.length))
    }
  }
  return Readable.from(generate(), { objectMode: false })
}

async function streamCsvBatchesFromReadable(
  source: AsyncIterable<Buffer>,
  delimiter: SupportedDelimiter,
  onBatch: (batchBuffer: Buffer, rowCount: number) => Promise<void>,
): Promise<number> {
  const delimByte = delimiter.charCodeAt(0)
  const bomState = { bomHandled: false, bomBuffer: Buffer.alloc(0) }

  let inQuotes = false
  let atFieldStart = true
  let pendingQuoteInQuotes = false
  let pendingCR = false
  let currentColCount = 1
  let currentRecordHasContent = false

  let recordIndex = 0
  let recordChunks: Buffer[] = []
  let pendingEmptyRecords: Buffer[][] = []

  let batchBuffers: Buffer[] = []
  let batchBytes = 0
  let batchRows = 0
  let totalDataRows = 0

  const flushBatch = async () => {
    if (batchRows === 0 || batchBuffers.length === 0) return
    let combined = Buffer.concat(batchBuffers)
    if (combined.length > 0 && combined[combined.length - 1] !== 0x0A) {
      combined = Buffer.concat([combined, Buffer.from([0x0A])])
    }
    const rowsToFlush = batchRows
    batchBuffers = []
    batchBytes = 0
    batchRows = 0
    await onBatch(combined, rowsToFlush)
  }

  const pushCompletedRecord = async (chunks: Buffer[], isEmptyLine: boolean) => {
    if (recordIndex === 0) {
      if (isEmptyLine) {
        // Ignore leading empty line if any? Keep parity: header is record 0
      }
      recordIndex += 1
      return
    }

    if (isEmptyLine) {
      pendingEmptyRecords.push(chunks)
      return
    }

    if (pendingEmptyRecords.length > 0) {
      for (const emptyChunks of pendingEmptyRecords) {
        for (const c of emptyChunks) {
          batchBuffers.push(c)
          batchBytes += c.length
        }
        batchRows += 1
        totalDataRows += 1
        recordIndex += 1
      }
      pendingEmptyRecords = []
    }

    let recSize = 0
    for (const c of chunks) recSize += c.length

    if (batchRows > 0 && (batchRows >= BATCH_MAX_ROWS || batchBytes + recSize > BATCH_MAX_BYTES)) {
      await flushBatch()
    }

    for (const c of chunks) {
      batchBuffers.push(c)
      batchBytes += c.length
    }
    batchRows += 1
    totalDataRows += 1
    recordIndex += 1

    if (batchRows >= BATCH_MAX_ROWS || batchBytes >= BATCH_MAX_BYTES) {
      await flushBatch()
    }
  }

  for await (const rawChunk of source) {
    const rawBuf = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
    const buf = stripLeadingBomBytes(rawBuf, bomState)
    if (buf.length === 0) continue

    let recordStartIdx = 0
    let i = 0

    while (i < buf.length) {
      const b = buf[i]!

      if (pendingQuoteInQuotes) {
        pendingQuoteInQuotes = false
        if (b === 0x22) {
          i += 1
          continue
        }
        inQuotes = false
      }

      if (pendingCR) {
        pendingCR = false
        if (b === 0x0A) {
          const isEmpty = !currentRecordHasContent && currentColCount === 1
          if (i + 1 > recordStartIdx) {
            recordChunks.push(Buffer.from(buf.subarray(recordStartIdx, i + 1)))
          }
          await pushCompletedRecord(recordChunks, isEmpty)
          recordChunks = []
          currentColCount = 1
          currentRecordHasContent = false
          atFieldStart = true
          recordStartIdx = i + 1
          i += 1
          continue
        }

        // Bare CR ended previous record; replace trailing \r with \n on emitted slice
        const isEmpty = !currentRecordHasContent && currentColCount === 1
        if (i > recordStartIdx) {
          recordChunks.push(Buffer.from(buf.subarray(recordStartIdx, i)))
        }
        recordChunks.push(Buffer.from([0x0A]))
        await pushCompletedRecord(recordChunks, isEmpty)
        recordChunks = []
        currentColCount = 1
        currentRecordHasContent = false
        atFieldStart = true
        recordStartIdx = i
      }

      if (inQuotes) {
        if (b === 0x22) {
          if (i + 1 < buf.length) {
            if (buf[i + 1] === 0x22) {
              i += 2
              continue
            }
            inQuotes = false
            i += 1
            continue
          }
          pendingQuoteInQuotes = true
          i += 1
          continue
        }
        i += 1
        continue
      }

      if (b === 0x22 && atFieldStart) {
        inQuotes = true
        atFieldStart = false
        currentRecordHasContent = true
        i += 1
        continue
      }

      if (b === delimByte) {
        currentColCount += 1
        atFieldStart = true
        i += 1
        continue
      }

      if (b === 0x0D) {
        pendingCR = true
        i += 1
        continue
      }

      if (b === 0x0A) {
        const isEmpty = !currentRecordHasContent && currentColCount === 1
        if (i + 1 > recordStartIdx) {
          recordChunks.push(Buffer.from(buf.subarray(recordStartIdx, i + 1)))
        }
        await pushCompletedRecord(recordChunks, isEmpty)
        recordChunks = []
        currentColCount = 1
        currentRecordHasContent = false
        atFieldStart = true
        recordStartIdx = i + 1
        i += 1
        continue
      }

      currentRecordHasContent = true
      atFieldStart = false
      i += 1
    }

    if (recordStartIdx < buf.length) {
      recordChunks.push(Buffer.from(buf.subarray(recordStartIdx)))
    }
  }

  if (pendingQuoteInQuotes) {
    pendingQuoteInQuotes = false
    inQuotes = false
  }

  if (pendingCR) {
    pendingCR = false
    const isEmpty = !currentRecordHasContent && currentColCount === 1
    if (!isEmpty) {
      recordChunks.push(Buffer.from([0x0A]))
      await pushCompletedRecord(recordChunks, false)
    }
    recordChunks = []
  } else if (recordChunks.length > 0 && (currentRecordHasContent || currentColCount > 1)) {
    await pushCompletedRecord(recordChunks, false)
    recordChunks = []
  }

  await flushBatch()
  return totalDataRows
}

export async function streamCsvBatchesFromFile(
  filePath: string,
  delimiter: SupportedDelimiter,
  onBatch: (batchBuffer: Buffer, rowCount: number) => Promise<void>,
): Promise<number> {
  const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 })
  return streamCsvBatchesFromReadable(stream, delimiter, onBatch)
}

export async function streamCsvBatchesFromBuffer(
  bufferNoBom: Buffer,
  delimiter: SupportedDelimiter,
  onBatch: (batchBuffer: Buffer, rowCount: number) => Promise<void>,
): Promise<number> {
  return streamCsvBatchesFromReadable(createChunkedReadable(bufferNoBom, 256 * 1024), delimiter, onBatch)
}

async function parseStreamingMultipart(event: H3Event): Promise<{
  fields: Map<string, string>
  filePart: { filename: string | undefined; tempFilePath: string; byteSize: number } | null
}> {
  const req = event.node.req
  const fields = new Map<string, string>()
  let tempFilePath: string | null = null
  let fileFilename: string | undefined
  let fileBytes = 0
  let sawFilePart = false

  return new Promise((resolve, reject) => {
    let settled = false
    let writeStream: fs.WriteStream | null = null
    let writeDonePromise: Promise<void> | null = null
    let busboyFinished = false

    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      req.unpipe(bb)
      bb.destroy()
      if (writeStream) {
        writeStream.destroy()
      }
      if (tempFilePath) {
        safeUnlink(tempFilePath)
      }
      reject(err)
    }

    const tryComplete = async () => {
      if (settled || !busboyFinished) return
      try {
        if (writeDonePromise) {
          await writeDonePromise
        }
        if (settled) return
        settled = true
        resolve({
          fields,
          filePart: sawFilePart && tempFilePath
            ? { filename: fileFilename, tempFilePath, byteSize: fileBytes }
            : null,
        })
      } catch (err) {
        fail(err)
      }
    }

    const bb = busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: {
        fieldSize: MAX_TEXT_BYTES + 64 * 1024,
        files: 1,
      },
    })

    bb.on('field', (name, value, info) => {
      if (info.valueTruncated) {
        if (name === 'pastedText') {
          fail(createError({
            statusCode: 413,
            statusMessage: 'Teks yang ditempel melebihi batas maksimal 2 MB.',
            message: 'Teks yang ditempel melebihi batas maksimal 2 MB.',
          }))
          return
        }
      }
      fields.set(name, value)
    })

    bb.on('file', (name, stream, info) => {
      if (name !== 'file' || sawFilePart) {
        stream.resume()
        return
      }
      if (!info.filename) {
        // Ignore empty unselected file input
        let hasBytes = false
        stream.on('data', (chunk: Buffer) => {
          if (chunk.length > 0) hasBytes = true
        })
        stream.on('end', () => {
          if (hasBytes) {
            fail(createError({
              statusCode: 400,
              statusMessage: 'Nama file unggahan tidak valid.',
              message: 'Nama file unggahan tidak valid.',
            }))
          }
        })
        return
      }

      try {
        validateUploadExtension(info.filename)
      } catch (err) {
        stream.resume()
        fail(err)
        return
      }

      sawFilePart = true
      fileFilename = info.filename
      tempFilePath = path.join(os.tmpdir(), `bersihdata-ingest-${randomUUID()}.csv`)
      const out = fs.createWriteStream(tempFilePath, { highWaterMark: 256 * 1024 })
      writeStream = out

      writeDonePromise = new Promise<void>((resWrite, rejWrite) => {
        out.on('finish', () => resWrite())
        out.on('error', (err) => rejWrite(err))
        stream.on('error', (err) => rejWrite(err))
      })

      stream.on('data', (chunk: Buffer) => {
        fileBytes += chunk.length
      })

      stream.pipe(out)
    })

    bb.on('error', (err) => fail(err))
    req.on('aborted', () => fail(new Error('Koneksi unggahan terputus sebelum selesai.')))
    req.on('error', (err) => fail(err))

    bb.on('close', () => {
      busboyFinished = true
      void tryComplete()
    })

    req.pipe(bb)
  })
}

export async function readIngestPayload(event: H3Event): Promise<IngestRequestPayload> {
  // Prevent Node's 5-minute default server requestTimeout from killing large uploads
  event.node.req.setTimeout(0)
  event.node.res.setTimeout(0)

  const contentType = (getHeader(event, 'content-type') ?? '').toLowerCase()

  if (contentType.includes('multipart/form-data')) {
    const { fields, filePart } = await parseStreamingMultipart(event)

    const delimiterOption = fields.get('delimiter') ?? 'auto'
    const targetDatabase = fields.get('targetDatabase') ?? ''
    const tableName = fields.get('tableName') ?? ''
    const columnsRaw = fields.get('columns')
    let parsedColumns: string[] | null = null
    if (columnsRaw !== undefined && columnsRaw.trim() !== '') {
      try {
        const jsonVal: unknown = JSON.parse(columnsRaw)
        parsedColumns = Array.isArray(jsonVal) ? jsonVal.map((item) => String(item ?? '')) : null
      } catch {
        if (filePart) safeUnlink(filePart.tempFilePath)
        ingestError('Daftar nama kolom hasil tidak valid.', 400)
      }
    }

    if (filePart) {
      if (filePart.byteSize === 0) {
        safeUnlink(filePart.tempFilePath)
        ingestError('File yang diunggah kosong.', 400)
      }
      const sourceLabel = sanitizeSourceLabel(filePart.filename)
      return {
        mode: 'file',
        sourceLabel,
        filePath: filePart.tempFilePath,
        stagedUploadId: null,
        ownsTempFile: true,
        delimiterOption,
        targetDatabase,
        tableName,
        columns: parsedColumns,
      }
    }

    const pastedText = fields.get('pastedText')
    if (typeof pastedText !== 'string') {
      ingestError('Pilih file CSV/TSV/TXT atau tempel teks data terlebih dahulu.', 400)
    }

    const { textNoBom, bufferNoBom } = decodePastedText(pastedText)
    return {
      mode: 'text',
      sourceLabel: 'teks tempel',
      textNoBom,
      rawBufferNoBom: bufferNoBom,
      delimiterOption,
      targetDatabase,
      tableName,
      columns: parsedColumns,
    }
  }

  let body: Record<string, unknown>
  try {
    body = await readBody<Record<string, unknown>>(event)
  } catch {
    ingestError('Format permintaan tidak valid.', 400)
  }

  if (!body || typeof body !== 'object') {
    ingestError('Isi permintaan tidak valid.', 400)
  }

  const delimiterOption = typeof body.delimiter === 'string' ? body.delimiter : 'auto'
  const targetDatabase = typeof body.targetDatabase === 'string' ? body.targetDatabase : ''
  const tableName = typeof body.tableName === 'string' ? body.tableName : ''
  const columns = Array.isArray(body.columns)
    ? body.columns.map((item) => String(item ?? ''))
    : null

  if (typeof body.uploadId === 'string' && body.uploadId.trim()) {
    const staged = getStagedUpload(body.uploadId.trim())
    if (!staged) {
      ingestError('Sesi unggahan file telah kedaluwarsa atau tidak ditemukan. Silakan unggah ulang file Anda.', 404)
    }
    return {
      mode: 'file',
      sourceLabel: staged.sourceLabel,
      filePath: staged.filePath,
      stagedUploadId: body.uploadId.trim(),
      ownsTempFile: false,
      delimiterOption,
      targetDatabase,
      tableName,
      columns,
    }
  }

  if (typeof body.pastedText !== 'string') {
    ingestError('Teks data wajib diisi.', 400)
  }

  const { textNoBom, bufferNoBom } = decodePastedText(body.pastedText)
  return {
    mode: 'text',
    sourceLabel: 'teks tempel',
    textNoBom,
    rawBufferNoBom: bufferNoBom,
    delimiterOption,
    targetDatabase,
    tableName,
    columns,
  }
}

export function sanitizeIngestErrorMessage(error: unknown, fallback: string): string {
  if (isHttpError(error)) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    const raw = error.message
    const lower = raw.toLowerCase()
    if (lower.includes('timeout') || lower.includes('timed out')) {
      return `${fallback} Penyebab: Waktu eksekusi habis (timeout) saat memproses data.`
    }
    if (lower.includes('socket hang up') || lower.includes('econnreset')) {
      return `${fallback} Penyebab: Koneksi ke ClickHouse terputus (socket hang up / ECONNRESET). Pastikan layanan ClickHouse aktif dan tidak kehabisan memori.`
    }
    if (lower.includes('econnrefused')) {
      return `${fallback} Penyebab: Tidak dapat terhubung ke server ClickHouse (koneksi ditolak).`
    }
    const cleanMsg = raw.replace(/^DB::Exception:\s*/i, '').split('\n')[0]?.trim() || raw
    return `${fallback} Detail: ${cleanMsg}`
  }
  return fallback
}
