import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { sendStream, setResponseHeader } from 'h3'
import { recordCleansingHistory } from '../../features/cleansing-history'
import {
  buildExportSelectQuery,
  type ExportInfoResult,
  getExportTableInfo,
  parseBooleanParam,
  parseCsvDelimiter,
  parseCsvNullAs,
  parseExportColumns,
  parseExportFormat,
  parseOptionalLimit,
  parseSafeFilename,
  parseSqlBatchSize,
  parseSqlTableName,
  rewriteShowCreateTableStatement,
} from '../../features/export-table'
import { quoteIdentifier } from '../../features/metadata'

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && error.message.trim()) {
    return error.message
  }
  return fallback
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  const rawQuery = getQuery(event)
  const client = useClickHouse()

  let info: ExportInfoResult | null = null
  let format: 'csv' | 'sql' = 'csv'
  let historyLogged = false
  let historyParams: Record<string, unknown> = {}

  const logExportHistory = async (status: 'sukses' | 'gagal', message: string | null, exportedRows: number) => {
    if (historyLogged || !info) return
    historyLogged = true
    try {
      await recordCleansingHistory(client, {
        featureId: 'export',
        sourceDatabase: info.database,
        sourceTable: info.table,
        resultTable: '',
        parameters: historyParams,
        sourceRows: info.rowCount,
        filledRows: exportedRows,
        ambiguousRows: 0,
        durationMs: Date.now() - startedAt,
        status,
        message,
        startedAt,
      })
    } catch {
      // Kegagalan mencatat riwayat tidak boleh menggagalkan unduhan
    }
  }

  try {
    info = await getExportTableInfo(client, rawQuery.database, rawQuery.table)
    format = parseExportFormat(rawQuery.format)

    const selectedColumns = parseExportColumns(rawQuery.columns, info.columns)
    const limit = parseOptionalLimit(rawQuery.limit)
    const filename = parseSafeFilename(rawQuery.filename, info.table, format)

    const delimiter = parseCsvDelimiter(rawQuery.delimiter)
    const header = parseBooleanParam(rawQuery.header, true, 'header')
    const nullAs = parseCsvNullAs(rawQuery.nullAs)
    const bom = parseBooleanParam(rawQuery.bom, false, 'bom')

    const tableName = parseSqlTableName(rawQuery.tableName, info.table)
    const includeCreate = parseBooleanParam(rawQuery.includeCreate, true, 'includeCreate')
    const batchSize = parseSqlBatchSize(rawQuery.batchSize)

    historyParams = {
      format,
      filename,
      columns: selectedColumns,
      limit,
      rowCount: info.rowCount,
      ...(format === 'csv'
        ? { delimiter: delimiter.key, header, nullAs: nullAs.key, bom }
        : { tableName, includeCreate, batchSize }),
    }

    const abortController = new AbortController()
    const queryId = randomUUID()
    let clientDisconnected = false
    let streamCompleted = false
    let chStream: Readable | null = null

    const cancelOnDisconnect = () => {
      if (streamCompleted || event.node.res.writableFinished) return
      clientDisconnected = true
      abortController.abort()
      if (chStream && !chStream.destroyed) {
        chStream.destroy()
      }
      void client.command({
        query: 'KILL QUERY WHERE query_id = {queryId:String}',
        query_params: { queryId },
        clickhouse_settings: { max_execution_time: 10 },
      }).catch(() => {})
    }

    event.node.req.on('aborted', cancelOnDisconnect)
    event.node.res.on('close', cancelOnDisconnect)

    let sqlHeaderPrefix = ''
    if (format === 'sql' && includeCreate) {
      const tableIdentifier = `${quoteIdentifier(info.database)}.${quoteIdentifier(info.table)}`
      const createResult = await client.query({
        query: `SHOW CREATE TABLE ${tableIdentifier}`,
        format: 'JSONEachRow',
        clickhouse_settings: { readonly: 1, max_execution_time: 30 },
        abort_signal: abortController.signal,
      })
      const createRows = await createResult.json<{ statement?: string }[]>()
      const rawStatement = createRows[0]?.statement
      if (!rawStatement || typeof rawStatement !== 'string') {
        throw createError({
          statusCode: 500,
          statusMessage: 'Gagal memuat definisi tabel',
          message: 'ClickHouse tidak mengembalikan pernyataan CREATE TABLE.',
        })
      }
      const rewrittenCreate = rewriteShowCreateTableStatement(rawStatement, tableName)
      sqlHeaderPrefix = [
        `-- Sumber: ${info.database}.${info.table}`,
        `-- Waktu ekspor: ${new Date().toISOString()}`,
        '',
        rewrittenCreate,
        '',
        '',
      ].join('\n')
    }

    const chFormat = format === 'csv'
      ? (header ? 'CSVWithNames' : 'CSV')
      : 'SQLInsert'

    const { query, queryParams } = buildExportSelectQuery(info, selectedColumns, limit, chFormat)

    const clickhouseSettings: Record<string, unknown> = {
      readonly: 1,
      max_execution_time: 600,
      ...(format === 'csv'
        ? {
            format_csv_delimiter: delimiter.value,
            format_csv_null_representation: nullAs.value,
          }
        : {
            output_format_sql_insert_table_name: tableName,
            output_format_sql_insert_include_column_names: 1,
            output_format_sql_insert_max_batch_size: batchSize,
            output_format_sql_insert_quote_names: 1,
          }),
    }

    const execResult = await client.exec({
      query,
      query_params: queryParams,
      clickhouse_settings: clickhouseSettings,
      abort_signal: abortController.signal,
      query_id: queryId,
    })
    chStream = execResult.stream

    if (clientDisconnected || abortController.signal.aborted) {
      chStream.destroy()
      await logExportHistory('gagal', 'Ekspor dibatalkan karena klien memutus koneksi.', 0)
      return
    }

    const prefixBuffers: Buffer[] = []
    if (format === 'csv' && bom) {
      prefixBuffers.push(Buffer.from([0xEF, 0xBB, 0xBF]))
    } else if (format === 'sql' && sqlHeaderPrefix) {
      prefixBuffers.push(Buffer.from(sqlHeaderPrefix, 'utf8'))
    }

    setResponseHeader(
      event,
      'Content-Type',
      format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
    )
    setResponseHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
    setResponseHeader(event, 'Cache-Control', 'no-store')

    async function* generateChunks(): AsyncGenerator<Buffer> {
      try {
        for (const prefix of prefixBuffers) {
          if (abortController.signal.aborted) return
          yield prefix
        }
        if (chStream) {
          for await (const chunk of chStream) {
            if (abortController.signal.aborted) return
            yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          }
        }
        streamCompleted = true
      } finally {
        event.node.req.off('aborted', cancelOnDisconnect)
        event.node.res.off('close', cancelOnDisconnect)
      }
    }

    const outputStream = Readable.from(generateChunks())
    const expectedExportedRows = limit !== null ? Math.min(limit, info.rowCount) : info.rowCount

    try {
      await sendStream(event, outputStream)
      if (clientDisconnected || !streamCompleted) {
        await logExportHistory('gagal', 'Ekspor dibatalkan karena klien memutus koneksi.', 0)
      } else {
        await logExportHistory('sukses', null, expectedExportedRows)
      }
    } catch (streamError) {
      const reason = clientDisconnected
        ? 'Ekspor dibatalkan karena klien memutus koneksi.'
        : getErrorMessage(streamError, 'Gagal mengalirkan data ekspor dari ClickHouse.')
      await logExportHistory('gagal', reason, 0)
    }
  } catch (error) {
    const message = getErrorMessage(error, 'Ekspor data gagal diproses.')
    await logExportHistory('gagal', message, 0)

    if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number') {
      throw error
    }
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal mengekspor tabel',
      message,
    })
  }
})
