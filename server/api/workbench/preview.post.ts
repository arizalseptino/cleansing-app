import { compilePipeline } from '../../workbench/compiler'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const pipeline = body && typeof body === 'object' && 'source' in body && 'steps' in body ? body as any : null

  if (!pipeline || !pipeline.source || !Array.isArray(pipeline.steps)) {
    throw createError({ statusCode: 400, statusMessage: 'Payload tidak valid', message: 'Body harus berisi source dan steps.' })
  }

  const client = useClickHouse()
  const compiled = await compilePipeline(client, pipeline, { includeBefore: true })
  const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 100)
  const page = Math.max(Number(body.page ?? 1), 1)
  const offset = (page - 1) * limit

  const totalRows = await client.query({
    query: `SELECT count() AS total FROM (${compiled.sql})`,
    query_params: compiled.params,
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: 1, max_execution_time: 30 },
  })
  const totalJson = await totalRows.json<{ total: number }[]>()
  const total = totalJson[0]?.total ?? 0

  const rowsResult = await client.query({
    query: `SELECT * FROM (${compiled.sql}) LIMIT ${limit} OFFSET ${offset}`,
    query_params: compiled.params,
    format: 'JSON',
    clickhouse_settings: { readonly: 1, max_execution_time: 30 },
  })
  const rowsPayload = await rowsResult.json<any>()
  const columns = rowsPayload.meta?.map((meta: { name: string }) => meta.name) ?? []
  const rows = Array.isArray(rowsPayload.data) ? rowsPayload.data : []

  return {
    columns,
    rows,
    totalRows: total,
    page,
    limit,
  }
})
