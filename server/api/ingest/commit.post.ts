import { recordCleansingHistory } from '../../features/cleansing-history'
import {
  cleanupTempFile,
  createChunkedReadable,
  ensureTableDoesNotExist,
  type IngestRequestPayload,
  inspectCsvFile,
  inspectCsvPayload,
  isHttpError,
  readIngestPayload,
  releaseStagedUpload,
  sanitizeIngestErrorMessage,
  streamCsvBatchesFromBuffer,
  streamCsvBatchesFromFile,
  validateNewTableName,
  validateTargetColumns,
} from '../../features/ingest-csv'
import { quoteIdentifier } from '../../features/metadata'

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  const client = useClickHouse()

  let payload: IngestRequestPayload | null = null
  let mode: 'file' | 'text' = 'file'
  let sourceLabel = 'unggahan'
  let targetDatabase = ''
  let tableName = ''
  let delimiter = ','
  let targetColumns: string[] = []
  let expectedRowCount = 0
  let verifiedRowCount = 0
  let createdNewTable = false
  let quotedDb = ''
  let quotedTable = ''

  let status: 'sukses' | 'gagal' = 'gagal'
  let failureMessage: string | null = null

  try {
    payload = await readIngestPayload(event)
    mode = payload.mode
    sourceLabel = payload.sourceLabel
    targetDatabase = payload.targetDatabase.trim()

    if (!targetDatabase) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Database tujuan wajib dipilih.',
        message: 'Database tujuan wajib dipilih.',
      })
    }

    tableName = validateNewTableName(payload.tableName)
    await ensureTableDoesNotExist(client, targetDatabase, tableName)

    const inspection = payload.mode === 'file'
      ? await inspectCsvFile(payload.filePath, payload.delimiterOption, payload.sourceLabel)
      : inspectCsvPayload(payload.textNoBom, payload.delimiterOption)

    delimiter = inspection.delimiter
    expectedRowCount = inspection.rowCount

    targetColumns = validateTargetColumns(
      payload.columns ?? inspection.suggestedColumns,
      inspection.columnCount,
    )

    quotedDb = quoteIdentifier(targetDatabase)
    quotedTable = quoteIdentifier(tableName)
    const quotedColumns = targetColumns.map(quoteIdentifier)
    const columnDefinitions = quotedColumns
      .map((colSql) => `${colSql} Nullable(String)`)
      .join(', ')

    await client.command({
      query: `CREATE TABLE ${quotedDb}.${quotedTable} (${columnDefinitions}) ENGINE = MergeTree ORDER BY tuple()`,
      clickhouse_settings: { max_execution_time: 60 },
    })
    createdNewTable = true

    const insertBatch = async (batchBuf: Buffer) => {
      await client.insert({
        table: `${quotedDb}.${quotedTable}`,
        columns: quotedColumns,
        values: createChunkedReadable(batchBuf),
        format: 'CSV',
        clickhouse_settings: {
          format_csv_delimiter: delimiter,
          input_format_csv_skip_first_lines: 0,
          input_format_csv_detect_header: 0,
          format_csv_allow_double_quotes: 1,
          format_csv_allow_single_quotes: 0,
          input_format_allow_errors_num: 0,
          input_format_allow_errors_ratio: 0,
          input_format_csv_allow_variable_number_of_columns: 0,
          input_format_csv_use_default_on_bad_values: 0,
          input_format_csv_empty_as_default: 0,
          format_csv_null_representation: '\\N',
          input_format_csv_skip_trailing_empty_lines: 1,
          max_execution_time: 600,
        },
      })
    }

    if (expectedRowCount > 0) {
      if (payload.mode === 'file') {
        await streamCsvBatchesFromFile(payload.filePath, inspection.delimiter, insertBatch)
      } else {
        await streamCsvBatchesFromBuffer(payload.rawBufferNoBom, inspection.delimiter, insertBatch)
      }
    }

    const countResult = await client.query({
      query: `SELECT count() AS total FROM ${quotedDb}.${quotedTable}`,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 60 },
    })
    const countRows = await countResult.json<{ total: number | string }[]>()
    const actualCount = Number(countRows[0]?.total)

    if (!Number.isSafeInteger(actualCount) || actualCount !== expectedRowCount) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Verifikasi jumlah baris gagal.',
        message: `Jumlah baris pada tabel baru (${actualCount.toLocaleString('id-ID')}) tidak sama dengan data sumber (${expectedRowCount.toLocaleString('id-ID')}).`,
      })
    }

    verifiedRowCount = actualCount
    status = 'sukses'

    const durationMs = Date.now() - startedAt
    const historyWarning = await recordCleansingHistory(client, {
      featureId: 'ingest',
      sourceDatabase: targetDatabase,
      sourceTable: sourceLabel,
      resultTable: tableName,
      parameters: {
        mode,
        sourceLabel,
        delimiter,
        targetDatabase,
        tableName,
        columns: targetColumns,
        columnCount: targetColumns.length,
      },
      sourceRows: expectedRowCount,
      filledRows: verifiedRowCount,
      ambiguousRows: 0,
      durationMs,
      status: 'sukses',
      message: null,
      startedAt,
    })

    return {
      database: targetDatabase,
      table: tableName,
      sourceLabel,
      delimiter,
      columns: targetColumns,
      rows: verifiedRowCount,
      durationMs,
      verification: `Terverifikasi ${verifiedRowCount} dari ${expectedRowCount} baris data berhasil dimuat ke ${targetDatabase}.${tableName}.`,
      historyWarning,
    }
  } catch (error) {
    if (createdNewTable && quotedDb && quotedTable) {
      try {
        await client.command({
          query: `DROP TABLE IF EXISTS ${quotedDb}.${quotedTable}`,
          clickhouse_settings: { max_execution_time: 30 },
        })
      } catch (dropErr) {
        console.warn('Gagal membersihkan tabel baru setelah pemuatan batal.', dropErr)
      }
    }

    const safeMessage = sanitizeIngestErrorMessage(
      error,
      'Gagal memuat data ke tabel baru ClickHouse. Perubahan pada tabel baru telah dibatalkan.',
    )
    failureMessage = safeMessage

    if (!isHttpError(error)) {
      console.error('[ingest/commit] ClickHouse error during staging load', error)
    }

    if (targetDatabase && tableName) {
      await recordCleansingHistory(client, {
        featureId: 'ingest',
        sourceDatabase: targetDatabase,
        sourceTable: sourceLabel,
        resultTable: tableName,
        parameters: {
          mode,
          sourceLabel,
          delimiter,
          targetDatabase,
          tableName,
          columns: targetColumns,
        },
        sourceRows: expectedRowCount,
        filledRows: 0,
        ambiguousRows: 0,
        durationMs: Date.now() - startedAt,
        status: 'gagal',
        message: failureMessage,
        startedAt,
      })
    }

    if (isHttpError(error)) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: safeMessage,
        message: safeMessage,
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: safeMessage,
      message: safeMessage,
    })
  } finally {
    if (payload?.mode === 'file') {
      if (payload.ownsTempFile) {
        cleanupTempFile(payload.filePath)
      } else if (status === 'sukses' && payload.stagedUploadId) {
        releaseStagedUpload(payload.stagedUploadId)
      }
    }
  }
})
