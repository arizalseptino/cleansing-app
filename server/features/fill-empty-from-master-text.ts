import type { CleansingFeature, FeaturePreview } from './types'
import {
  quoteIdentifier,
  quoteSortingKey,
  requiredParameter,
  validateDatabase,
  validateTable,
  validateTextColumn,
} from './metadata'

const feature: CleansingFeature = {
  id: 'fill-empty-from-master-text',
  name: 'Isi kolom kosong dari teks kolom lain berdasarkan tabel master',
  description: 'Mencari nilai master di dalam kolom teks sumber dan menyarankannya untuk target yang kosong.',
  parameters: [
    { key: 'sourceDatabase', label: 'Database sumber', description: 'Database yang dipilih pada sumber data.', kind: 'source-database' },
    { key: 'sourceTable', label: 'Tabel sumber', description: 'Tabel yang dipilih pada sumber data.', kind: 'source-table' },
    { key: 'sourceColumn', label: 'Kolom sumber teks', description: 'Kolom teks tempat pencarian nilai master dilakukan.', kind: 'source-column' },
    { key: 'targetColumn', label: 'Kolom target kosong', description: 'Kolom teks yang akan diperiksa apakah masih kosong.', kind: 'source-column' },
    { key: 'masterDatabase', label: 'Database master', description: 'Database yang berisi tabel nilai master.', kind: 'master-database' },
    { key: 'masterTable', label: 'Tabel master', description: 'Tabel yang menyediakan nilai untuk dicari.', kind: 'master-table' },
    { key: 'masterColumn', label: 'Kolom kunci pencarian', description: 'Kolom teks yang nilainya dicari di dalam teks sumber.', kind: 'master-column' },
    { key: 'masterFillColumn', label: 'Kolom nilai pengisi', description: 'Kolom teks opsional yang nilainya akan disarankan untuk target.', kind: 'master-column', optional: true },
  ],
  preview,
}

const querySettings = {
  readonly: 1,
  max_execution_time: 30,
  max_result_rows: 60,
}

function numberValue(value: number | string | undefined): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Hasil pratinjau tidak valid',
      message: 'ClickHouse mengembalikan statistik yang tidak valid.',
    })
  }
  return parsed
}

function isHttpError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'statusCode' in error
    && typeof error.statusCode === 'number',
  )
}

async function preview(
  client: ReturnType<typeof useClickHouse>,
  rawParameters: Record<string, unknown>,
): Promise<FeaturePreview> {
  const sourceDatabase = requiredParameter(rawParameters, 'sourceDatabase', 'Database sumber')
  const sourceTable = requiredParameter(rawParameters, 'sourceTable', 'Tabel sumber')
  const sourceColumn = requiredParameter(rawParameters, 'sourceColumn', 'Kolom sumber teks')
  const targetColumn = requiredParameter(rawParameters, 'targetColumn', 'Kolom target')
  const masterDatabase = requiredParameter(rawParameters, 'masterDatabase', 'Database master')
  const masterTable = requiredParameter(rawParameters, 'masterTable', 'Tabel master')
  const masterColumn = requiredParameter(rawParameters, 'masterColumn', 'Kolom kunci pencarian')
  const rawFillColumn = rawParameters.masterFillColumn
  if (rawFillColumn !== undefined && rawFillColumn !== null
    && typeof rawFillColumn !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Kolom nilai pengisi tidak valid',
      message: 'Kolom nilai pengisi harus berupa pilihan kolom teks.',
    })
  }
  const masterFillColumn = typeof rawFillColumn === 'string' && rawFillColumn.trim()
    ? rawFillColumn
    : masterColumn

  await Promise.all([
    validateDatabase(client, sourceDatabase),
    validateDatabase(client, masterDatabase),
  ])
  const [sourceMetadata, masterMetadata] = await Promise.all([
    validateTable(client, sourceDatabase, sourceTable),
    validateTable(client, masterDatabase, masterTable),
  ])
  await Promise.all([
    validateTextColumn(client, sourceDatabase, sourceTable, sourceColumn, 'sumber'),
    validateTextColumn(client, sourceDatabase, sourceTable, targetColumn, 'target'),
    validateTextColumn(client, masterDatabase, masterTable, masterColumn, 'kunci pencarian'),
    ...(masterFillColumn === masterColumn
      ? []
      : [validateTextColumn(client, masterDatabase, masterTable, masterFillColumn, 'nilai pengisi')]),
  ])

  const sourceIdentifier = `${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(sourceTable)}`
  const masterIdentifier = `${quoteIdentifier(masterDatabase)}.${quoteIdentifier(masterTable)}`
  const sourceFinal = sourceMetadata.engine === 'ReplacingMergeTree'
    || sourceMetadata.engine === 'ReplicatedReplacingMergeTree'
    ? ' FINAL'
    : ''
  const masterFinal = masterMetadata.engine === 'ReplacingMergeTree'
    || masterMetadata.engine === 'ReplicatedReplacingMergeTree'
    ? ' FINAL'
    : ''
  const sourceField = quoteIdentifier(sourceColumn)
  const targetField = quoteIdentifier(targetColumn)
  const masterField = quoteIdentifier(masterColumn)
  const masterFillField = quoteIdentifier(masterFillColumn)
  const keyColumns = sourceMetadata.sorting_key.trim()
    && !/^tuple\(\)$/i.test(sourceMetadata.sorting_key.trim())
    ? quoteSortingKey(sourceMetadata.sorting_key, await getSourceColumns(client, sourceDatabase, sourceTable))
    : { expression: '', columns: [] as string[] }
  const keyMetadata = keyColumns.columns.map((name, index) => ({
    name,
    valueKey: `__key_${index}`,
  }))
  const keySelect = keyColumns.columns.flatMap((name, index) => [
    quoteIdentifier(name),
    `${quoteIdentifier(name)} AS ${quoteIdentifier(`__key_${index}`)}`,
  ])
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
  const sourceTrimmed = `trimBoth(ifNull(${sourceField}, ''))`
  const targetEmpty = `(isNull(${targetField}) OR trimBoth(ifNull(${targetField}, '')) = '')`
  const projectedSourceTrimmed = `trimBoth(ifNull(${quoteIdentifier('__source_text')}, ''))`
  const matchExpression = `arrayFilter(item -> positionCaseInsensitiveUTF8(${projectedSourceTrimmed}, tupleElement(item, 1)) > 0, master_values)`
  const matchedKeys = 'arrayDistinct(arrayMap(item -> tupleElement(item, 1), best_matches))'
  const matchedFillValues = 'arrayDistinct(arrayMap(item -> tupleElement(item, 2), best_matches))'
  const isAmbiguous = `(length(${matchedKeys}) > 1 AND length(${matchedFillValues}) > 1)`
  const fromClause = `${sourceIdentifier}${sourceFinal}`
  const classifiedRows = `
    SELECT
      *,
      if(length(best_matches) > 0 AND NOT ambiguous, tupleElement(arrayElement(best_matches, 1), 2), '') AS suggested_value,
      if(
        ambiguous,
        arrayStringConcat(arrayDistinct(arrayMap(item -> tupleElement(item, 1), best_matches)), ', '),
        if(length(best_matches) > 0, tupleElement(arrayElement(best_matches, 1), 1), '')
      ) AS matched_master_key,
      multiIf(
        NOT target_empty, '',
        ambiguous, 'ambiguous',
        NOT source_filled OR length(matches) = 0, 'remainingEmpty',
        'fillable'
      ) AS category
    FROM (
      SELECT
        *,
        ${isAmbiguous} AS ambiguous
      FROM (
        SELECT
          *,
          if(length(matches) > 0,
            arrayFilter(item -> lengthUTF8(tupleElement(item, 1)) = lengthUTF8(tupleElement(arrayElement(matches, 1), 1)), matches),
            CAST([], 'Array(Tuple(String, String))')
          ) AS best_matches
        FROM (
          SELECT
            *,
            ${matchExpression} AS matches
          FROM (
            SELECT
              ${keySelect.join(',\n              ')}${keySelect.length ? ',\n              ' : ''}
              ${sourceField} AS ${quoteIdentifier('__source_text')},
              ${targetField} AS ${quoteIdentifier('__target_before')},
              ${targetEmpty} AS target_empty,
              notEmpty(${sourceTrimmed}) AS source_filled
            FROM ${fromClause}
          )
        )
      )
    )
  `

  try {
    const statisticsResult = await client.query({
      query: `
        WITH ${masterValues} AS master_values
        SELECT
          count() AS sourceRows,
          countIf(target_empty) AS targetEmptyRows,
          countIf(category = 'fillable') AS fillableRows,
          countIf(category = 'ambiguous') AS ambiguousRows,
          countIf(category = 'remainingEmpty') AS remainingEmptyRows
        FROM (${classifiedRows})
      `,
      format: 'JSONEachRow',
      clickhouse_settings: querySettings,
    })
    const [stats] = await statisticsResult.json<Record<string, number | string>>()
    if (!stats) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Statistik pratinjau tidak tersedia',
        message: 'ClickHouse tidak mengembalikan statistik pratinjau.',
      })
    }

    const examplesResult = await client.query({
      query: `
        WITH ${masterValues} AS master_values
        SELECT
          ${[
            ...keyMetadata.map(({ valueKey }) => quoteIdentifier(valueKey)),
            quoteIdentifier('__source_text'),
            quoteIdentifier('__target_before'),
            'suggested_value',
            'matched_master_key',
            'category',
            `row_number() OVER (PARTITION BY category ORDER BY ${keyColumns.expression || 'tuple()'}) AS sample_number`,
          ].join(',\n          ')}
        FROM (${classifiedRows})
        WHERE category != ''
        QUALIFY sample_number <= 20
        ORDER BY category, sample_number
      `,
      format: 'JSONEachRow',
      clickhouse_settings: querySettings,
    })
    const exampleRows = await examplesResult.json<Record<string, unknown>[]>()
    const examples = {
      fillable: [] as Record<string, unknown>[],
      ambiguous: [] as Record<string, unknown>[],
      remainingEmpty: [] as Record<string, unknown>[],
    }
    for (const row of exampleRows) {
      const { category, sample_number: _sampleNumber, ...example } = row
      if (category === 'fillable' || category === 'ambiguous' || category === 'remainingEmpty') {
        examples[category].push(example)
      }
    }

    return {
      statistics: {
        sourceRows: numberValue(stats.sourceRows),
        targetEmptyRows: numberValue(stats.targetEmptyRows),
        fillableRows: numberValue(stats.fillableRows),
        ambiguousRows: numberValue(stats.ambiguousRows),
        remainingEmptyRows: numberValue(stats.remainingEmptyRows),
      },
      keyColumns: keyMetadata,
      sourceColumn,
      targetColumn,
      examples,
      orderedBySortingKey: Boolean(keyColumns.expression),
    }
  } catch (error) {
    if (isHttpError(error)) throw error
    const errorDetail = error instanceof Error
      ? error.message.replace(/\s+/g, ' ').slice(0, 320)
      : ''
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal menjalankan pratinjau',
      message: errorDetail
        ? `Pratinjau tidak dapat dijalankan. Detail ClickHouse: ${errorDetail}`
        : 'Pratinjau tidak dapat dijalankan. Periksa tipe tabel dan batas waktu query ClickHouse.',
    })
  }
}

async function getSourceColumns(
  client: ReturnType<typeof useClickHouse>,
  database: string,
  table: string,
): Promise<{ name: string; type: string }[]> {
  try {
    const result = await client.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = {database:String} AND table = {table:String}
        ORDER BY position
      `,
      query_params: { database, table },
      format: 'JSONEachRow',
      clickhouse_settings: querySettings,
    })
    return await result.json<{ name: string; type: string }[]>()
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal membaca kunci pengurutan',
      message: 'Informasi kolom untuk kunci pengurutan tidak dapat dibaca.',
    })
  }
}

export default feature
