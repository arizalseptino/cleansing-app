import type { PipelineStep } from './types'

export type ParsedRareValuesRequest = {
  source: { database: string; table: string }
  steps: PipelineStep[]
  upTo: number
  column: string
  threshold: number
  limit: number
  search: string
  excludeNull: boolean
  excludeEmpty: boolean
}

function badRequest(statusCode: number, statusMessage: string, message: string): never {
  throw createError({ statusCode, statusMessage, message })
}

export function parseRareValuesRequest(body: unknown): ParsedRareValuesRequest {
  if (!body || typeof body !== 'object' || !('source' in body) || !('steps' in body)) {
    badRequest(400, 'Payload tidak valid', 'Body harus berisi source dan steps.')
  }

  const record = body as Record<string, unknown>
  if (!record.source || typeof record.source !== 'object' || !Array.isArray(record.steps)) {
    badRequest(400, 'Payload tidak valid', 'Sumber data dan daftar langkah wajib valid.')
  }

  const sourceObj = record.source as Record<string, unknown>
  const database = typeof sourceObj.database === 'string' ? sourceObj.database.trim() : ''
  const table = typeof sourceObj.table === 'string' ? sourceObj.table.trim() : ''
  if (!database || !table) {
    badRequest(400, 'Sumber data tidak valid', 'Database dan tabel sumber wajib diisi.')
  }

  const steps = record.steps as PipelineStep[]
  const upTo = record.upTo === undefined ? steps.length : Number(record.upTo)
  if (!Number.isSafeInteger(upTo) || upTo < 0 || upTo > steps.length) {
    badRequest(400, 'Langkah acuan tidak valid', 'Parameter upTo harus berada di antara 0 dan jumlah langkah pipeline.')
  }

  const column = typeof record.column === 'string' ? record.column : ''
  if (!column.trim()) {
    badRequest(400, 'Kolom wajib dipilih', 'Pilih kolom teks untuk mengecek nilai frekuensi rendah.')
  }

  const threshold = record.threshold === undefined ? 10 : Number(record.threshold)
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 1000) {
    badRequest(400, 'Ambang N tidak valid', 'Ambang kemunculan N harus berupa bilangan bulat antara 1 dan 1000.')
  }

  const limit = record.limit === undefined ? 100 : Number(record.limit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    badRequest(400, 'Batas daftar tidak valid', 'Batas daftar nilai frekuensi rendah harus berupa bilangan bulat antara 1 dan 200.')
  }

  const search = record.search === undefined ? '' : record.search
  if (typeof search !== 'string' || search.length > 200) {
    badRequest(400, 'Pencarian tidak valid', 'Kata pencarian harus berupa teks dengan panjang maksimal 200 karakter.')
  }

  const excludeNull = record.excludeNull === undefined ? false : record.excludeNull
  const excludeEmpty = record.excludeEmpty === undefined ? false : record.excludeEmpty
  if (typeof excludeNull !== 'boolean' || typeof excludeEmpty !== 'boolean') {
    badRequest(400, 'Opsi pengecualian tidak valid', 'Opsi pengecualian NULL dan string kosong harus berupa boolean.')
  }

  return {
    source: { database, table },
    steps,
    upTo,
    column,
    threshold,
    limit,
    search,
    excludeNull,
    excludeEmpty,
  }
}

export function getRareValuesMaxExecutionTime(steps: PipelineStep[]): number {
  const hasHeavyOp = steps.some((step) => step?.op === 'fuzzy_match_master' || step?.op === 'deduplicate')
  return hasHeavyOp ? 300 : 180
}

export function isRareValuesTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as {
    code?: unknown
    type?: unknown
    statusCode?: unknown
    message?: unknown
    cause?: unknown
  }
  const code = String(err.code ?? '')
  const type = String(err.type ?? '')
  if (
    code === '159'
    || code === 'ETIMEDOUT'
    || code === 'UND_ERR_HEADERS_TIMEOUT'
    || code === 'UND_ERR_BODY_TIMEOUT'
    || type === 'TIMEOUT_EXCEEDED'
    || err.statusCode === 504
  ) {
    return true
  }
  if (typeof err.message === 'string' && /TIMEOUT_EXCEEDED|max_execution_time|timed\s*out|exceeded.*time|batas waktu/i.test(err.message)) {
    return true
  }
  if (err.cause && err.cause !== error) {
    return isRareValuesTimeoutError(err.cause)
  }
  return false
}
