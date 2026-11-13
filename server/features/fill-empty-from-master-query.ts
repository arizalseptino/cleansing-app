import type { useClickHouse } from '../utils/clickhouse'
import {
  quoteIdentifier,
  quoteSortingKey,
  requiredParameter,
  validateDatabase,
  validateTable,
  validateTextColumn,
  type ColumnMetadata,
  type TableMetadata,
} from './metadata'
import type { FeaturePreview } from './types'

const previewSettings = {
  readonly: 1,
  max_execution_time: 30,
  max_result_rows: 60,
}

export type FillEmptyPlan = {
  sourceDatabase: string
  sourceTable: string
  sourceIdentifier: string
  sourceMetadata: TableMetadata
  sourceFinal: string
  masterIdentifier: string
  masterMetadata: TableMetadata
  sourceColumns: ColumnMetadata[]
  targetColumn: string
  targetType: string
  targetDefaultKind: string
  masterValues: string
  classifyRows: (tableIdentifier: string, targetBeforeField: string) => string
  aliases: {
    sourceText: string
    targetBefore: string
    targetEmpty: string
    sourceFilled: string
    matches: string
    bestMatches: string
    ambiguous: string
    suggestion: string
    matchedKey: string
    category: string
    keyColumns: { name: string; valueKey: string }[]
  }
  sortingKeyExpression: string
}

export type PreviewStatistics = {
  sourceRows: number
  targetEmptyRows: number
  fillableRows: number
  nonEmptyFillableRows: number
  ambiguousRows: number
  remainingEmptyRows: number
}

function isHttpError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'statusCode' in error
    && typeof error.statusCode === 'number',
  )
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message, message })
}

function resultError(message: string): never {
  throw createError({ statusCode: 500, statusMessage: message, message })
}

function queryError(error: unknown, fallback: string): never {
  if (isHttpError(error)) throw error
  const detail = error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 320) : ''
  resultError(detail ? `${fallback} Detail ClickHouse: ${detail}` : fallback)
}

function useFinal(metadata: TableMetadata): boolean {
  return /^(?:Replicated)?ReplacingMergeTree$/.test(metadata.engine)
}

function allocateAlias(base: string, used: Set<string>): string {
  let name = base
  while (used.has(name)) name += '_'
  used.add(name)
  return name
}

async function getColumns(
  client: ReturnType<typeof useClickHouse>,
  database: string,
  table: string,
): Promise<ColumnMetadata[]> {
  try {
    const result = await client.query({
      query: `
        SELECT name, type, default_kind
        FROM system.columns
        WHERE database = {database:String} AND table = {table:String}
        ORDER BY position
      `,
      query_params: { database, table },
      format: 'JSONEachRow',
      clickhouse_settings: previewSettings,
    })
    return await result.json<ColumnMetadata[]>()
  } catch {
    resultError('Daftar kolom tabel sumber tidak dapat dibaca dari ClickHouse.')
  }
}

export async function buildFillEmptyPlan(
  client: ReturnType<typeof useClickHouse>,
  rawParameters: Record<string, unknown>,
): Promise<FillEmptyPlan> {
  const sourceDatabase = requiredParameter(rawParameters, 'sourceDatabase', 'Database sumber')
  const sourceTable = requiredParameter(rawParameters, 'sourceTable', 'Tabel sumber')
  const sourceColumn = requiredParameter(rawParameters, 'sourceColumn', 'Kolom sumber teks')
  const targetColumn = requiredParameter(rawParameters, 'targetColumn', 'Kolom target')
  const masterDatabase = requiredParameter(rawParameters, 'masterDatabase', 'Database master')
  const masterTable = requiredParameter(rawParameters, 'masterTable', 'Tabel master')
  const masterColumn = requiredParameter(rawParameters, 'masterColumn', 'Kolom kunci pencarian')
  const rawFillColumn = rawParameters.masterFillColumn
  if (rawFillColumn !== undefined && rawFillColumn !== null && typeof rawFillColumn !== 'string') {
    badRequest('Kolom nilai pengisi harus berupa pilihan kolom teks.')
  }
  const masterFillColumn = typeof rawFillColumn === 'string' && rawFillColumn.trim()
    ? rawFillColumn
    : masterColumn

  if (sourceColumn === targetColumn) {
    badRequest('Kolom sumber dan kolom target harus berbeda.')
  }

  await Promise.all([
    validateDatabase(client, sourceDatabase),
    validateDatabase(client, masterDatabase),
  ])
  const [sourceMetadata, masterMetadata, sourceColumns] = await Promise.all([
    validateTable(client, sourceDatabase, sourceTable),
    validateTable(client, masterDatabase, masterTable),
    getColumns(client, sourceDatabase, sourceTable),
  ])
  await Promise.all([
    validateTextColumn(client, sourceDatabase, sourceTable, sourceColumn, 'sumber'),
    validateTextColumn(client, sourceDatabase, sourceTable, targetColumn, 'target'),
    validateTextColumn(client, masterDatabase, masterTable, masterColumn, 'kunci pencarian'),
    ...(masterFillColumn === masterColumn
      ? []
      : [validateTextColumn(client, masterDatabase, masterTable, masterFillColumn, 'nilai pengisi')]),
  ])

  const targetColumnMetadata = sourceColumns.find(({ name }) => name === targetColumn)
  if (!targetColumnMetadata) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Kolom target tidak ditemukan',
      message: 'Kolom target tidak ditemukan pada tabel sumber.',
    })
  }

  const sorting = sourceMetadata.sorting_key.trim()
    && !/^tuple\(\)$/i.test(sourceMetadata.sorting_key.trim())
    ? quoteSortingKey(sourceMetadata.sorting_key, sourceColumns)
    : { expression: '', columns: [] as string[] }

  const aliasesUsed = new Set(sourceColumns.map(({ name }) => name))
  aliasesUsed.add(`${targetColumn}_asli`)
  const aliases = {
    sourceText: allocateAlias('__bd_source_text', aliasesUsed),
    targetBefore: allocateAlias('__bd_target_before', aliasesUsed),
    targetEmpty: allocateAlias('__bd_target_empty', aliasesUsed),
    sourceFilled: allocateAlias('__bd_source_filled', aliasesUsed),
    matches: allocateAlias('__bd_matches', aliasesUsed),
    bestMatches: allocateAlias('__bd_best_matches', aliasesUsed),
    ambiguous: allocateAlias('__bd_ambiguous', aliasesUsed),
    suggestion: allocateAlias('__bd_suggested_value', aliasesUsed),
    matchedKey: allocateAlias('__bd_matched_master_key', aliasesUsed),
    category: allocateAlias('__bd_category', aliasesUsed),
    keyColumns: sorting.columns.map((name, index) => ({
      name,
      valueKey: allocateAlias(`__bd_key_${index}`, aliasesUsed),
    })),
  }

  const sourceIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(sourceTable)}`
  const masterIdentifier = `${quoteIdentifier(masterDatabase)}.${quoteIdentifier(masterTable)}`
  const sourceFinal = useFinal(sourceMetadata) ? ' FINAL' : ''
  const masterFinal = useFinal(masterMetadata) ? ' FINAL' : ''
  const sourceField = quoteIdentifier(sourceColumn)
  const targetField = quoteIdentifier(targetColumn)
  const masterField = quoteIdentifier(masterColumn)
  const masterFillField = quoteIdentifier(masterFillColumn)
  const masterValues = `
    (SELECT arraySort(item -> tuple(-lengthUTF8(tupleElement(item, 1)), tupleElement(item, 1), tupleElement(item, 2)),
                      groupUniqArray((search_key, fill_value)))
     FROM (
       SELECT
         toString(trimBoth(assumeNotNull(${masterField}))) AS search_key,
         toString(assumeNotNull(${masterFillField})) AS fill_value
       FROM ${masterIdentifier}${masterFinal}
       WHERE ${masterField} IS NOT NULL
         AND notEmpty(trimBoth(${masterField}))
     ))
  `

  function classifyRows(tableIdentifier: string, targetBeforeField: string): string {
    const quotedSourceAlias = quoteIdentifier(aliases.sourceText)
    const targetBefore = targetBeforeField
    const sourceTrimmed = `trimBoth(ifNull(${sourceField}, ''))`
    const projectedSourceTrimmed = `trimBoth(ifNull(${quotedSourceAlias}, ''))`
    const targetEmpty = `(isNull(${targetBefore}) OR trimBoth(ifNull(${targetBefore}, '')) = '')`
    const matchExpression = `arrayFilter(item -> positionCaseInsensitiveUTF8(${projectedSourceTrimmed}, tupleElement(item, 1)) > 0, master_values)`
    const matchedKeys = `arrayDistinct(arrayMap(item -> tupleElement(item, 1), ${quoteIdentifier(aliases.bestMatches)}))`
    const matchedFillValues = `arrayDistinct(arrayMap(item -> tupleElement(item, 2), ${quoteIdentifier(aliases.bestMatches)}))`
    const isAmbiguous = `(length(${matchedKeys}) > 1 AND length(${matchedFillValues}) > 1)`
    const keyProjection = aliases.keyColumns.map(({ name, valueKey }) => (
      `${quoteIdentifier(name)} AS ${quoteIdentifier(valueKey)}`
    ))
    const sourceProjection = sourceColumns.map(({ name }) => quoteIdentifier(name))
    const beforeSelect = [
      ...sourceProjection,
      ...keyProjection,
      `${sourceField} AS ${quotedSourceAlias}`,
      `${targetBefore} AS ${quoteIdentifier(aliases.targetBefore)}`,
      `${targetEmpty} AS ${quoteIdentifier(aliases.targetEmpty)}`,
      `notEmpty(${sourceTrimmed}) AS ${quoteIdentifier(aliases.sourceFilled)}`,
    ]

    return `
      SELECT
        *,
        if(length(${quoteIdentifier(aliases.bestMatches)}) > 0
          AND NOT ${quoteIdentifier(aliases.ambiguous)},
          tupleElement(arrayElement(${quoteIdentifier(aliases.bestMatches)}, 1), 2), '') AS ${quoteIdentifier(aliases.suggestion)},
        if(
          ${quoteIdentifier(aliases.ambiguous)},
          arrayStringConcat(arrayDistinct(arrayMap(
            item -> tupleElement(item, 1),
            ${quoteIdentifier(aliases.bestMatches)}
          )), ', '),
          if(length(${quoteIdentifier(aliases.bestMatches)}) > 0,
            tupleElement(arrayElement(${quoteIdentifier(aliases.bestMatches)}, 1), 1), '')
        ) AS ${quoteIdentifier(aliases.matchedKey)},
        multiIf(
          NOT ${quoteIdentifier(aliases.targetEmpty)}, '',
          ${quoteIdentifier(aliases.ambiguous)}, 'ambiguous',
          NOT ${quoteIdentifier(aliases.sourceFilled)}
            OR length(${quoteIdentifier(aliases.matches)}) = 0, 'remainingEmpty',
          'fillable'
        ) AS ${quoteIdentifier(aliases.category)}
      FROM (
        SELECT
          *,
          ${isAmbiguous} AS ${quoteIdentifier(aliases.ambiguous)}
        FROM (
          SELECT
            *,
            if(length(${quoteIdentifier(aliases.matches)}) > 0,
              arrayFilter(item ->
                lengthUTF8(tupleElement(item, 1)) = lengthUTF8(tupleElement(
                  arrayElement(${quoteIdentifier(aliases.matches)}, 1), 1
                )),
                ${quoteIdentifier(aliases.matches)}
              ),
              CAST([], 'Array(Tuple(String, String))')
            ) AS ${quoteIdentifier(aliases.bestMatches)}
          FROM (
            SELECT
              *,
              ${matchExpression} AS ${quoteIdentifier(aliases.matches)}
            FROM (
              SELECT ${beforeSelect.join(',\n                ')}
              FROM ${tableIdentifier}${sourceFinal}
            )
          )
        )
      )
    `
  }

  return {
    sourceDatabase,
    sourceTable,
    sourceIdentifier,
    sourceMetadata,
    sourceFinal,
    masterIdentifier,
    masterMetadata,
    sourceColumns,
    targetColumn,
    targetType: targetColumnMetadata.type,
    targetDefaultKind: targetColumnMetadata.default_kind ?? '',
    masterValues,
    classifyRows,
    aliases,
    sortingKeyExpression: sorting.expression,
  }
}

function numberValue(value: number | string | undefined, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    resultError(`ClickHouse mengembalikan ${label} yang tidak valid.`)
  }
  return parsed
}

export async function getFillEmptyStatistics(
  client: ReturnType<typeof useClickHouse>,
  plan: FillEmptyPlan,
  tableIdentifier = plan.sourceIdentifier,
  targetBeforeField = quoteIdentifier(plan.targetColumn),
  maxExecutionTime = 30,
): Promise<PreviewStatistics> {
  try {
    const result = await client.query({
      query: `
        WITH ${plan.masterValues} AS master_values
        SELECT
          count() AS sourceRows,
          countIf(${quoteIdentifier(plan.aliases.targetEmpty)}) AS targetEmptyRows,
          countIf(${quoteIdentifier(plan.aliases.category)} = 'fillable') AS fillableRows,
          countIf(
            ${quoteIdentifier(plan.aliases.category)} = 'fillable'
            AND notEmpty(trimBoth(${quoteIdentifier(plan.aliases.suggestion)}))
          ) AS nonEmptyFillableRows,
          countIf(${quoteIdentifier(plan.aliases.category)} = 'ambiguous') AS ambiguousRows,
          countIf(${quoteIdentifier(plan.aliases.category)} = 'remainingEmpty') AS remainingEmptyRows
        FROM (${plan.classifyRows(tableIdentifier, targetBeforeField)})
      `,
      format: 'JSONEachRow',
      clickhouse_settings: {
        readonly: 1,
        max_execution_time: maxExecutionTime,
      },
    })
    const [stats] = await result.json<Record<string, number | string>>()
    if (!stats) resultError('Statistik pratinjau tidak tersedia dari ClickHouse.')
    return {
      sourceRows: numberValue(stats.sourceRows, 'jumlah baris sumber'),
      targetEmptyRows: numberValue(stats.targetEmptyRows, 'jumlah target kosong'),
      fillableRows: numberValue(stats.fillableRows, 'jumlah baris bisa diisi'),
      nonEmptyFillableRows: numberValue(stats.nonEmptyFillableRows, 'jumlah usulan yang tidak kosong'),
      ambiguousRows: numberValue(stats.ambiguousRows, 'jumlah baris ambigu'),
      remainingEmptyRows: numberValue(stats.remainingEmptyRows, 'jumlah baris tetap kosong'),
    }
  } catch (error) {
    queryError(error, 'Statistik cleansing tidak dapat dihitung.')
  }
}

export async function previewFillEmptyFromMasterText(
  client: ReturnType<typeof useClickHouse>,
  rawParameters: Record<string, unknown>,
): Promise<FeaturePreview> {
  const plan = await buildFillEmptyPlan(client, rawParameters)
  const statistics = await getFillEmptyStatistics(client, plan)
  try {
    const examplesResult = await client.query({
      query: `
        WITH ${plan.masterValues} AS master_values
        SELECT
          ${[
            ...plan.aliases.keyColumns.map(({ valueKey }) => quoteIdentifier(valueKey)),
            quoteIdentifier(plan.aliases.sourceText),
            quoteIdentifier(plan.aliases.targetBefore),
            quoteIdentifier(plan.aliases.suggestion),
            quoteIdentifier(plan.aliases.matchedKey),
            quoteIdentifier(plan.aliases.category),
            `row_number() OVER (
              PARTITION BY ${quoteIdentifier(plan.aliases.category)}
              ORDER BY ${plan.sortingKeyExpression || 'tuple()'}
            ) AS sample_number`,
          ].join(',\n          ')}
        FROM (${plan.classifyRows(plan.sourceIdentifier, quoteIdentifier(plan.targetColumn))})
        WHERE ${quoteIdentifier(plan.aliases.category)} != ''
        QUALIFY sample_number <= 20
        ORDER BY ${quoteIdentifier(plan.aliases.category)}, sample_number
      `,
      format: 'JSONEachRow',
      clickhouse_settings: previewSettings,
    })
    const rows = await examplesResult.json<Record<string, unknown>[]>()
    const examples: FeaturePreview['examples'] = {
      fillable: [],
      ambiguous: [],
      remainingEmpty: [],
    }
    for (const row of rows) {
      const {
        [plan.aliases.category]: category,
        sample_number: _sampleNumber,
        ...example
      } = row
      if (category === 'fillable' || category === 'ambiguous' || category === 'remainingEmpty') {
        examples[category].push(example)
      }
    }

    const {
      nonEmptyFillableRows: _nonEmptyFillableRows,
      ...previewStatistics
    } = statistics
    return {
      statistics: previewStatistics,
      keyColumns: plan.aliases.keyColumns,
      sourceColumn: String(rawParameters.sourceColumn),
      targetColumn: plan.targetColumn,
      examples,
      orderedBySortingKey: Boolean(plan.sortingKeyExpression),
    }
  } catch (error) {
    queryError(error, 'Contoh pratinjau tidak dapat dimuat.')
  }
}

