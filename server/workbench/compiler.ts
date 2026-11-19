import type { useClickHouse } from '../utils/clickhouse'
import { buildClickHouseQuerySettings } from '../utils/clickhouse'
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

function getStepReadColumns(op: string, params: Record<string, unknown>, writeColumns: string[]): string[] {
  const reads = new Set<string>(writeColumns)
  const addStr = (val: unknown) => {
    if (typeof val === 'string' && val.trim()) reads.add(val.trim())
  }
  if (op === 'trim_text' || op === 'replace_values') {
    addStr(params.column)
  } else if (op === 'fill_from_master' || op === 'extract_and_route' || op === 'fuzzy_match_master') {
    addStr(params.sourceColumn)
    addStr(params.targetColumn)
    addStr(params.unmatchedColumn)
  } else if (op === 'add_column') {
    addStr(params.orderColumn)
    if (Array.isArray(params.columns)) {
      for (const col of params.columns) addStr(col)
    }
  } else if (op === 'conditional_rule' && Array.isArray(params.rules)) {
    for (const rule of params.rules) {
      if (!rule || typeof rule !== 'object') continue
      const r = rule as Record<string, unknown>
      addStr(r.targetColumn)
      addStr(r.sourceColumn)
      if (Array.isArray(r.conditions)) {
        for (const cond of r.conditions) {
          if (cond && typeof cond === 'object') {
            addStr((cond as Record<string, unknown>).column)
          }
        }
      }
    }
  }
  return [...reads]
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
    clickhouse_settings: buildClickHouseQuerySettings({ max_execution_time: 60, readonly: 1 }),
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
        message: 'Kolom sumber memiliki nama yang bertabrakan dengan kolom sementara pipeline.',
      })
    }
  }
  const initialSql = buildInputSql(pipeline.source)
  let currentSql = sourceColumns.length
    ? `SELECT *, ${sourceColumns.map((column) => `${quoteIdentifier(column)} AS ${quoteIdentifier(`__sumber_${column}`)}`).join(', ')} FROM (${initialSql})`
    : initialSql
  const boundParams: Record<string, unknown> = {}
  const stepEntries: Array<{
    stepTemplateSql: string
    readColumns: string[]
    writeColumns: string[]
    isRowFilter: boolean
    requiresFullHistory: boolean
    snapshotSql: string
    snapshotParams: Record<string, unknown>
  }> = []
  const getColumnSourceSql = (column: string): { sql: string; params: Record<string, unknown> } => {
    const neededCols = new Set<string>([column])
    const selectedIndices: number[] = []
    let fallbackToFullSnapshotAt = -1

    for (let j = stepEntries.length - 1; j >= 0; j -= 1) {
      const entry = stepEntries[j]
      if (entry.isRowFilter) continue
      const writesNeeded = entry.writeColumns.some((col) => neededCols.has(col))
      if (!writesNeeded) continue
      if (entry.requiresFullHistory) {
        fallbackToFullSnapshotAt = j
        break
      }
      selectedIndices.push(j)
      for (const readCol of entry.readColumns) {
        neededCols.add(readCol)
      }
    }

    if (fallbackToFullSnapshotAt >= 0) {
      const snap = stepEntries[fallbackToFullSnapshotAt]
      let slicedSql = snap.snapshotSql
      for (let k = selectedIndices.length - 1; k >= 0; k -= 1) {
        slicedSql = stepEntries[selectedIndices[k]].stepTemplateSql.replace(/__INPUT__/g, `(${slicedSql})`)
      }
      return { sql: slicedSql, params: { ...boundParams } }
    }

    if (selectedIndices.length === 0) {
      return { sql: initialSql, params: {} }
    }

    let slicedSql = initialSql
    for (let k = selectedIndices.length - 1; k >= 0; k -= 1) {
      slicedSql = stepEntries[selectedIndices[k]].stepTemplateSql.replace(/__INPUT__/g, `(${slicedSql})`)
    }
    return { sql: slicedSql, params: { ...boundParams } }
  }
  const touchedColumns = new Set<string>()
  const addedColumns = new Set<string>()
  const warnings: string[] = []
  let changesRowCount = false

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
        inputSql: currentSql,
        inputParams: { ...boundParams },
        getColumnSourceSql,
      }
      await operation.validate(context)
      const compiled = await operation.compile(context)
      changesRowCount ||= operation.changesRowCount === true
      for (const warning of compiled.warnings ?? []) warnings.push(`Langkah ${index + 1}: ${warning}`)
      const stepTouchedColumns = [...new Set(compiled.touchedColumns)]
      const stepAddedColumns = [...new Set(compiled.addedColumns)]
      for (const column of stepTouchedColumns) touchedColumns.add(column)
      for (const column of stepAddedColumns) addedColumns.add(column)
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
      const writeColumns = [...new Set([...stepTouchedColumns, ...stepAddedColumns])]
      const requiresFullHistory = (step.op === 'add_column' && step.params?.kind === 'sequence')
        || step.op === 'fuzzy_match_master'
      stepEntries.push({
        stepTemplateSql: stepSql,
        readColumns: getStepReadColumns(step.op, step.params ?? {}, writeColumns),
        writeColumns,
        isRowFilter: operation.changesRowCount === true,
        requiresFullHistory,
        snapshotSql: currentSql,
        snapshotParams: { ...boundParams },
      })
      stepSchemas.push({
        index,
        valid: true,
        schema,
        warnings: compiled.warnings ?? [],
      })
    } catch (error) {
      const detail = error && typeof error === 'object' && 'message' in error ? String((error as { message?: string }).message) : ''
      stepSchemas.push({
        index,
        valid: false,
        error: detail || 'Langkah tidak valid.',
      })
      const stepPrefix = `Langkah ${index + 1}: `
      invalidStep(index + 1, detail.startsWith(stepPrefix) ? detail.slice(stepPrefix.length) : detail || 'Langkah tidak valid.')
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
    changesRowCount,
    warnings,
  }
}
