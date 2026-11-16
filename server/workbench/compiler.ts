import type { useClickHouse } from '../utils/clickhouse'
import { buildInputSql, getTableColumns, getTableMetadata, isSystemDatabase, quoteIdentifier } from './utils'
import { operations } from './ops'
import type { ColumnMetadata, CompiledPipeline, Pipeline, StepSchemaStatus } from './types'

function invalidStep(stepNumber: number, message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: `Langkah ${stepNumber} tidak valid`,
    message: `Langkah ${stepNumber}: ${message}`,
  })
}

async function resolveSchema(client: ReturnType<typeof useClickHouse>, sql: string): Promise<ColumnMetadata[]> {
  const result = await client.query({
    query: `SELECT * FROM (${sql}) LIMIT 0`,
    format: 'JSON',
    clickhouse_settings: { readonly: 1, max_execution_time: 30 },
  })
  const json = await result.json<{ meta?: Array<{ name: string; type: string }> }>()
  const meta = json.meta ?? []
  return meta.map((column) => ({
    name: column.name,
    type: column.type,
    default_kind: undefined,
  }))
}

export async function compilePipeline(
  client: ReturnType<typeof useClickHouse>,
  pipeline: Pipeline,
  options: { includeBefore?: boolean } = {},
): Promise<CompiledPipeline> {
  if (!pipeline || !pipeline.source || !pipeline.source.database || !pipeline.source.table) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Sumber data tidak valid',
      message: 'Sumber data harus berisi database dan tabel yang valid.',
    })
  }

  if (isSystemDatabase(pipeline.source.database)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Database sumber tidak valid',
      message: 'Database sumber tidak boleh berasal dari database sistem atau aplikasi.',
    })
  }

  const metadata = await getTableMetadata(client, pipeline.source)
  let schema = await getTableColumns(client, pipeline.source)
  const stepSchemas: StepSchemaStatus[] = []
  let currentSql = buildInputSql(pipeline.source)
  const boundParams: Record<string, unknown> = {}

  for (let index = 0; index < pipeline.steps.length; index += 1) {
    const step = pipeline.steps[index]
    const operation = operations[step.op]
    if (!operation) {
      invalidStep(index + 1, `Operasi "${String(step.op)}" tidak dikenal.`)
    }

    try {
      const context = {
        client,
        source: pipeline.source,
        schema,
        params: step.params ?? {},
        metadata,
      }
      await operation.validate(context)
      const compiled = await operation.compile(context)
      const includeBefore = options.includeBefore && index === pipeline.steps.length - 1
      const beforeColumns = [...new Set(compiled.beforeColumns ?? compiled.touchedColumns)]
      const beforeAliases = includeBefore
        ? beforeColumns.map((column) => `__sebelum_${column}`)
        : []

      for (const alias of beforeAliases) {
        if (schema.some((column) => column.name === alias)) {
          invalidStep(index + 1, `Kolom sementara ${alias} sudah ada pada skema masukan.`)
        }
      }

      const inputSql = beforeColumns.length && includeBefore
        ? `SELECT *, ${beforeColumns.map((column) => `${quoteIdentifier(column)} AS ${quoteIdentifier(`__sebelum_${column}`)}`).join(', ')} FROM (${currentSql})`
        : currentSql
      const nextSql = compiled.sql.replace(/__INPUT__/g, `(${inputSql})`)
      currentSql = nextSql

      for (const [key, value] of Object.entries(compiled.params)) {
        boundParams[key] = value
      }

      schema = await resolveSchema(client, currentSql)
      stepSchemas.push({
        index,
        valid: true,
        schema,
      })
    } catch (error) {
      const detail = error && typeof error === 'object' && 'message' in error ? String((error as { message?: string }).message) : ''
      stepSchemas.push({
        index,
        valid: false,
        error: detail || 'Langkah tidak valid.',
      })
      invalidStep(index + 1, detail || 'Langkah tidak valid.')
    }
  }

  return {
    source: pipeline.source,
    sql: currentSql,
    params: boundParams,
    schema,
    stepSchemas,
  }
}
