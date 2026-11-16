import { compilePipeline } from '../../workbench/compiler'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const pipeline = body && typeof body === 'object' && 'source' in body && 'steps' in body ? body as any : null

  if (!pipeline || !pipeline.source || !Array.isArray(pipeline.steps)) {
    throw createError({ statusCode: 400, statusMessage: 'Payload tidak valid', message: 'Body harus berisi source dan steps.' })
  }

  const client = useClickHouse()
  const compiled = await compilePipeline(client, pipeline, { includeBefore: true })
  const requestedLimit = Number(body.limit ?? 50)
  if (!Number.isSafeInteger(requestedLimit)) {
    throw createError({ statusCode: 400, statusMessage: 'Batas pratinjau tidak valid', message: 'Batas baris pratinjau harus berupa bilangan bulat.' })
  }
  const limit = Math.min(Math.max(requestedLimit, 1), 100)
  const requestedPage = Number(body.page ?? 1)
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Halaman pratinjau tidak valid', message: 'Nomor halaman harus berupa bilangan bulat positif.' })
  }
  const page = requestedPage

  const totalRows = await client.query({
    query: `SELECT count() AS total FROM (${compiled.sql})`,
    query_params: compiled.params,
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: 1, max_execution_time: 30 },
  })
  const totalJson = await totalRows.json<{ total: number }[]>()
  const total = Number(totalJson[0]?.total ?? 0)
  const effectivePage = Math.min(page, Math.max(1, Math.ceil(total / limit)))
  const offset = (effectivePage - 1) * limit
  if (!Number.isSafeInteger(offset)) {
    throw createError({ statusCode: 400, statusMessage: 'Halaman pratinjau terlalu besar', message: 'Nomor halaman yang diminta berada di luar batas.' })
  }

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
    page: effectivePage,
    limit,
    warnings: compiled.warnings,
    changesRowCount: compiled.changesRowCount,
  }
})
