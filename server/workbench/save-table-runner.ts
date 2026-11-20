import { compilePipeline } from './compiler'
import type { ColumnMetadata, Pipeline, SourceReference } from './types'
import { getTableMetadata, quoteIdentifier } from './utils'
import { recordCleansingHistory } from '../features/cleansing-history'
import { createMergeTreeTableSafe, createStagingTableFromSelectSafe } from '../features/metadata'
import {
  dropRegisteredTempTable,
  recordTempTableStatus,
  startTempTableHeartbeat,
} from '../features/temp-table-registry'
import { buildClickHouseQuerySettings } from '../utils/clickhouse'
import type { SaveTableResult } from './save-jobs'

export type ParsedSaveTableRequest = {
  sourceDatabase: string
  sourceTable: string
  resultTableName: string
  engine: 'MergeTree' | 'ReplacingMergeTree'
  orderBy: string[]
  saveOriginal: boolean
  pipeline: Pipeline
  historyParameters: Record<string, unknown>
}

export type SaveTableProgressUpdate = {
  currentStep: number
  totalSteps: number
  message: string
}

export type FinalIntegrityInput = {
  expectedResultRows: number
  writtenRows: number | null
  actualResultRows: number
  compiledSchema: ColumnMetadata[]
  actualColumns: ColumnMetadata[]
  expectedOriginalColumns: ColumnMetadata[]
}

export type FinalIntegrityReport = {
  barisDiharapkan: number
  barisTertulis: number | null
  barisTabelSementara: number
  skemaCocok: boolean
  kolomAsliCocok: boolean
  jumlahKolom: number
  kolomAsli: string[]
  ringkasan: string
}

function badRequest(statusCode: number, statusMessage: string, message: string): never {
  throw createError({ statusCode, statusMessage, message })
}

export function messageFromSaveError(error: unknown): string {
  const raw = error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : 'Penerapan cleansing gagal.'
  return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 500)
    || 'Penerapan cleansing gagal.'
}

function countValue(value: number | string | undefined, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    badRequest(500, 'Hasil verifikasi tidak valid', `ClickHouse mengembalikan ${label} yang tidak valid.`)
  }
  return parsed
}

export function verifyFinalTableIntegrity(input: FinalIntegrityInput): FinalIntegrityReport {
  const {
    expectedResultRows,
    writtenRows,
    actualResultRows,
    compiledSchema,
    actualColumns,
    expectedOriginalColumns,
  } = input

  // (b) Tabel tidak kosong kecuali pipeline memang menghasilkan 0 baris
  if (actualResultRows === 0 && expectedResultRows > 0) {
    badRequest(
      500,
      'Verifikasi kekosongan tabel gagal',
      `Tabel sementara hasil kosong (0 baris), padahal pipeline menghasilkan ${expectedResultRows} baris.`,
    )
  }

  // (a) Jumlah baris tabel sementara sama dengan jumlah baris tertulis hasil INSERT dan hitungan pipeline
  if (writtenRows !== null && actualResultRows !== writtenRows) {
    badRequest(
      500,
      'Verifikasi jumlah baris tertulis gagal',
      `Jumlah baris tabel sementara (${actualResultRows}) berbeda dari baris tertulis hasil INSERT (${writtenRows}).`,
    )
  }

  if (actualResultRows !== expectedResultRows) {
    badRequest(
      500,
      'Verifikasi jumlah baris gagal',
      `Jumlah baris tabel sementara (${actualResultRows}) berbeda dari hitungan pipeline (${expectedResultRows}).`,
    )
  }

  // (c) Skema (nama dan tipe kolom) sama dengan skema akhir hasil kompilasi (LIMIT 0)
  if (actualColumns.length === 0 || actualColumns.length !== compiledSchema.length) {
    badRequest(
      500,
      'Verifikasi skema akhir gagal',
      `Jumlah kolom tabel sementara (${actualColumns.length}) tidak sama dengan skema akhir hasil kompilasi (${compiledSchema.length}).`,
    )
  }

  for (let i = 0; i < compiledSchema.length; i += 1) {
    const expectedCol = compiledSchema[i]!
    const actualCol = actualColumns[i]!
    if (actualCol.name !== expectedCol.name || actualCol.type.trim() !== expectedCol.type.trim()) {
      badRequest(
        500,
        'Verifikasi skema akhir gagal',
        `Kolom ke-${i + 1} pada tabel sementara (${actualCol.name}: ${actualCol.type}) tidak sama dengan skema hasil kompilasi (${expectedCol.name}: ${expectedCol.type}).`,
      )
    }
  }

  // (d) Setiap kolom <kolom>_asli yang diharapkan benar-benar ada dengan tipe yang sesuai
  for (const expectedOrig of expectedOriginalColumns) {
    const found = actualColumns.find((col) => col.name === expectedOrig.name)
    if (!found || found.type.trim() !== expectedOrig.type.trim()) {
      badRequest(
        500,
        'Verifikasi nilai asli gagal',
        `Kolom nilai asli "${expectedOrig.name}" (${expectedOrig.type}) tidak ditemukan dengan tipe yang sesuai pada tabel sementara.`,
      )
    }
  }

  const origNames = expectedOriginalColumns.map((col) => col.name)
  const writtenPart = writtenRows !== null ? ` dan sesuai baris tertulis INSERT (${writtenRows})` : ''
  const origPart = origNames.length
    ? `${origNames.length} kolom nilai asli terverifikasi (${origNames.join(', ')})`
    : 'tanpa kolom nilai asli'
  const ringkasan = expectedResultRows === 0
    ? `Verifikasi lulus: pipeline menghasilkan 0 baris, skema ${compiledSchema.length} kolom sesuai kompilasi LIMIT 0, ${origPart}.`
    : `Verifikasi lulus: ${actualResultRows} baris sesuai hitungan pipeline (${expectedResultRows})${writtenPart}, skema ${compiledSchema.length} kolom sesuai kompilasi LIMIT 0, ${origPart}.`

  return {
    barisDiharapkan: expectedResultRows,
    barisTertulis: writtenRows,
    barisTabelSementara: actualResultRows,
    skemaCocok: true,
    kolomAsliCocok: true,
    jumlahKolom: compiledSchema.length,
    kolomAsli: origNames,
    ringkasan,
  }
}

export function parseSaveTableRequest(body: unknown): ParsedSaveTableRequest {
  if (!body || typeof body !== 'object' || !('source' in body) || !('steps' in body)) {
    badRequest(400, 'Payload tidak valid', 'Body harus berisi source dan steps.')
  }

  const bodyRecord = body as Record<string, unknown>
  const sourceCandidate = bodyRecord.source && typeof bodyRecord.source === 'object'
    ? bodyRecord.source as Record<string, unknown>
    : {}
  const sourceDatabase = typeof sourceCandidate.database === 'string' ? sourceCandidate.database : ''
  const sourceTable = typeof sourceCandidate.table === 'string' ? sourceCandidate.table : ''
  const resultCandidate = bodyRecord.resultTableName !== undefined
    ? bodyRecord.resultTableName
    : bodyRecord.tableName
  const resultTableName = resultCandidate === undefined
    ? 'hasil_cleansing'
    : typeof resultCandidate === 'string' ? resultCandidate : ''
  const engineCandidate = bodyRecord.engine
  const engine = engineCandidate === undefined
    ? 'MergeTree'
    : typeof engineCandidate === 'string' ? engineCandidate : ''
  const rawOrderBy = bodyRecord.orderBy ?? []
  const saveOriginal = bodyRecord.saveOriginal === true

  if (!sourceDatabase || !sourceTable || !Array.isArray(bodyRecord.steps)) {
    badRequest(400, 'Payload tidak valid', 'Sumber data dan daftar langkah harus diisi dengan benar.')
  }
  if (bodyRecord.steps.length === 0) {
    badRequest(400, 'Langkah pipeline kosong', 'Minimal satu langkah cleansing harus ditambahkan sebelum menyimpan tabel hasil.')
  }
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(resultTableName)) {
    badRequest(400, 'Nama tabel hasil tidak valid', 'Nama tabel hasil harus diawali huruf, maksimal 64 karakter, dan hanya berisi huruf, angka, atau garis bawah.')
  }
  if (!Array.isArray(rawOrderBy) || rawOrderBy.some((column) => typeof column !== 'string')) {
    badRequest(400, 'Kolom ORDER BY tidak valid', 'Daftar kolom ORDER BY harus berisi nama kolom yang valid.')
  }
  if (bodyRecord.saveOriginal !== undefined && typeof bodyRecord.saveOriginal !== 'boolean') {
    badRequest(400, 'Opsi nilai asli tidak valid', 'Opsi simpan nilai asli harus berupa pilihan ya atau tidak.')
  }
  if (rawOrderBy.length > 1) {
    badRequest(400, 'Pilih satu kolom ORDER BY', 'Tabel hasil hanya menerima satu kolom ORDER BY pada formulir ini.')
  }
  if (engine !== 'MergeTree' && engine !== 'ReplacingMergeTree') {
    badRequest(400, 'Engine tabel hasil tidak valid', 'Pilih engine MergeTree atau ReplacingMergeTree.')
  }

  const pipeline = body as Pipeline
  const orderBy = rawOrderBy as string[]
  const historyParameters: Record<string, unknown> = {
    source: { database: sourceDatabase, table: sourceTable },
    steps: pipeline.steps,
    jumlah_langkah: pipeline.steps.length,
    engine,
    options: {
      resultTableName,
      engine,
      orderBy,
      saveOriginal,
    },
  }

  return {
    sourceDatabase,
    sourceTable,
    resultTableName,
    engine,
    orderBy,
    saveOriginal,
    pipeline,
    historyParameters,
  }
}

export async function executeStagedSaveTable(
  client: ReturnType<typeof useClickHouse>,
  jobId: string,
  parsed: ParsedSaveTableRequest,
  onProgress?: (update: SaveTableProgressUpdate) => void,
): Promise<SaveTableResult> {
  const startedAt = Date.now()
  const totalSteps = parsed.pipeline.steps.length
  const {
    sourceDatabase,
    sourceTable,
    resultTableName,
    engine,
    orderBy,
    saveOriginal,
    pipeline,
    historyParameters,
  } = parsed

  const activeTempTables = new Map<string, { createdAtMs: number }>()
  let sourceRows = 0
  let expectedResultRows = 0
  let resultRows = 0
  let success = false
  let historyMessage: string | null = null
  let verificationReport: FinalIntegrityReport | null = null

  const stopHeartbeat = startTempTableHeartbeat(
    client,
    () => [...activeTempTables.entries()].map(([table, meta]) => ({
      jobId,
      jenis: 'save' as const,
      database: sourceDatabase,
      table,
      createdAtMs: meta.createdAtMs,
    })),
    15_000,
  )

  const registerTempRunning = async (tableName: string) => {
    const createdAtMs = await recordTempTableStatus(client, {
      jobId,
      jenis: 'save',
      database: sourceDatabase,
      table: tableName,
      status: 'running',
    })
    activeTempTables.set(tableName, { createdAtMs })
  }

  const finalizeAndDropTempTable = async (tableName: string, finalStatus: 'done' | 'failed') => {
    const meta = activeTempTables.get(tableName)
    if (!meta) return
    try {
      await recordTempTableStatus(client, {
        jobId,
        jenis: 'save',
        database: sourceDatabase,
        table: tableName,
        status: finalStatus,
        createdAtMs: meta.createdAtMs,
      })
    } catch (statusErr) {
      console.warn(`Gagal mencatat status ${finalStatus} tabel sementara ${sourceDatabase}.${tableName}:`, statusErr)
    }

    try {
      await dropRegisteredTempTable(client, {
        jobId,
        database: sourceDatabase,
        table: tableName,
        maxExecutionTimeSec: 60,
      })
      activeTempTables.delete(tableName)
    } catch (dropErr) {
      console.warn(`Gagal menghapus tabel sementara ${sourceDatabase}.${tableName}:`, dropErr)
    }
  }

  try {
    onProgress?.({
      currentStep: 0,
      totalSteps,
      message: 'Memvalidasi sumber data dan skema pipeline...',
    })

    const sourceMetadata = await getTableMetadata(client, pipeline.source)
    const preflight = await compilePipeline(client, pipeline, { skipHeavyValidation: true })

    let originalColumns: string[] = []
    if (saveOriginal) {
      const sourceColumns = new Set(preflight.sourceSchema.map(({ name }) => name))
      originalColumns = [...new Set(preflight.touchedColumns)].filter((column) => sourceColumns.has(column))
      for (const column of originalColumns) {
        const originalName = `${column}_asli`
        if (preflight.sourceSchema.some((item) => item.name === originalName)
          || preflight.schema.some((item) => item.name === originalName)) {
          badRequest(400, 'Kolom nilai asli tidak dapat dibuat', `Kolom ${column}_asli tidak dapat ditambahkan tanpa benturan nama.`)
        }
      }
    }

    if (orderBy.length === 1) {
      const orderColumn = preflight.schema.find((column) => column.name === orderBy[0])
      if (!orderColumn) {
        badRequest(400, 'Kolom ORDER BY tidak valid', 'Kolom ORDER BY harus dipilih dari skema hasil pipeline.')
      }
      if (/Nullable\s*\(/.test(orderColumn.type)) {
        badRequest(400, 'Kolom ORDER BY tidak boleh Nullable', 'Pilih kolom ORDER BY yang tidak bertipe Nullable.')
      }
    }

    const existing = await client.query({
      query: 'SELECT name FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
      query_params: { database: sourceDatabase, table: resultTableName },
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 15 },
    })
    const found = await existing.json<{ name: string }[]>()
    if (found.length > 0) {
      badRequest(409, 'Tabel hasil sudah ada', 'Nama tabel hasil sudah digunakan. Pilih nama lain agar tabel yang sudah ada tidak diubah.')
    }

    const sourceIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(sourceTable)}`
    const sourceCount = await client.query({
      query: `SELECT count() AS total FROM ${sourceIdentifier}`,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 30 },
    })
    const [sourceCountRow] = await sourceCount.json<{ total: number | string }[]>()
    sourceRows = countValue(sourceCountRow?.total, 'jumlah baris sumber')

    let currentSource: SourceReference = { database: sourceDatabase, table: sourceTable }
    let previousStageTable: string | null = null
    let lastStageSchema: ColumnMetadata[] = preflight.sourceSchema

    for (let index = 0; index < totalSteps; index += 1) {
      onProgress?.({
        currentStep: index + 1,
        totalSteps,
        message: `Memproses langkah ${index + 1} dari ${totalSteps}...`,
      })

      const stepPipeline: Pipeline = {
        source: currentSource,
        steps: [pipeline.steps[index]!],
      }
      const compiledStep = await compilePipeline(client, stepPipeline, {
        includeSourceColumns: index === 0 ? originalColumns : [],
        metadataOverride: sourceMetadata,
      })

      const stageTableName = `__tmp_stage_${jobId}_${index}`
      const stageIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(stageTableName)}`
      await registerTempRunning(stageTableName)

      await createStagingTableFromSelectSafe(
        client,
        stageIdentifier,
        compiledStep.sql,
        compiledStep.params,
        900,
      )

      if (previousStageTable) {
        await finalizeAndDropTempTable(previousStageTable, 'done')
      }

      previousStageTable = stageTableName
      currentSource = { database: sourceDatabase, table: stageTableName }
      lastStageSchema = compiledStep.schema
    }

    onProgress?.({
      currentStep: totalSteps,
      totalSteps,
      message: 'Memverifikasi integritas dan menyiapkan tabel hasil...',
    })

    const finalStageIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(currentSource.table)}`
    const stageCount = await client.query({
      query: `SELECT count() AS total FROM ${finalStageIdentifier}`,
      format: 'JSONEachRow',
      clickhouse_settings: buildClickHouseQuerySettings({ max_execution_time: 60, readonly: 1 }),
    })
    const [stageCountRow] = await stageCount.json<{ total: number | string }[]>()
    expectedResultRows = countValue(stageCountRow?.total, 'jumlah baris hasil pipeline')

    const originalSourcePrefix = '__sumber_'
    const includedOriginalColumns = originalColumns.filter((column) =>
      lastStageSchema.some((item) => item.name === `${originalSourcePrefix}${column}`),
    )

    const finalSchema: ColumnMetadata[] = lastStageSchema.map((column) => {
      if (column.name.startsWith(originalSourcePrefix)) {
        const baseName = column.name.slice(originalSourcePrefix.length)
        if (includedOriginalColumns.includes(baseName)) {
          return { ...column, name: `${baseName}_asli` }
        }
      }
      return column
    })

    const finalSelectExprs = lastStageSchema.map((column) => {
      if (column.name.startsWith(originalSourcePrefix)) {
        const baseName = column.name.slice(originalSourcePrefix.length)
        if (includedOriginalColumns.includes(baseName)) {
          return `${quoteIdentifier(column.name)} AS ${quoteIdentifier(`${baseName}_asli`)}`
        }
      }
      return quoteIdentifier(column.name)
    })
    const finalSelectSql = `SELECT ${finalSelectExprs.join(', ')} FROM ${finalStageIdentifier}`

    const compiledLimit0Result = await client.query({
      query: `SELECT * FROM (${finalSelectSql}) LIMIT 0`,
      format: 'JSON',
      clickhouse_settings: buildClickHouseQuerySettings({ max_execution_time: 60, readonly: 1 }),
    })
    const compiledLimit0Json = await compiledLimit0Result.json<{ meta?: Array<{ name: string; type: string }> }>()
    const compiledLimit0Schema: ColumnMetadata[] = (compiledLimit0Json.meta ?? []).map((col) => ({
      name: col.name,
      type: col.type,
    }))

    const finalTempTableName = `__tmp_final_${jobId}`
    const finalTempIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(finalTempTableName)}`
    const columnSql = finalSchema.map((column) => `${quoteIdentifier(column.name)} ${column.type}`).join(', ')
    const orderByClause = orderBy.length ? quoteIdentifier(orderBy[0]!) : 'tuple()'

    await registerTempRunning(finalTempTableName)
    await createMergeTreeTableSafe(
      client,
      `CREATE TABLE ${finalTempIdentifier} (${columnSql}) ENGINE ${engine} ORDER BY ${orderByClause}`,
      900,
    )

    const insertResponse = await client.command({
      query: `INSERT INTO ${finalTempIdentifier} ${finalSelectSql}`,
      clickhouse_settings: buildClickHouseQuerySettings({ max_execution_time: 900 }),
    })
    const rawWrittenRows = insertResponse && typeof insertResponse === 'object' && 'summary' in insertResponse
      ? insertResponse.summary?.written_rows
      : undefined
    const writtenRows = rawWrittenRows !== undefined && /^\d+$/.test(String(rawWrittenRows))
      ? countValue(rawWrittenRows, 'jumlah baris tertulis INSERT')
      : null

    const tempCountResult = await client.query({
      query: `SELECT count() AS total FROM ${finalTempIdentifier}`,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 30 },
    })
    const [tempCountRow] = await tempCountResult.json<{ total: number | string }[]>()
    const tempRowCount = countValue(tempCountRow?.total, 'jumlah baris tabel sementara')

    const actualColumnsResult = await client.query({
      query: 'SELECT name, type FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
      query_params: { database: sourceDatabase, table: finalTempTableName },
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 15 },
    })
    const actualColumns = await actualColumnsResult.json<ColumnMetadata[]>()

    const requiredOriginalColumns = saveOriginal
      ? includedOriginalColumns.map((column) => `${column}_asli`)
      : []
    const expectedOriginalColumns = finalSchema.filter(({ name }) => requiredOriginalColumns.includes(name))

    verificationReport = verifyFinalTableIntegrity({
      expectedResultRows,
      writtenRows,
      actualResultRows: tempRowCount,
      compiledSchema: compiledLimit0Schema.length > 0 ? compiledLimit0Schema : finalSchema,
      actualColumns,
      expectedOriginalColumns,
    })

    const existingBeforeRename = await client.query({
      query: 'SELECT name FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
      query_params: { database: sourceDatabase, table: resultTableName },
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 15 },
    })
    const foundBeforeRename = await existingBeforeRename.json<{ name: string }[]>()
    if (foundBeforeRename.length > 0) {
      badRequest(409, 'Tabel hasil sudah ada', 'Nama tabel hasil sudah digunakan. Pilih nama lain agar tabel yang sudah ada tidak diubah.')
    }

    const resultTableIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(resultTableName)}`
    await client.command({
      query: `RENAME TABLE ${finalTempIdentifier} TO ${resultTableIdentifier}`,
      clickhouse_settings: { max_execution_time: 60 },
    })

    const renamedMeta = activeTempTables.get(finalTempTableName)
    activeTempTables.delete(finalTempTableName)
    if (renamedMeta) {
      await recordTempTableStatus(client, {
        jobId,
        jenis: 'save',
        database: sourceDatabase,
        table: finalTempTableName,
        status: 'done',
        createdAtMs: renamedMeta.createdAtMs,
      }).catch((err) => {
        console.warn(`Gagal mencatat status done untuk tabel sementara ${sourceDatabase}.${finalTempTableName}:`, err)
      })
    }

    resultRows = tempRowCount
    historyParameters.verifikasi = verificationReport
    success = true

    return {
      status: 'ok',
      database: sourceDatabase,
      table: resultTableName,
      engine,
      rows: resultRows,
      saveOriginal,
      originalColumns: requiredOriginalColumns,
      steps: totalSteps,
      durationMs: Date.now() - startedAt,
      verification: verificationReport.ringkasan,
    }
  } catch (error) {
    const failureMessage = messageFromSaveError(error)
    historyParameters.verifikasi = {
      status: 'gagal',
      ringkasan: failureMessage,
    }
    historyMessage = failureMessage
    throw error
  } finally {
    await stopHeartbeat()

    const finalTempStatus: 'done' | 'failed' = success ? 'done' : 'failed'
    for (const tempTable of [...activeTempTables.keys()]) {
      await finalizeAndDropTempTable(tempTable, finalTempStatus)
    }

    await recordCleansingHistory(client, {
      featureId: 'workbench',
      sourceDatabase,
      sourceTable,
      resultTable: resultTableName,
      parameters: historyParameters,
      sourceRows,
      filledRows: success ? resultRows : 0,
      ambiguousRows: 0,
      durationMs: Date.now() - startedAt,
      status: success ? 'sukses' : 'gagal',
      message: success ? null : historyMessage ?? 'Penerapan cleansing gagal sebelum proses selesai.',
      startedAt,
    })
  }
}
