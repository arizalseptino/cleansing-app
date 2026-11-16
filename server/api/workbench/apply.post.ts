import { compilePipeline } from '../../workbench/compiler'
import { quoteIdentifier } from '../../workbench/utils'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const pipeline = body && typeof body === 'object' && 'source' in body && 'steps' in body ? body as any : null

  if (!pipeline || !pipeline.source || !Array.isArray(pipeline.steps)) {
    throw createError({ statusCode: 400, statusMessage: 'Payload tidak valid', message: 'Body harus berisi source dan steps.' })
  }

  const client = useClickHouse()
  const resultTableName = String(body.resultTableName ?? body.tableName ?? 'hasil_cleansing')
  const engine = String(body.engine ?? 'MergeTree')
  const orderBy = Array.isArray(body.orderBy) ? body.orderBy as string[] : []
  const saveOriginal = Boolean(body.saveOriginal)

  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(resultTableName)) {
    throw createError({ statusCode: 400, statusMessage: 'Nama tabel hasil tidak valid', message: 'Nama tabel hasil harus diawali huruf, maksimal 64 karakter, dan hanya berisi huruf, angka, atau garis bawah.' })
  }

  const compiled = await compilePipeline(client, pipeline)
  const targetDatabase = pipeline.source.database
  const tableIdentifier = `${quoteIdentifier(targetDatabase)}.${quoteIdentifier(resultTableName)}`

  const existing = await client.query({
    query: 'SELECT name FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
    query_params: { database: targetDatabase, table: resultTableName },
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: 1, max_execution_time: 15 },
  })
  const found = await existing.json<{ name: string }[]>()
  if (found.length > 0) {
    throw createError({ statusCode: 409, statusMessage: 'Tabel hasil sudah ada', message: 'Nama tabel hasil sudah digunakan. Pilih nama lain agar tabel yang sudah ada tidak diubah.' })
  }

  const columnSql = compiled.schema.map((column) => `${quoteIdentifier(column.name)} ${column.type}`).join(', ')
  const orderByClause = orderBy.length
    ? orderBy.map((key) => quoteIdentifier(key)).join(', ')
    : 'tuple()'

  await client.command({
    query: `CREATE TABLE ${tableIdentifier} (${columnSql}) ENGINE ${engine} ORDER BY ${orderByClause}`,
    clickhouse_settings: { max_execution_time: 180 },
  })

  try {
    await client.command({
      query: `INSERT INTO ${tableIdentifier} SELECT * FROM (${compiled.sql})`,
      clickhouse_settings: { max_execution_time: 180 },
    })
  } catch (error) {
    await client.command({ query: `DROP TABLE ${tableIdentifier}`, clickhouse_settings: { max_execution_time: 30 } }).catch(() => undefined)
    throw error
  }

  const countResult = await client.query({
    query: `SELECT count() AS total FROM ${tableIdentifier}`,
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: 1, max_execution_time: 30 },
  })
  const totalRows = (await countResult.json<{ total: number }[]>())[0]?.total ?? 0

  return {
    status: 'ok',
    database: targetDatabase,
    table: resultTableName,
    engine,
    rows: totalRows,
    saveOriginal,
    steps: pipeline.steps.length,
  }
})
