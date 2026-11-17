import { inspectCsvPayload, isHttpError, readIngestPayload, sanitizeIngestErrorMessage } from '../../features/ingest-csv'

export default defineEventHandler(async (event) => {
  try {
    const payload = await readIngestPayload(event)
    const inspection = inspectCsvPayload(
      payload.textNoBom,
      payload.delimiterOption,
      payload.mode === 'file' ? payload.sourceLabel : undefined,
    )

    return {
      mode: payload.mode,
      sourceLabel: payload.sourceLabel,
      delimiter: inspection.delimiter,
      detectedDelimiter: inspection.detectedDelimiter,
      rawHeaders: inspection.rawHeaders,
      suggestedColumns: inspection.suggestedColumns,
      previewRows: inspection.previewRows,
      rowCount: inspection.rowCount,
      columnCount: inspection.columnCount,
    }
  } catch (error) {
    if (isHttpError(error)) {
      throw error
    }
    const message = sanitizeIngestErrorMessage(error, 'Data tidak dapat diperiksa sebagai CSV/TSV yang valid.')
    throw createError({
      statusCode: 400,
      statusMessage: message,
      message,
    })
  }
})
