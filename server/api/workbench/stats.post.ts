import { compilePipeline } from '../../workbench/compiler'
import { buildInputSql, isTextType, quoteIdentifier } from '../../workbench/utils'
import type { Pipeline } from '../../workbench/types'

type ColumnStatistics = {
  changed: number
  beforeNullOrEmpty: number | null
  afterNullOrEmpty: number
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

  const client = useClickHouse()
  try {
    let rowsIn: number
    let compiled
    let columns: string[]
    let beforeAlias: (column: string) => string | null

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

      const input = await compilePipeline(client, { ...pipeline, steps: steps.slice(0, -1) })
      const inputRows = await client.query({
        query: `SELECT count() AS total FROM (${input.sql})`,
        query_params: input.params,
        format: 'JSONEachRow',
        clickhouse_settings: { readonly: 1, max_execution_time: 30 },
      })
      const [inputCount] = await inputRows.json<{ total: number | string }[]>()
      rowsIn = countValue(inputCount?.total, 'jumlah baris masuk')
    } else {
      const initial = await compilePipeline(client, pipeline)
      columns = [...new Set([...initial.touchedColumns, ...initial.addedColumns])]
      const sourceColumns = columns.filter((column) =>
        initial.sourceSchema.some((sourceColumn) => sourceColumn.name === column),
      )
      compiled = sourceColumns.length
        ? await compilePipeline(client, pipeline, { includeSourceColumns: sourceColumns })
        : initial
      beforeAlias = (column) => sourceColumns.includes(column) ? `__sumber_${column}` : null

      const sourceRows = await client.query({
        query: `SELECT count() AS total FROM (${buildInputSql(pipeline.source)})`,
        format: 'JSONEachRow',
        clickhouse_settings: { readonly: 1, max_execution_time: 30 },
      })
      const [sourceCount] = await sourceRows.json<{ total: number | string }[]>()
      rowsIn = countValue(sourceCount?.total, 'jumlah baris sumber')
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
      clickhouse_settings: { readonly: 1, max_execution_time: 30 },
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

    return {
      scope,
      step: scope === 'step' ? Number('step' in body ? body.step : 1) : undefined,
      rowsIn,
      rowsOut,
      totalRows: rowsOut,
      stats,
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 500,
      statusMessage: 'Statistik tidak dapat dihitung',
      message: 'Statistik tidak dapat dihitung dari ClickHouse. Periksa sumber dan pipeline, lalu coba lagi.',
    })
  }
})
