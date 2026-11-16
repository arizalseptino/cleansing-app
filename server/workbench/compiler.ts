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

async function resolveSchema(
  client: ReturnType<typeof useClickHouse>,
  sql: string,
  params: Record<string, unknown>,
): Promise<ColumnMetadata[]> {
  const result = await client.query({
    query: `SELECT * FROM (${sql}) LIMIT 0`,
    query_params: params,
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
  options: { includeBefore?: boolean; includeSourceColumns?: string[] } = {},
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
  const sourceSchema = await getTableColumns(client, pipeline.source)
  let schema = sourceSchema
  const stepSchemas: StepSchemaStatus[] = []
  const sourceColumns = [...new Set(options.includeSourceColumns ?? [])]
  for (const column of sourceColumns) {
    if (!sourceSchema.some((item) => item.name === column)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Kolom pembanding tidak valid',
        message: 'Kolom pembanding harus berasal dari skema tabel sumber.',
      })
    }
    if (sourceSchema.some((item) => item.name === `__sumber_${column}`)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nama kolom sementara bertabrakan',
        message: 'Kolom sumber memiliki nama yang bertabrakan dengan kolom statistik sementara.',
      })
    }
  }
  const initialSql = buildInputSql(pipeline.source)
  let currentSql = sourceColumns.length
    ? `SELECT *, ${sourceColumns.map((column) => `${quoteIdentifier(column)} AS ${quoteIdentifier(`__sumber_${column}`)}`).join(', ')} FROM (${initialSql})`
    : initialSql
  const boundParams: Record<string, unknown> = {}
  const touchedColumns = new Set<string>()
  const addedColumns = new Set<string>()
  let lastStepTouchedColumns: string[] = []
  let lastStepAddedColumns: string[] = []

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
      lastStepTouchedColumns = [...new Set(compiled.touchedColumns)]
      lastStepAddedColumns = [...new Set(compiled.addedColumns)]
      for (const column of lastStepTouchedColumns) touchedColumns.add(column)
      for (const column of lastStepAddedColumns) addedColumns.add(column)
      const includeBefore = options.includeBefore && index === pipeline.steps.length - 1
      const beforeColumns = [...new Set(compiled.beforeColumns ?? compiled.touchedColumns)]
      const beforeAliases = includeBefore
        ? beforeColumns.map((column) => `__sebelum_${column}`)
        : []
      const reservedAliases = [
        ...sourceColumns.map((column) => `__sumber_${column}`),
        ...beforeAliases,
      ]

      for (const alias of beforeAliases) {
        if (schema.some((column) => column.name === alias)) {
          invalidStep(index + 1, `Kolom sementara ${alias} sudah ada pada skema masukan.`)
        }
      }
      if (compiled.addedColumns.some((column) => reservedAliases.includes(column))) {
        invalidStep(index + 1, 'Nama kolom baru bertabrakan dengan kolom sementara pipeline.')
      }

      const inputSql = beforeColumns.length && includeBefore
        ? `SELECT *, ${beforeColumns.map((column) => `${quoteIdentifier(column)} AS ${quoteIdentifier(`__sebelum_${column}`)}`).join(', ')} FROM (${currentSql})`
        : currentSql
      let stepSql = compiled.sql
      for (const [key, value] of Object.entries(compiled.params)) {
        const parameterName = `wb_s${index}_${key}`
        stepSql = stepSql.replace(new RegExp(`\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'g'), `{${parameterName}:`)
        boundParams[parameterName] = value
      }
      const nextSql = stepSql.replace(/__INPUT__/g, `(${inputSql})`)
      currentSql = nextSql

      schema = await resolveSchema(client, currentSql, boundParams)
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
    sourceSchema,
    stepSchemas,
    touchedColumns: [...touchedColumns],
    addedColumns: [...addedColumns],
    lastStepTouchedColumns,
    lastStepAddedColumns,
  }
}
