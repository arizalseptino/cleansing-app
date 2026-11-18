import { releaseStagedUpload } from '../../features/ingest-csv'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  let uploadId = typeof query.uploadId === 'string' ? query.uploadId.trim() : ''

  if (!uploadId) {
    try {
      const body = await readBody<{ uploadId?: unknown }>(event)
      if (body && typeof body.uploadId === 'string') {
        uploadId = body.uploadId.trim()
      }
    } catch {
      // Ignore empty body
    }
  }

  if (uploadId) {
    releaseStagedUpload(uploadId)
  }

  return { ok: true }
})
