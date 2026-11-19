import { compilePipeline } from './compiler'
import type { ColumnMetadata, Pipeline, SourceReference } from './types'
import { getTableMetadata, quoteIdentifier } from './utils'
import { recordCleansingHistory } from '../features/cleansing-history'
import { createMergeTreeTableSafe, createStagingTableFromSelectSafe } from '../features/metadata'
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

  const createdStagingTables = new Set<string>()
  let sourceRows = 0
  let expectedResultRows = 0
  let resultRows = 0
  let resultTableCreated = false
  let success = false
  let historyMessage: string | null = null

  const dropStagingTable = async (stageTable: string) => {
    try {
      await client.command({
        query: `DROP TABLE IF EXISTS ${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(stageTable)}`,
        clickhouse_settings: { max_execution_time: 60 },
      })
      createdStagingTables.delete(stageTable)
    } catch (dropErr) {
      console.warn(`Gagal menghapus tabel staging ${sourceDatabase}.${stageTable}:`, dropErr)
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
      createdStagingTables.add(stageTableName)

      await createStagingTableFromSelectSafe(
        client,
        stageIdentifier,
        compiledStep.sql,
        compiledStep.params,
        900,
      )

      if (previousStageTable) {
        await dropStagingTable(previousStageTable)
      }

      previousStageTable = stageTableName
      currentSource = { database: sourceDatabase, table: stageTableName }
      lastStageSchema = compiledStep.schema
    }

    onProgress?.({
      currentStep: totalSteps,
      totalSteps,
      message: 'Menyimpan tabel hasil akhir...',
    })

    const finalStageIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(currentSource.table)}`
    const stageCount = await client.query({
      query: `SELECT count() AS total FROM ${finalStageIdentifier}`,
      format: 'JSONEachRow',
      clickhouse_settings: buildClickHouseQuerySettings({ max_execution_time: 60, readonly: 1 }),
    })
    const [stageCountRow] = await stageCount.json<{ total: number | string }[]>()
    expectedResultRows = countValue(stageCountRow?.total, 'jumlah baris hasil pipeline')

    const existingBeforeCreate = await client.query({
      query: 'SELECT name FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
      query_params: { database: sourceDatabase, table: resultTableName },
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 15 },
    })
    const foundBeforeCreate = await existingBeforeCreate.json<{ name: string }[]>()
    if (foundBeforeCreate.length > 0) {
      badRequest(409, 'Tabel hasil sudah ada', 'Nama tabel hasil sudah digunakan. Pilih nama lain agar tabel yang sudah ada tidak diubah.')
    }

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

    const tableIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(resultTableName)}`
    const columnSql = finalSchema.map((column) => `${quoteIdentifier(column.name)} ${column.type}`).join(', ')
    const orderByClause = orderBy.length ? quoteIdentifier(orderBy[0]!) : 'tuple()'

    await createMergeTreeTableSafe(
      client,
      `CREATE TABLE ${tableIdentifier} (${columnSql}) ENGINE ${engine} ORDER BY ${orderByClause}`,
      900,
    )
    resultTableCreated = true

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

    await client.command({
      query: `INSERT INTO ${tableIdentifier} ${finalSelectSql}`,
      clickhouse_settings: buildClickHouseQuerySettings({ max_execution_time: 900 }),
    })

    const countResult = await client.query({
      query: `SELECT count() AS total FROM ${tableIdentifier}`,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 30 },
    })
    const [resultCountRow] = await countResult.json<{ total: number | string }[]>()
    resultRows = countValue(resultCountRow?.total, 'jumlah baris hasil')
    if (resultRows !== expectedResultRows) {
      badRequest(
        500,
        'Verifikasi jumlah baris gagal',
        `Jumlah baris tabel hasil (${resultRows}) berbeda dari hitungan pipeline (${expectedResultRows}).`,
      )
    }

    const requiredOriginalColumns = saveOriginal
      ? includedOriginalColumns.map((column) => `${column}_asli`)
      : []
    let verification = `Jumlah baris hasil (${resultRows}) sesuai hitungan pipeline (${expectedResultRows}).`
    if (requiredOriginalColumns.length) {
      const originalColumnResult = await client.query({
        query: 'SELECT name, type FROM system.columns WHERE database = {database:String} AND table = {table:String}',
        query_params: { database: sourceDatabase, table: resultTableName },
        format: 'JSONEachRow',
        clickhouse_settings: { readonly: 1, max_execution_time: 15 },
      })
      const actualColumns = await originalColumnResult.json<{ name: string; type: string }[]>()
      const expectedOriginalColumns = finalSchema.filter(({ name }) => requiredOriginalColumns.includes(name))
      const invalid = expectedOriginalColumns.some((expected) =>
        !actualColumns.some((actual) => actual.name === expected.name && actual.type === expected.type),
      )
      if (invalid) {
        badRequest(500, 'Verifikasi nilai asli gagal', 'Kolom nilai asli tidak ditemukan dengan tipe yang sesuai pada tabel hasil.')
      }
      verification = `${requiredOriginalColumns.length} kolom nilai asli ditemukan dan jumlah baris hasil (${resultRows}) sesuai hitungan pipeline (${expectedResultRows}).`
    }

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
      verification,
    }
  } catch (error) {
    let failureMessage = messageFromSaveError(error)
    if (resultTableCreated) {
      try {
        const partialCount = await client.query({
          query: `SELECT count() AS total FROM ${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(resultTableName)}`,
          format: 'JSONEachRow',
          clickhouse_settings: { readonly: 1, max_execution_time: 30 },
        })
        const [partialCountRow] = await partialCount.json<{ total: number | string }[]>()
        resultRows = countValue(partialCountRow?.total, 'jumlah baris parsial')
      } catch (countError) {
        console.warn('Jumlah baris hasil yang gagal tidak dapat diverifikasi.', countError)
        failureMessage = `${failureMessage} Jumlah baris parsial tidak dapat diverifikasi.`
      }
    }
    historyMessage = failureMessage
    throw error
  } finally {
    for (const stageTable of [...createdStagingTables]) {
      await dropStagingTable(stageTable)
    }

    await recordCleansingHistory(client, {
      featureId: 'workbench',
      sourceDatabase,
      sourceTable,
      resultTable: resultTableName,
      parameters: historyParameters,
      sourceRows,
      filledRows: resultRows,
      ambiguousRows: 0,
      durationMs: Date.now() - startedAt,
      status: success ? 'sukses' : 'gagal',
      message: success ? null : historyMessage ?? 'Penerapan cleansing gagal sebelum proses selesai.',
      startedAt,
    })
  }
}
