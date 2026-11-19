import { randomUUID } from 'node:crypto'
import {
  executeStagedSaveTable,
  messageFromSaveError,
  parseSaveTableRequest,
} from '../../workbench/save-table-runner'

export default defineEventHandler(async (event) => {
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Payload tidak valid',
      message: 'Body harus berupa JSON yang valid.',
    })
  }

  const parsed = parseSaveTableRequest(body)
  const client = useClickHouse()
  const jobId = randomUUID().replace(/-/g, '').slice(0, 12)

  try {
    return await executeStagedSaveTable(client, jobId, parsed)
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 500,
      statusMessage: 'Penerapan cleansing gagal',
      message: `Tabel hasil tidak dapat dibuat. ${messageFromSaveError(error)}`,
    })
  }
})
