import { compilePipeline } from '../../workbench/compiler'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const pipeline = body && typeof body === 'object' && 'source' in body && 'steps' in body ? body as any : null

  if (!pipeline || !pipeline.source || !Array.isArray(pipeline.steps)) {
    throw createError({ statusCode: 400, statusMessage: 'Payload tidak valid', message: 'Body harus berisi source dan steps.' })
  }

  const stepNumber = Number(body.step ?? 1)
  const client = useClickHouse()
  const selectedSteps = pipeline.steps.slice(0, Math.max(0, stepNumber))
  const compiled = await compilePipeline(client, { ...pipeline, steps: selectedSteps })
  const touched = Array.isArray(body.touchedColumns) ? body.touchedColumns as string[] : []
  const stats: Record<string, { changed: number; becameNull: number; wasNullThenFilled: number }> = {}

  for (const column of touched.length ? touched : compiled.schema.map((item) => item.name)) {
    stats[column] = {
      changed: 0,
      becameNull: 0,
      wasNullThenFilled: 0,
    }
  }

  return {
    source: pipeline.source,
    step: stepNumber,
    totalRows: 0,
    stats,
    sql: compiled.sql,
  }
})
