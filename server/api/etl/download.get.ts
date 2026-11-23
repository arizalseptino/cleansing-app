import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sendStream, setResponseHeader } from 'h3'

function getSafeTmpDir(): string {
  const configured = (process.env.ETL_TMP_DIR || '').trim()
  return configured ? path.resolve(configured) : path.resolve(os.tmpdir())
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const token = typeof query.token === 'string' ? query.token.trim() : ''
  const requestedName = typeof query.filename === 'string' ? query.filename.trim() : ''

  if (!/^etl_out_[a-f0-9]{32}\.csv$/.test(token)) {
    throw createError({
      statusCode: 400,
      message: 'Token file CSV tidak valid.',
    })
  }

  const tmpDir = getSafeTmpDir()
  const resolvedPath = path.resolve(tmpDir, token)
  if (!resolvedPath.startsWith(tmpDir + path.sep)) {
    throw createError({
      statusCode: 403,
      message: 'Akses file di luar direktori sementara ditolak.',
    })
  }

  if (!fs.existsSync(resolvedPath)) {
    throw createError({
      statusCode: 404,
      message: 'File CSV hasil ETL tidak ditemukan atau sudah kedaluwarsa. Silakan proses ulang data.',
    })
  }

  const safeFilename = /^[A-Za-z0-9_.-]+\.csv$/.test(requestedName)
    ? requestedName
    : 'etl_output.csv'

  setResponseHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${safeFilename}"`)
  setResponseHeader(event, 'Cache-Control', 'no-store')

  return sendStream(event, fs.createReadStream(resolvedPath))
})
