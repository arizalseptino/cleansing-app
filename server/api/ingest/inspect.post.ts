import {
  cleanupTempFile,
  inspectCsvFile,
  inspectCsvPayload,
  isHttpError,
  readIngestPayload,
  registerStagedUpload,
  sanitizeIngestErrorMessage,
} from '../../features/ingest-csv'

export default defineEventHandler(async (event) => {
  let tempFileToCleanupOnError: string | null = null

  try {
    const payload = await readIngestPayload(event)
    if (payload.mode === 'file' && payload.ownsTempFile) {
      tempFileToCleanupOnError = payload.filePath
    }

    const inspection = payload.mode === 'file'
      ? await inspectCsvFile(payload.filePath, payload.delimiterOption, payload.sourceLabel)
      : inspectCsvPayload(payload.textNoBom, payload.delimiterOption)

    let uploadId: string | null = null
    if (payload.mode === 'file') {
      uploadId = payload.ownsTempFile
        ? registerStagedUpload(payload.filePath, payload.sourceLabel)
        : payload.stagedUploadId
      tempFileToCleanupOnError = null
    }

    return {
      uploadId,
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
    if (tempFileToCleanupOnError) {
      cleanupTempFile(tempFileToCleanupOnError)
    }
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
