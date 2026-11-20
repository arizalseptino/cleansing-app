import { compilePipeline } from '../../workbench/compiler'
import {
  getRareValuesMaxExecutionTime,
  isRareValuesTimeoutError,
  parseRareValuesRequest,
} from '../../workbench/rare-values'
import { isTextType, quoteIdentifier } from '../../workbench/utils'
import { buildClickHouseQuerySettings } from '../../utils/clickhouse'

function badRequest(statusCode: number, statusMessage: string, message: string): never {
  throw createError({ statusCode, statusMessage, message })
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown }
  if (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.code === 'ECONNRESET') return true
  if (typeof err.message === 'string' && /\b(abort(?:ed)?|cancel(?:led)?)\b/i.test(err.message)) return true
  if (err.cause && err.cause !== error) return isAbortError(err.cause)
  return false
}

export default defineEventHandler(async (event) => {
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    badRequest(400, 'Payload tidak valid', 'Body harus berupa JSON yang valid.')
  }

  const parsed = parseRareValuesRequest(body)
  const { source, steps, upTo, column, threshold, limit, search, excludeNull, excludeEmpty } = parsed
  const activeSteps = steps.slice(0, upTo)
  const maxExecutionTimeSec = getRareValuesMaxExecutionTime(activeSteps)
  const rareReadonlySettings = buildClickHouseQuerySettings({
    max_execution_time: maxExecutionTimeSec,
    readonly: 1,
  })

  const abortController = new AbortController()
  let timedOut = false
  let clientClosed = false

  const onResponseClose = () => {
    if (!event.node.res.writableFinished) {
      clientClosed = true
      abortController.abort()
    }
  }
  const onRequestAborted = () => {
    clientClosed = true
    abortController.abort()
  }
  event.node.res.on('close', onResponseClose)
  event.node.req.on('aborted', onRequestAborted)

  const timeoutGuard = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, (maxExecutionTimeSec + 5) * 1000)
  timeoutGuard.unref?.()

  try {
    const client = useClickHouse()
    // Kompilasi pipeline PENUH (tanpa sourceLimit) agar dihitung dari seluruh data
    const compiled = await compilePipeline(client, {
      source,
      steps: activeSteps,
    }, {
      abortSignal: abortController.signal,
    })

    const columnMeta = compiled.schema.find((item) => item.name === column)
    if (!columnMeta) {
      badRequest(404, 'Kolom tidak ditemukan', `Kolom "${column}" tidak ditemukan pada keluaran langkah ke-${upTo}.`)
    }
    if (!isTextType(columnMeta.type)) {
      badRequest(400, 'Kolom harus bertipe teks', `Kolom "${column}" (${columnMeta.type}) bukan kolom bertipe teks.`)
    }

    const quoted = quoteIdentifier(columnMeta.name)
    const baseWhereConditions: string[] = []
    const queryParams: Record<string, unknown> = {
      ...compiled.params,
      rv_threshold: threshold,
      rv_limit: limit,
    }

    if (excludeNull) {
      baseWhereConditions.push(`NOT isNull(${quoted})`)
    }
    if (excludeEmpty) {
      baseWhereConditions.push(`(isNull(${quoted}) OR toString(${quoted}) != '')`)
    }
    const listWhereConditions = [...baseWhereConditions]
    if (search.length > 0) {
      queryParams.rv_search = search
      listWhereConditions.push(
        `positionCaseInsensitiveUTF8(if(isNull(${quoted}), '(NULL)', if(toString(${quoted}) = '', '(kosong)', toString(${quoted}))), {rv_search:String}) > 0`,
      )
    }

    const baseWhereClause = baseWhereConditions.length ? `WHERE ${baseWhereConditions.join(' AND ')}` : ''
    const whereClause = listWhereConditions.length ? `WHERE ${listWhereConditions.join(' AND ')}` : ''

    const [listResult, summaryResult] = await Promise.all([
      client.query({
        query: `
          SELECT
            isNull(${quoted}) AS is_null,
            ifNull(toString(${quoted}), '') AS val,
            count() AS cnt
          FROM (${compiled.sql})
          ${whereClause}
          GROUP BY isNull(${quoted}), ifNull(toString(${quoted}), '')
          HAVING count() < {rv_threshold:UInt32}
          ORDER BY cnt ASC, val ASC, is_null DESC
          LIMIT {rv_limit:UInt32}
        `,
        query_params: queryParams,
        format: 'JSONEachRow',
        clickhouse_settings: rareReadonlySettings,
        abort_signal: abortController.signal,
      }),
      client.query({
        query: `
          SELECT
            count() AS unique_values,
            countIf(cnt < {rv_threshold:UInt32}) AS rare_values,
            sum(if(cnt < {rv_threshold:UInt32}, cnt, 0)) AS affected_rows
          FROM (
            SELECT count() AS cnt
            FROM (${compiled.sql})
            ${baseWhereClause}
            GROUP BY isNull(${quoted}), ifNull(toString(${quoted}), '')
          )
        `,
        query_params: queryParams,
        format: 'JSONEachRow',
        clickhouse_settings: rareReadonlySettings,
        abort_signal: abortController.signal,
      }),
    ])

    const listRows = await listResult.json<Array<{ is_null: number | string; val: string; cnt: number | string }>>()
    const summaryRows = await summaryResult.json<Array<{
      unique_values: number | string
      rare_values: number | string
      affected_rows: number | string
    }>>()
    const summaryRow = summaryRows[0]

    return {
      column: columnMeta.name,
      upTo,
      threshold,
      limit,
      computedFromFullData: true,
      maxExecutionTimeSec,
      items: listRows.map((row) => {
        const isNull = Number(row.is_null) === 1
        const textVal = String(row.val ?? '')
        const jenis: 'null' | 'empty' | 'text' = isNull ? 'null' : textVal === '' ? 'empty' : 'text'
        return {
          nilai: isNull ? '(NULL)' : textVal === '' ? '(kosong)' : textVal,
          jumlah: Number(row.cnt ?? 0),
          jenis,
          nilaiAsli: isNull ? null : textVal,
        }
      }),
      summary: {
        uniqueValues: Number(summaryRow?.unique_values ?? 0),
        rareValues: Number(summaryRow?.rare_values ?? 0),
        affectedRows: Number(summaryRow?.affected_rows ?? 0),
      },
    }
  } catch (error) {
    if (timedOut || isRareValuesTimeoutError(error)) {
      throw createError({
        statusCode: 504,
        statusMessage: 'Batas waktu perhitungan terlampaui',
        message: `Perhitungan nilai frekuensi rendah dari seluruh data melebihi batas waktu (${maxExecutionTimeSec} detik). Perhitungan tidak dialihkan ke sampel; persempit langkah pipeline atau gunakan kata pencarian.`,
      })
    }
    if (clientClosed || isAbortError(error)) {
      if (!event.node.res.headersSent) {
        setResponseStatus(event, 499, 'Client Closed Request')
      }
      return { aborted: true }
    }
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal menganalisis nilai frekuensi rendah',
      message: 'Analisis nilai frekuensi rendah dari seluruh data tidak dapat dihitung melalui ClickHouse.',
    })
  } finally {
    clearTimeout(timeoutGuard)
    event.node.res.off('close', onResponseClose)
    event.node.req.off('aborted', onRequestAborted)
  }
})
