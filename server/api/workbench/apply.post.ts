import { compilePipeline } from '../../workbench/compiler'
import type { Pipeline } from '../../workbench/types'
import { quoteIdentifier } from '../../workbench/utils'
import { recordCleansingHistory } from '../../features/cleansing-history'
import { createMergeTreeTableSafe } from '../../features/metadata'
import { buildClickHouseQuerySettings } from '../../utils/clickhouse'

function badRequest(statusCode: number, statusMessage: string, message: string): never {
  throw createError({ statusCode, statusMessage, message })
}

function messageFromError(error: unknown): string {
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

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  const client = useClickHouse()
  let sourceDatabase = ''
  let sourceTable = ''
  let resultTableName = 'hasil_cleansing'
  let engine = 'MergeTree'
  let rawOrderBy: unknown = []
  let saveOriginalForHistory = false
  let historyParameters: Record<string, unknown> = {
    source: { database: sourceDatabase, table: sourceTable },
    steps: [],
    jumlah_langkah: 0,
    engine,
    options: {
      resultTableName,
      engine,
      orderBy: [],
      saveOriginal: saveOriginalForHistory,
    },
  }
  let sourceRows = 0
  let expectedResultRows = 0
  let resultRows = 0
  let resultTableCreated = false
  let success = false
  let historyMessage: string | null = null

  try {
    let body: unknown
    try {
      body = await readBody(event)
    } catch {
      badRequest(400, 'Payload tidak valid', 'Body harus berupa JSON yang valid.')
    }
    const bodyRecord = body && typeof body === 'object' ? body as Record<string, unknown> : {}
    const sourceCandidate = bodyRecord.source && typeof bodyRecord.source === 'object'
      ? bodyRecord.source as Record<string, unknown>
      : {}
    sourceDatabase = typeof sourceCandidate.database === 'string' ? sourceCandidate.database : ''
    sourceTable = typeof sourceCandidate.table === 'string' ? sourceCandidate.table : ''
    const resultCandidate = bodyRecord.resultTableName !== undefined
      ? bodyRecord.resultTableName
      : bodyRecord.tableName
    resultTableName = resultCandidate === undefined
      ? 'hasil_cleansing'
      : typeof resultCandidate === 'string' ? resultCandidate : ''
    const engineCandidate = bodyRecord.engine
    engine = engineCandidate === undefined
      ? 'MergeTree'
      : typeof engineCandidate === 'string' ? engineCandidate : ''
    const steps = Array.isArray(bodyRecord.steps) ? bodyRecord.steps : []
    rawOrderBy = bodyRecord.orderBy ?? []
    const orderByForHistory = Array.isArray(rawOrderBy) ? rawOrderBy : []
    saveOriginalForHistory = bodyRecord.saveOriginal === true
    historyParameters = {
      source: { database: sourceDatabase, table: sourceTable },
      steps,
      jumlah_langkah: steps.length,
      engine,
      options: {
        resultTableName,
        engine,
        orderBy: orderByForHistory,
        saveOriginal: saveOriginalForHistory,
      },
    }

    if (!body || typeof body !== 'object' || !('source' in body) || !('steps' in body)) {
      badRequest(400, 'Payload tidak valid', 'Body harus berisi source dan steps.')
    }
    if (typeof sourceCandidate.database !== 'string' || !sourceDatabase
      || typeof sourceCandidate.table !== 'string' || !sourceTable
      || !Array.isArray(bodyRecord.steps)) {
      badRequest(400, 'Payload tidak valid', 'Sumber data dan daftar langkah harus diisi dengan benar.')
    }
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(resultTableName)) {
      badRequest(400, 'Nama tabel hasil tidak valid', 'Nama tabel hasil harus diawali huruf, maksimal 64 karakter, dan hanya berisi huruf, angka, atau garis bawah.')
    }

    const pipeline = body as Pipeline
    const orderBy = rawOrderBy
    if (!Array.isArray(orderBy) || orderBy.some((column) => typeof column !== 'string')) {
      badRequest(400, 'Kolom ORDER BY tidak valid', 'Daftar kolom ORDER BY harus berisi nama kolom yang valid.')
    }
    if (bodyRecord.saveOriginal !== undefined && typeof bodyRecord.saveOriginal !== 'boolean') {
      badRequest(400, 'Opsi nilai asli tidak valid', 'Opsi simpan nilai asli harus berupa pilihan ya atau tidak.')
    }
    if (orderBy.length > 1) {
      badRequest(400, 'Pilih satu kolom ORDER BY', 'Tabel hasil hanya menerima satu kolom ORDER BY pada formulir ini.')
    }
    if (engine !== 'MergeTree' && engine !== 'ReplacingMergeTree') {
      badRequest(400, 'Engine tabel hasil tidak valid', 'Pilih engine MergeTree atau ReplacingMergeTree.')
    }

    let compiled = await compilePipeline(client, pipeline)
    const resultSchema = compiled.schema
    if (saveOriginalForHistory) {
      const sourceColumns = new Set(compiled.sourceSchema.map(({ name }) => name))
      const originalColumns = [...new Set(compiled.touchedColumns)]
        .filter((column) => sourceColumns.has(column))
      for (const column of originalColumns) {
        const originalName = `${column}_asli`
        if (compiled.sourceSchema.some((item) => item.name === originalName)
          || compiled.schema.some((item) => item.name === originalName)) {
          badRequest(400, 'Kolom nilai asli tidak dapat dibuat', `Kolom ${column}_asli tidak dapat ditambahkan tanpa benturan nama.`)
        }
      }
      compiled = originalColumns.length
        ? await compilePipeline(client, pipeline, { includeSourceColumns: originalColumns })
        : compiled
    }

    if (orderBy.length === 1) {
      const orderColumn = resultSchema.find((column) => column.name === orderBy[0])
      if (!orderColumn) {
        badRequest(400, 'Kolom ORDER BY tidak valid', 'Kolom ORDER BY harus dipilih dari skema hasil pipeline.')
      }
      if (/Nullable\s*\(/.test(orderColumn.type)) {
        badRequest(400, 'Kolom ORDER BY tidak boleh Nullable', 'Pilih kolom ORDER BY yang tidak bertipe Nullable.')
      }
    }

    const sourceIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(sourceTable)}`
    const sourceCount = await client.query({
      query: `SELECT count() AS total FROM ${sourceIdentifier}`,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 30 },
    })
    const [sourceCountRow] = await sourceCount.json<{ total: number | string }[]>()
    sourceRows = countValue(sourceCountRow?.total, 'jumlah baris sumber')

    const pipelineCount = await client.query({
      query: `SELECT count() AS total FROM (${compiled.sql})`,
      query_params: compiled.params,
      format: 'JSONEachRow',
      clickhouse_settings: buildClickHouseQuerySettings({ max_execution_time: 300, readonly: 1 }),
    })
    const [pipelineCountRow] = await pipelineCount.json<{ total: number | string }[]>()
    expectedResultRows = countValue(pipelineCountRow?.total, 'jumlah baris hasil pipeline')

    const tableIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(resultTableName)}`
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

    const columnSql = compiled.schema.map((column) => `${quoteIdentifier(column.name)} ${column.type}`).join(', ')
    const orderByClause = orderBy.length ? quoteIdentifier(orderBy[0]) : 'tuple()'

    await createMergeTreeTableSafe(
      client,
      `CREATE TABLE ${tableIdentifier} (${columnSql}) ENGINE ${engine} ORDER BY ${orderByClause}`,
      300,
    )
    resultTableCreated = true

    await client.command({
      query: `INSERT INTO ${tableIdentifier} SELECT * FROM (${compiled.sql})`,
      query_params: compiled.params,
      clickhouse_settings: buildClickHouseQuerySettings({ max_execution_time: 300 }),
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

    const requiredOriginalColumns = saveOriginalForHistory
      ? compiled.schema
        .filter(({ name }) => name.endsWith('_asli') && compiled.touchedColumns.some((column) => `${column}_asli` === name))
        .map(({ name }) => name)
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
      const expectedOriginalColumns = compiled.schema.filter(({ name }) => requiredOriginalColumns.includes(name))
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
      saveOriginal: saveOriginalForHistory,
      originalColumns: requiredOriginalColumns,
      steps: pipeline.steps.length,
      durationMs: Date.now() - startedAt,
      verification,
    }
  } catch (error) {
    let failureMessage = messageFromError(error)
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
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 500,
      statusMessage: 'Penerapan cleansing gagal',
      message: `Tabel hasil tidak dapat dibuat. ${failureMessage}`,
    })
  } finally {
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
})
