import { compilePipeline } from '../../workbench/compiler'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const pipeline = body && typeof body === 'object' && 'source' in body && 'steps' in body ? body as any : null

  if (!pipeline || !pipeline.source || !Array.isArray(pipeline.steps)) {
    throw createError({ statusCode: 400, statusMessage: 'Payload tidak valid', message: 'Body harus berisi source dan steps.' })
  }

  const compiled = await compilePipeline(useClickHouse(), pipeline)
  return {
    source: pipeline.source,
    sql: compiled.sql,
    params: compiled.params,
    schema: compiled.schema,
  }
})
