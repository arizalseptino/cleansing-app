import { compilePipeline } from '../../workbench/compiler'
import { quoteIdentifier } from '../../workbench/utils'
import { buildClickHouseQuerySettings } from '../../utils/clickhouse'

type DisplayFilter = {
  column: string
  kind: 'null' | 'empty' | 'text'
  value?: string | null
}

const PREVIEW_SAMPLE_LIMIT = 5000

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown }
  if (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.code === 'ECONNRESET') return true
  if (typeof err.message === 'string' && /\b(abort(?:ed)?|cancel(?:led)?)\b/i.test(err.message)) return true
  if (err.cause && err.cause !== error) return isAbortError(err.cause)
  return false
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const pipeline = body && typeof body === 'object' && 'source' in body && 'steps' in body ? body as any : null

  if (!pipeline || !pipeline.source || !Array.isArray(pipeline.steps)) {
    throw createError({ statusCode: 400, statusMessage: 'Payload tidak valid', message: 'Body harus berisi source dan steps.' })
  }

  const abortController = new AbortController()
  const onResponseClose = () => {
    if (!event.node.res.writableFinished) {
      abortController.abort()
    }
  }
  const onRequestAborted = () => {
    abortController.abort()
  }
  event.node.res.on('close', onResponseClose)
  event.node.req.on('aborted', onRequestAborted)

  try {
    const client = useClickHouse()
    const compiled = await compilePipeline(client, pipeline, {
      includeBefore: true,
      sourceLimit: PREVIEW_SAMPLE_LIMIT,
      abortSignal: abortController.signal,
    })
    const requestedLimit = Number(body.limit ?? 50)
    if (!Number.isSafeInteger(requestedLimit)) {
      throw createError({ statusCode: 400, statusMessage: 'Batas pratinjau tidak valid', message: 'Batas baris pratinjau harus berupa bilangan bulat.' })
    }
    const limit = Math.min(Math.max(requestedLimit, 1), 100)
    const requestedPage = Number(body.page ?? 1)
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) {
      throw createError({ statusCode: 400, statusMessage: 'Halaman pratinjau tidak valid', message: 'Nomor halaman harus berupa bilangan bulat positif.' })
    }
    const page = requestedPage

    let previewSql = compiled.sql
    const previewParams: Record<string, unknown> = { ...compiled.params }

    if (body.displayFilter !== undefined && body.displayFilter !== null) {
      const rawFilter = body.displayFilter as Partial<DisplayFilter>
      if (typeof rawFilter !== 'object' || Array.isArray(rawFilter)) {
        throw createError({ statusCode: 400, statusMessage: 'Penyaring tampilan tidak valid', message: 'Format penyaring tampilan tidak valid.' })
      }
      const filterColumn = typeof rawFilter.column === 'string' ? rawFilter.column : ''
      const filterKind = rawFilter.kind
      if (!filterColumn || (filterKind !== 'null' && filterKind !== 'empty' && filterKind !== 'text')) {
        throw createError({ statusCode: 400, statusMessage: 'Penyaring tampilan tidak valid', message: 'Kolom dan jenis penyaring tampilan wajib diisi.' })
      }
      const verifiedColumn = compiled.schema.find((col) => col.name === filterColumn)
      if (!verifiedColumn) {
        throw createError({ statusCode: 400, statusMessage: 'Kolom penyaring tidak ditemukan', message: `Kolom "${filterColumn}" tidak ditemukan pada skema pratinjau.` })
      }
      const quoted = quoteIdentifier(verifiedColumn.name)
      let condition = ''
      if (filterKind === 'null') {
        condition = `isNull(${quoted})`
      } else if (filterKind === 'empty') {
        condition = `(NOT isNull(${quoted}) AND toString(${quoted}) = '')`
      } else {
        if (typeof rawFilter.value !== 'string' || rawFilter.value.length > 2000) {
          throw createError({ statusCode: 400, statusMessage: 'Nilai penyaring tidak valid', message: 'Nilai penyaring tampilan harus berupa teks maksimal 2.000 karakter.' })
        }
        previewParams.wb_display_filter_val = rawFilter.value
        condition = `(NOT isNull(${quoted}) AND toString(${quoted}) = {wb_display_filter_val:String})`
      }
      previewSql = `SELECT * FROM (${compiled.sql}) WHERE ${condition}`
    }

    const hasFuzzyMatch = Array.isArray(pipeline.steps) && pipeline.steps.some((step: { op?: string }) => step?.op === 'fuzzy_match_master')
    const previewReadonlySettings = buildClickHouseQuerySettings({
      max_execution_time: hasFuzzyMatch ? 180 : 120,
      readonly: 1,
    })

    const totalRows = await client.query({
      query: `SELECT count() AS total FROM (${previewSql})`,
      query_params: previewParams,
      format: 'JSONEachRow',
      clickhouse_settings: previewReadonlySettings,
      abort_signal: abortController.signal,
    })
    const totalJson = await totalRows.json<{ total: number }[]>()
    const total = Number(totalJson[0]?.total ?? 0)
    const effectivePage = Math.min(page, Math.max(1, Math.ceil(total / limit)))
    const offset = (effectivePage - 1) * limit
    if (!Number.isSafeInteger(offset)) {
      throw createError({ statusCode: 400, statusMessage: 'Halaman pratinjau terlalu besar', message: 'Nomor halaman yang diminta berada di luar batas.' })
    }

    const rowsResult = await client.query({
      query: `SELECT * FROM (${previewSql}) LIMIT ${limit} OFFSET ${offset}`,
      query_params: previewParams,
      format: 'JSON',
      clickhouse_settings: previewReadonlySettings,
      abort_signal: abortController.signal,
    })
    const rowsPayload = await rowsResult.json<any>()
    const columns = rowsPayload.meta?.map((meta: { name: string }) => meta.name) ?? []
    const rows = Array.isArray(rowsPayload.data) ? rowsPayload.data : []

    return {
      columns,
      rows,
      totalRows: total,
      page: effectivePage,
      limit,
      isSampled: true,
      sampleLimit: PREVIEW_SAMPLE_LIMIT,
      warnings: compiled.warnings,
      changesRowCount: compiled.changesRowCount,
    }
  } catch (error) {
    if (abortController.signal.aborted || isAbortError(error)) {
      if (!event.node.res.headersSent) {
        setResponseStatus(event, 499, 'Client Closed Request')
      }
      return {
        aborted: true,
        columns: [],
        rows: [],
        totalRows: 0,
        page: 1,
        limit: 50,
        isSampled: true,
        sampleLimit: PREVIEW_SAMPLE_LIMIT,
        warnings: [],
        changesRowCount: false,
      }
    }
    throw error
  } finally {
    event.node.res.off('close', onResponseClose)
    event.node.req.off('aborted', onRequestAborted)
  }
})
