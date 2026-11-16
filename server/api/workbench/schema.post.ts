import { compilePipeline } from '../../workbench/compiler'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const pipeline = body && typeof body === 'object' && 'source' in body && 'steps' in body ? body as any : null

  if (!pipeline || !pipeline.source || !Array.isArray(pipeline.steps)) {
    throw createError({ statusCode: 400, statusMessage: 'Payload tidak valid', message: 'Body harus berisi source dan steps.' })
  }

  try {
    const compiled = await compilePipeline(useClickHouse(), pipeline)
    return {
      valid: true,
      source: pipeline.source,
      schema: compiled.schema,
      steps: compiled.stepSchemas,
      changesRowCount: compiled.changesRowCount,
      warnings: compiled.warnings,
    }
  } catch (error) {
    const message = error && typeof error === 'object' && 'message' in error ? String((error as { message?: string }).message) : 'Skema tidak valid.'
    return {
      valid: false,
      source: pipeline.source,
      error: message,
      steps: [],
    }
  }
})
