import { compilePipeline } from '../../workbench/compiler'
import { validateTable } from '../../features/metadata'
import {
  buildFuzzyMappingSql,
  buildNormalizedTextExpr,
  parseFuzzyParams,
} from '../../workbench/ops/fuzzy_match_master'
import { buildInputSql, isTextType, quoteIdentifier } from '../../workbench/utils'
import { buildClickHouseQuerySettings } from '../../utils/clickhouse'
import type { Pipeline } from '../../workbench/types'

type ColumnStatistics = {
  changed: number
  beforeNullOrEmpty: number | null
  afterNullOrEmpty: number
}

type FuzzyPairOrder = 'lowest_score' | 'highest_score' | 'most_rows'

type FuzzyMatchStatistics = {
  uniqueSourceValues: number
  exactMatches: number
  fuzzyMatches: number
  ambiguousMatches: number
  unmatchedValues: number
  routedRows: number
  pairOrder: FuzzyPairOrder
  pairs: Array<{
    sourceValue: string
    masterValue: string | null
    score: number
    rowCount: number
    status: 'exact' | 'fuzzy' | 'ambiguous' | 'unmatched'
  }>
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message, message })
}

function countValue(value: number | string | undefined, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Statistik tidak valid',
      message: `ClickHouse mengembalikan ${label} yang tidak valid.`,
    })
  }
  return parsed
}

function emptyCondition(column: string, type: string): string {
  const quoted = quoteIdentifier(column)
  return isTextType(type)
    ? `(isNull(${quoted}) OR trimBoth(ifNull(toString(${quoted}), '')) = '')`
    : `isNull(${quoted})`
}

function sameValue(before: string, after: string): string {
  return `if(isNull(${before}), isNull(${after}), if(isNull(${after}), 0, ${before} = ${after}))`
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  if (!body || typeof body !== 'object' || !('source' in body) || !('steps' in body) || !Array.isArray(body.steps)) {
    badRequest('Body harus berisi source dan steps.')
  }

  const pipeline = body as Pipeline
  const scope = 'scope' in body && body.scope !== undefined ? body.scope : 'step'
  if (scope !== 'step' && scope !== 'pipeline') {
    badRequest('Cakupan statistik harus berupa step atau pipeline.')
  }

  const rawPairOrder = 'pairOrder' in body && body.pairOrder !== undefined ? body.pairOrder : 'lowest_score'
  if (rawPairOrder !== 'lowest_score' && rawPairOrder !== 'highest_score' && rawPairOrder !== 'most_rows') {
    badRequest('Urutan contoh pasangan harus berupa lowest_score, highest_score, atau most_rows.')
  }
  const pairOrder: FuzzyPairOrder = rawPairOrder

  const hasFuzzyMatch = pipeline.steps.some((step) => step?.op === 'fuzzy_match_master')
  const statsSettings = buildClickHouseQuerySettings({
    max_execution_time: hasFuzzyMatch ? 180 : 120,
    readonly: 1,
  })

  const client = useClickHouse()
  try {
    let rowsIn: number | null = null
    let compiled
    let columns: string[]
    let beforeAlias: (column: string) => string | null
    let deduplicateStepIndex = -1
    let fuzzyStepIndex = -1

    let stepInput: Awaited<ReturnType<typeof compilePipeline>> | undefined

    if (scope === 'step') {
      const stepNumber = Number('step' in body ? body.step : 1)
      if (!Number.isSafeInteger(stepNumber) || stepNumber < 1 || stepNumber > pipeline.steps.length) {
        badRequest('Nomor langkah statistik berada di luar rentang pipeline.')
      }

      const steps = pipeline.steps.slice(0, stepNumber)
      compiled = await compilePipeline(client, { ...pipeline, steps }, { includeBefore: true })
      columns = [...new Set([...compiled.lastStepTouchedColumns, ...compiled.lastStepAddedColumns])]
      beforeAlias = (column) => compiled.lastStepTouchedColumns.includes(column)
        ? `__sebelum_${column}`
        : null

      const lastOp = steps[steps.length - 1]?.op
      if (lastOp === 'deduplicate') deduplicateStepIndex = steps.length - 1
      if (lastOp === 'fuzzy_match_master') fuzzyStepIndex = steps.length - 1

      if (deduplicateStepIndex >= 0 || fuzzyStepIndex >= 0) {
        stepInput = await compilePipeline(client, { ...pipeline, steps: steps.slice(0, -1) }, { skipValidation: true })
      }
      if (deduplicateStepIndex >= 0 && stepInput) {
        const inputRows = await client.query({
          query: `SELECT count() AS total FROM (${stepInput.sql})`,
          query_params: stepInput.params,
          format: 'JSONEachRow',
          clickhouse_settings: statsSettings,
        })
        const [inputCount] = await inputRows.json<{ total: number | string }[]>()
        rowsIn = countValue(inputCount?.total, 'jumlah baris masuk')
      }
    } else {
      const initial = await compilePipeline(client, pipeline)
      columns = [...new Set([...initial.touchedColumns, ...initial.addedColumns])]
      const sourceColumns = columns.filter((column) =>
        initial.sourceSchema.some((sourceColumn) => sourceColumn.name === column),
      )
      compiled = sourceColumns.length
        ? await compilePipeline(client, pipeline, { includeSourceColumns: sourceColumns, skipValidation: true })
        : initial
      beforeAlias = (column) => sourceColumns.includes(column) ? `__sumber_${column}` : null

      const sourceRows = await client.query({
        query: `SELECT count() AS total FROM (${buildInputSql(pipeline.source)})`,
        format: 'JSONEachRow',
        clickhouse_settings: statsSettings,
      })
      const [sourceCount] = await sourceRows.json<{ total: number | string }[]>()
      rowsIn = countValue(sourceCount?.total, 'jumlah baris sumber')
      deduplicateStepIndex = pipeline.steps.map((step, index) => step.op === 'deduplicate' ? index : -1)
        .filter((index) => index >= 0)
        .pop() ?? -1
    }

    const selected = columns.map((column, index) => {
      const outputColumn = compiled.schema.find((item) => item.name === column)
      if (!outputColumn) {
        badRequest(`Kolom statistik ${column} tidak ditemukan pada skema hasil.`)
      }
      const before = beforeAlias(column)
      const changed = before
        ? `countIf(NOT (${sameValue(quoteIdentifier(before), quoteIdentifier(column))})) AS ${quoteIdentifier(`changed_${index}`)}`
        : `count() AS ${quoteIdentifier(`changed_${index}`)}`
      const beforeEmpty = before
        ? `countIf(${emptyCondition(before, outputColumn.type)}) AS ${quoteIdentifier(`before_empty_${index}`)}`
        : `CAST(NULL, 'Nullable(UInt64)') AS ${quoteIdentifier(`before_empty_${index}`)}`
      return {
        column,
        index,
        expressions: [
          changed,
          beforeEmpty,
          `countIf(${emptyCondition(column, outputColumn.type)}) AS ${quoteIdentifier(`after_empty_${index}`)}`,
        ],
      }
    })

    const result = await client.query({
      query: `SELECT count() AS rows_out${selected.length ? `, ${selected.flatMap(({ expressions }) => expressions).join(', ')}` : ''} FROM (${compiled.sql})`,
      query_params: compiled.params,
      format: 'JSONEachRow',
      clickhouse_settings: statsSettings,
    })
    const [row] = await result.json<Record<string, number | string | null>>()
    if (!row) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Statistik tidak tersedia',
        message: 'ClickHouse tidak mengembalikan hasil statistik.',
      })
    }

    const rowsOut = countValue(row.rows_out as number | string | undefined, 'jumlah baris keluar')
    const resolvedRowsIn = rowsIn ?? rowsOut
    const droppedRows = Math.max(0, resolvedRowsIn - rowsOut)
    const stats: Record<string, ColumnStatistics> = {}
    for (const { column, index } of selected) {
      const beforeValue = row[`before_empty_${index}`]
      stats[column] = {
        changed: countValue(row[`changed_${index}`] as number | string | undefined, 'jumlah nilai berubah'),
        beforeNullOrEmpty: beforeValue === null
          ? null
          : countValue(beforeValue as number | string, 'jumlah NULL atau kosong sebelum langkah'),
        afterNullOrEmpty: countValue(row[`after_empty_${index}`] as number | string | undefined, 'jumlah NULL atau kosong sesudah langkah'),
      }
    }

    let deduplicateStats: { duplicateGroups: number; discardedRows: number; conflictGroups: number } | undefined
    if (deduplicateStepIndex >= 0) {
      const step = pipeline.steps[deduplicateStepIndex]
      const input = scope === 'step' && stepInput
        ? stepInput
        : await compilePipeline(client, {
            ...pipeline,
            steps: pipeline.steps.slice(0, deduplicateStepIndex),
          }, { skipValidation: true })
      const keys = Array.isArray(step.params?.keyColumns)
        ? step.params.keyColumns.filter((column): column is string => typeof column === 'string')
        : []
      const keySql = keys.map(quoteIdentifier)
      const nonKeyColumns = input.schema
        .map(({ name }) => name)
        .filter((name) => !keys.includes(name))
      const allKeysNull = keySql.map((column) => `isNull(${column})`).join(' AND ')
      const distinctContent = nonKeyColumns.length
        ? `uniq(tuple(${nonKeyColumns.map(quoteIdentifier).join(', ')}))`
        : 'uniq(tuple())'
      const grouped = await client.query({
        query: `SELECT countIf(group_rows > 1) AS duplicate_groups, sum(if(group_rows > 1, group_rows - 1, 0)) AS discarded_rows, countIf(group_rows > 1 AND distinct_content > 1) AS conflict_groups
FROM (
  SELECT count() AS group_rows, ${distinctContent} AS distinct_content
  FROM (${input.sql})
  WHERE NOT (${allKeysNull})
  GROUP BY ${keySql.join(', ')}
)`,
        query_params: input.params,
        format: 'JSONEachRow',
        clickhouse_settings: statsSettings,
      })
      const [groupRow] = await grouped.json<Record<string, number | string>[]>()
      if (!groupRow) badRequest('Statistik deduplikasi tidak dapat dihitung.')
      deduplicateStats = {
        duplicateGroups: countValue(groupRow.duplicate_groups, 'jumlah grup duplikat'),
        discardedRows: countValue(groupRow.discarded_rows, 'jumlah baris dibuang'),
        conflictGroups: countValue(groupRow.conflict_groups, 'jumlah grup konflik isi'),
      }
    }

    let fuzzyMatch: FuzzyMatchStatistics | undefined
    if (fuzzyStepIndex >= 0) {
      const step = pipeline.steps[fuzzyStepIndex]
      const input = scope === 'step' && stepInput
        ? stepInput
        : await compilePipeline(client, {
            ...pipeline,
            steps: pipeline.steps.slice(0, fuzzyStepIndex),
          }, { skipValidation: true })
      const parsed = parseFuzzyParams({ schema: input.schema, params: step.params ?? {} })
      const masterMeta = await validateTable(client, parsed.masterDatabase, parsed.masterTable)
      const masterIdentifier = `${quoteIdentifier(parsed.masterDatabase)}.${quoteIdentifier(parsed.masterTable)}`
      const masterFinal = /^(?:Replicated)?ReplacingMergeTree$/.test(masterMeta.engine) ? ' FINAL' : ''

      const mappingSql = buildFuzzyMappingSql({
        inputSql: `(${input.sql})`,
        sourceColumn: parsed.sourceColumn,
        masterIdentifier,
        masterFinal,
        masterColumn: parsed.masterColumn,
        mode: parsed.mode,
        algorithm: parsed.algorithm,
        normalizations: parsed.normalizations,
        thresholdParamName: 'fm_threshold',
        aliases: {
          sNorm: '__fm_s_norm',
          master: '__fm_master',
          status: '__fm_status',
          score: '__fm_score',
        },
      })
      const fmParams: Record<string, unknown> = {
        ...input.params,
        ...(parsed.mode === 'similarity' ? { fm_threshold: parsed.threshold } : {}),
      }

      const srcField = quoteIdentifier(parsed.sourceColumn)
      const srcNormExpr = buildNormalizedTextExpr(srcField, parsed.mode, parsed.normalizations)
      const srcNonEmpty = `(${srcField} IS NOT NULL AND trimBoth(ifNull(toString(${srcField}), '')) != '' AND ${srcNormExpr} != '')`

      const orderByClause = pairOrder === 'highest_score'
        ? `if(match_status IN ('exact', 'fuzzy'), 0, 1) ASC, score DESC, row_count DESC, source_value ASC`
        : pairOrder === 'most_rows'
          ? `row_count DESC, score ASC, source_value ASC`
          : `if(match_status IN ('exact', 'fuzzy'), 0, 1) ASC, score ASC, row_count DESC, source_value ASC`

      const summaryRes = await client.query({
        query: `
          SELECT
            count() AS unique_source_values,
            countIf(__fm_status = 'exact') AS exact_matches,
            countIf(__fm_status = 'fuzzy') AS fuzzy_matches,
            countIf(__fm_status = 'ambiguous') AS ambiguous_matches,
            countIf(__fm_status = 'unmatched') AS unmatched_values
          FROM (${mappingSql})
        `,
        query_params: fmParams,
        format: 'JSONEachRow',
        clickhouse_settings: statsSettings,
      })

      const routedRes = parsed.routeUnmatched
        ? await (() => {
            const unmatchedQuoted = quoteIdentifier(parsed.unmatchedColumn)
            const unmatchedEmpty = `(isNull(s.${unmatchedQuoted}) OR trimBoth(ifNull(toString(s.${unmatchedQuoted}), '')) = '')`
            return client.query({
              query: `
                SELECT
                  countIf(ifNull(m.__fm_status, '') = 'unmatched' AND ${unmatchedEmpty}) AS routed_rows
                FROM (
                  SELECT *, ${srcNormExpr} AS __fm_key
                  FROM (${input.sql})
                ) AS s
                LEFT JOIN (${mappingSql}) AS m
                ON s.__fm_key = m.__fm_s_norm
              `,
              query_params: fmParams,
              format: 'JSONEachRow',
              clickhouse_settings: statsSettings,
            })
          })()
        : null

      const pairsRes = await client.query({
        query: `
          SELECT
            g.sample_source AS source_value,
            if(m.__fm_status IN ('exact', 'fuzzy'), m.__fm_master, CAST(NULL, 'Nullable(String)')) AS master_value,
            m.__fm_score AS score,
            g.row_count AS row_count,
            m.__fm_status AS match_status
          FROM (
            SELECT
              s_norm,
              any(orig_val) AS sample_source,
              count() AS row_count
            FROM (
              SELECT
                ${srcNormExpr} AS s_norm,
                toString(${srcField}) AS orig_val
              FROM (${input.sql})
              WHERE ${srcNonEmpty}
            )
            GROUP BY s_norm
          ) AS g
          LEFT JOIN (${mappingSql}) AS m
          ON g.s_norm = m.__fm_s_norm
          ORDER BY ${orderByClause}
          LIMIT 50
        `,
        query_params: fmParams,
        format: 'JSONEachRow',
        clickhouse_settings: statsSettings,
      })

      const [summaryRow] = await summaryRes.json<Record<string, number | string>[]>()
      const routedRowsList = routedRes
        ? await routedRes.json<Record<string, number | string>[]>()
        : []
      const pairRows = await pairsRes.json<Array<{
        source_value: string
        master_value: string | null
        score: number | string
        row_count: number | string
        match_status: string
      }>>()

      fuzzyMatch = {
        uniqueSourceValues: countValue(summaryRow?.unique_source_values, 'jumlah nilai unik sumber'),
        exactMatches: countValue(summaryRow?.exact_matches, 'jumlah cocok persis'),
        fuzzyMatches: countValue(summaryRow?.fuzzy_matches, 'jumlah cocok mirip'),
        ambiguousMatches: countValue(summaryRow?.ambiguous_matches, 'jumlah ambigu'),
        unmatchedValues: countValue(summaryRow?.unmatched_values, 'jumlah tidak cocok'),
        routedRows: parsed.routeUnmatched ? countValue(routedRowsList[0]?.routed_rows, 'jumlah baris dipindahkan') : 0,
        pairOrder,
        pairs: pairRows.map((item) => {
          const status = item.match_status === 'exact' || item.match_status === 'fuzzy' || item.match_status === 'ambiguous'
            ? item.match_status
            : 'unmatched'
          return {
            sourceValue: String(item.source_value ?? ''),
            masterValue: item.master_value === null || item.master_value === undefined ? null : String(item.master_value),
            score: Number(item.score ?? 0),
            rowCount: countValue(item.row_count, 'jumlah baris pasangan'),
            status,
          }
        }),
      }
    }

    return {
      scope,
      step: scope === 'step' ? Number('step' in body ? body.step : 1) : undefined,
      rowsIn: resolvedRowsIn,
      rowsOut,
      rowsDropped: droppedRows,
      totalRows: rowsOut,
      stats,
      ...(deduplicateStats ?? {}),
      ...(fuzzyMatch ? { fuzzyMatch } : {}),
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    console.error('[workbench/stats] ClickHouse error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Statistik tidak dapat dihitung',
      message: 'Statistik tidak dapat dihitung dari ClickHouse. Periksa sumber dan pipeline, lalu coba lagi.',
    })
  }
})
