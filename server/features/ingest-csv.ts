import path from 'node:path'
import { readMultipartFormData, type H3Event } from 'h3'
import Papa from 'papaparse'
import type { useClickHouse } from '../utils/clickhouse'
import { validateDatabase } from './metadata'

export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const MAX_TEXT_BYTES = 2 * 1024 * 1024
export const MAX_COLUMNS = 200
export const PREVIEW_ROW_LIMIT = 20

export const ALLOWED_EXTENSIONS = new Set(['.csv', '.tsv', '.txt'])
export const SUPPORTED_DELIMITERS = [',', ';', '\t', '|'] as const
export type SupportedDelimiter = (typeof SUPPORTED_DELIMITERS)[number]

export const NEW_TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
export const COLUMN_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

export type IngestMode = 'file' | 'text'

export type IngestRequestPayload = {
  mode: IngestMode
  sourceLabel: string
  textNoBom: string
  rawBufferNoBom: Buffer
  delimiterOption: string
  targetDatabase: string
  tableName: string
  columns: string[] | null
}

export type CsvInspectionResult = {
  delimiter: SupportedDelimiter
  detectedDelimiter: SupportedDelimiter
  rawHeaders: string[]
  suggestedColumns: string[]
  previewRows: string[][]
  rowCount: number
  columnCount: number
  normalizedTextBuffer: Buffer
}

export function ingestError(message: string, statusCode: 400 | 404 | 409 | 413 | 500): never {
  throw createError({
    statusCode,
    statusMessage: message,
    message,
  })
}

export function isHttpError(error: unknown): error is { statusCode: number; message: string } {
  return Boolean(
    error
    && typeof error === 'object'
    && 'statusCode' in error
    && typeof error.statusCode === 'number'
    && 'message' in error
    && typeof error.message === 'string',
  )
}

export function sanitizeSourceLabel(filename: string | undefined): string {
  if (!filename) return 'file_unggah.csv'
  const base = path.basename(filename).replace(/[\u0000-\u001F\u007F]/g, '').trim()
  return (base || 'file_unggah.csv').slice(0, 120)
}

export function validateUploadExtension(filename: string | undefined): void {
  const safeName = sanitizeSourceLabel(filename)
  const ext = path.extname(safeName).toLowerCase()
  if (ext === '.xlsx' || ext === '.xls') {
    ingestError('Format Excel (.xlsx/.xls) belum didukung; gunakan ekspor CSV UTF-8 dari Excel.', 400)
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    ingestError('Ekstensi file tidak didukung. Gunakan file .csv, .tsv, atau .txt.', 400)
  }
}

export function decodeUtf8WithoutBom(raw: Buffer): { textNoBom: string; bufferNoBom: Buffer } {
  let cleanBuf = raw
  if (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    cleanBuf = raw.subarray(3)
  }

  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(cleanBuf)
  } catch {
    ingestError('File harus dikodekan sebagai UTF-8 yang valid.', 400)
  }

  if (decoded.startsWith('\uFEFF')) {
    decoded = decoded.slice(1)
    cleanBuf = Buffer.from(decoded, 'utf8')
  }

  if (decoded.includes('\u0000')) {
    ingestError('Isi data mengandung karakter biner yang tidak didukung.', 400)
  }

  const trimmedTrailing = decoded.replace(/(?:\r?\n)+$/, '')
  const normalizedBuffer = trimmedTrailing === decoded
    ? cleanBuf
    : Buffer.from(trimmedTrailing, 'utf8')

  return {
    textNoBom: trimmedTrailing,
    bufferNoBom: normalizedBuffer,
  }
}

export function decodePastedText(rawText: string): { textNoBom: string; bufferNoBom: Buffer } {
  const byteSize = Buffer.byteLength(rawText, 'utf8')
  if (byteSize > MAX_TEXT_BYTES) {
    ingestError('Teks yang ditempel melebihi batas maksimal 2 MB.', 413)
  }

  let cleanText = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText
  if (cleanText.includes('\u0000')) {
    ingestError('Teks mengandung karakter biner yang tidak didukung.', 400)
  }

  cleanText = cleanText.replace(/(?:\r?\n)+$/, '')
  if (!cleanText.trim()) {
    ingestError('Teks data wajib diisi.', 400)
  }

  return {
    textNoBom: cleanText,
    bufferNoBom: Buffer.from(cleanText, 'utf8'),
  }
}

export function detectDelimiter(textNoBom: string, filename?: string): SupportedDelimiter {
  const sample = textNoBom.slice(0, 65536)
  const isTsv = filename?.toLowerCase().endsWith('.tsv') ?? false

  let bestDelimiter: SupportedDelimiter = isTsv ? '\t' : ','
  let bestScore = -1

  for (const candidate of SUPPORTED_DELIMITERS) {
    const parsed = Papa.parse<string[]>(sample, {
      delimiter: candidate,
      header: false,
      preview: 25,
      skipEmptyLines: true,
    })
    if (parsed.errors.length > 0 || parsed.data.length === 0) continue

    const colCount = parsed.data[0]?.length ?? 0
    if (colCount <= 1) continue

    const allConsistent = parsed.data.every((row) => row.length === colCount)
    if (!allConsistent) continue

    const tsvBonus = isTsv && candidate === '\t' ? 5 : 0
    const score = colCount * 10 + tsvBonus
    if (score > bestScore) {
      bestScore = score
      bestDelimiter = candidate
    }
  }

  return bestDelimiter
}

export function resolveDelimiter(option: string, textNoBom: string, filename?: string): {
  delimiter: SupportedDelimiter
  detectedDelimiter: SupportedDelimiter
} {
  const detectedDelimiter = detectDelimiter(textNoBom, filename)
  const trimmed = option.trim()
  if (!trimmed || trimmed === 'auto') {
    return { delimiter: detectedDelimiter, detectedDelimiter }
  }
  const normalized = trimmed === '\\t' || trimmed === 'tab' ? '\t' : trimmed
  if ((SUPPORTED_DELIMITERS as readonly string[]).includes(normalized)) {
    return {
      delimiter: normalized as SupportedDelimiter,
      detectedDelimiter,
    }
  }
  ingestError('Pemisah kolom tidak didukung. Pilih koma, titik koma, tab, atau pipa.', 400)
}

export function sanitizeColumnNames(rawHeaders: string[]): string[] {
  const used = new Set<string>()
  return rawHeaders.map((rawHeader, index) => {
    const ascii = rawHeader
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
    let base = ascii
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')

    if (!base) {
      base = `kolom_${index + 1}`
    } else if (/^\d/.test(base)) {
      base = `kolom_${base}`
    }

    base = base.slice(0, 64).replace(/_+$/g, '') || `kolom_${index + 1}`

    let candidate = base
    let suffixNum = 2
    while (used.has(candidate)) {
      const suffix = `_${suffixNum}`
      const truncated = base.slice(0, 64 - suffix.length).replace(/_+$/g, '') || 'kolom'
      candidate = `${truncated}${suffix}`
      suffixNum += 1
    }

    used.add(candidate)
    return candidate
  })
}

export function validateTargetColumns(columns: unknown, expectedCount: number): string[] {
  if (!Array.isArray(columns)) {
    ingestError('Daftar nama kolom hasil wajib dikirim.', 400)
  }
  if (columns.length === 0 || columns.length > MAX_COLUMNS) {
    ingestError(`Jumlah kolom harus antara 1 dan ${MAX_COLUMNS}.`, 400)
  }
  if (columns.length !== expectedCount) {
    ingestError(`Jumlah nama kolom (${columns.length}) tidak sama dengan jumlah kolom data (${expectedCount}).`, 400)
  }

  const seen = new Set<string>()
  const validated: string[] = []

  for (let i = 0; i < columns.length; i += 1) {
    const raw = columns[i]
    if (typeof raw !== 'string') {
      ingestError(`Nama kolom ke-${i + 1} tidak valid.`, 400)
    }
    const name = raw.trim()
    if (!COLUMN_NAME_PATTERN.test(name)) {
      ingestError(
        `Nama kolom ke-${i + 1} ("${name || '(kosong)'}") harus diawali huruf atau garis bawah, hanya berisi huruf, angka, dan garis bawah, maksimal 64 karakter.`,
        400,
      )
    }
    if (seen.has(name)) {
      ingestError(`Nama kolom "${name}" duplikat. Setiap kolom harus memiliki nama yang unik.`, 400)
    }
    seen.add(name)
    validated.push(name)
  }

  return validated
}

export function validateNewTableName(rawName: unknown): string {
  if (typeof rawName !== 'string' || !rawName.trim()) {
    ingestError('Nama tabel baru wajib diisi.', 400)
  }
  const name = rawName.trim()
  if (!NEW_TABLE_NAME_PATTERN.test(name)) {
    ingestError(
      'Nama tabel harus diawali huruf, hanya boleh berisi huruf, angka, dan garis bawah, serta maksimal 64 karakter.',
      400,
    )
  }
  return name
}

export async function ensureTableDoesNotExist(
  client: ReturnType<typeof useClickHouse>,
  database: string,
  tableName: string,
): Promise<void> {
  await validateDatabase(client, database)
  const existing = await client.query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = {database:String} AND name = {table:String}
      LIMIT 1
    `,
    query_params: { database, table: tableName },
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: 1, max_execution_time: 15 },
  })
  const rows = await existing.json<{ name: string }[]>()
  if (rows.length > 0) {
    ingestError('Nama tabel sudah digunakan pada database tersebut. Gunakan nama lain.', 409)
  }
}

export function inspectCsvPayload(
  textNoBom: string,
  delimiterOption: string,
  filename?: string,
): CsvInspectionResult {
  if (!textNoBom.trim()) {
    ingestError('Data CSV kosong dan tidak memiliki baris judul.', 400)
  }

  const { delimiter, detectedDelimiter } = resolveDelimiter(delimiterOption, textNoBom, filename)

  const parsed = Papa.parse<string[]>(textNoBom, {
    delimiter,
    header: false,
    skipEmptyLines: false,
  })

  if (parsed.errors.length > 0) {
    const firstErr = parsed.errors[0]
    const rowLabel = typeof firstErr?.row === 'number' ? ` pada baris ke-${firstErr.row + 1}` : ''
    ingestError(`Format CSV tidak valid${rowLabel}. Periksa tanda kutip atau pemisah kolom.`, 400)
  }

  const rows = parsed.data
  if (rows.length === 0) {
    ingestError('Data CSV kosong dan tidak memiliki baris judul.', 400)
  }

  const rawHeaders = (rows[0] ?? []).map((cell) => String(cell ?? ''))
  if (rawHeaders.length === 0) {
    ingestError('Baris judul tidak memiliki kolom.', 400)
  }
  if (rawHeaders.length > MAX_COLUMNS) {
    ingestError(`Jumlah kolom (${rawHeaders.length}) melebihi batas maksimal ${MAX_COLUMNS} kolom.`, 400)
  }

  const expectedCols = rawHeaders.length
  const dataRows = rows.slice(1)
  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i] ?? []
    if (row.length !== expectedCols) {
      ingestError(
        `Baris data ke-${i + 1} memiliki ${row.length} kolom, seharusnya ${expectedCols} kolom. Periksa pemisah kolom atau baris yang rusak.`,
        400,
      )
    }
  }

  const suggestedColumns = sanitizeColumnNames(rawHeaders)
  const previewRows = dataRows
    .slice(0, PREVIEW_ROW_LIMIT)
    .map((row) => row.map((cell) => String(cell ?? '')))

  return {
    delimiter,
    detectedDelimiter,
    rawHeaders,
    suggestedColumns,
    previewRows,
    rowCount: dataRows.length,
    columnCount: expectedCols,
    normalizedTextBuffer: Buffer.from(textNoBom, 'utf8'),
  }
}

export async function readIngestPayload(event: H3Event): Promise<IngestRequestPayload> {
  const contentLengthHeader = getHeader(event, 'content-length')
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader)
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES + 2 * 1024 * 1024) {
      ingestError('Ukuran data yang dikirim melebihi batas maksimal 50 MB.', 413)
    }
  }

  const contentType = (getHeader(event, 'content-type') ?? '').toLowerCase()

  if (contentType.includes('multipart/form-data')) {
    const parts = await readMultipartFormData(event)
    if (!parts || parts.length === 0) {
      ingestError('Permintaan unggahan data kosong.', 400)
    }

    let filePart: { filename?: string; data: Buffer } | null = null
    const fields = new Map<string, string>()

    for (const part of parts) {
      if (part.name === 'file' && (part.filename || part.data.length > 0)) {
        filePart = { filename: part.filename, data: part.data }
      } else if (part.name) {
        fields.set(part.name, part.data.toString('utf8'))
      }
    }

    const delimiterOption = fields.get('delimiter') ?? 'auto'
    const targetDatabase = fields.get('targetDatabase') ?? ''
    const tableName = fields.get('tableName') ?? ''
    const columnsRaw = fields.get('columns')
    let parsedColumns: string[] | null = null
    if (columnsRaw !== undefined && columnsRaw.trim() !== '') {
      try {
        const jsonVal: unknown = JSON.parse(columnsRaw)
        parsedColumns = Array.isArray(jsonVal) ? jsonVal.map((item) => String(item ?? '')) : null
      } catch {
        ingestError('Daftar nama kolom hasil tidak valid.', 400)
      }
    }

    if (filePart) {
      validateUploadExtension(filePart.filename)
      if (filePart.data.length === 0) {
        ingestError('File yang diunggah kosong.', 400)
      }
      if (filePart.data.length > MAX_FILE_BYTES) {
        ingestError('Ukuran file melebihi batas maksimal 50 MB.', 413)
      }

      const sourceLabel = sanitizeSourceLabel(filePart.filename)
      const { textNoBom, bufferNoBom } = decodeUtf8WithoutBom(filePart.data)
      if (!textNoBom.trim()) {
        ingestError('File tidak berisi baris data atau judul.', 400)
      }

      return {
        mode: 'file',
        sourceLabel,
        textNoBom,
        rawBufferNoBom: bufferNoBom,
        delimiterOption,
        targetDatabase,
        tableName,
        columns: parsedColumns,
      }
    }

    const pastedText = fields.get('pastedText')
    if (typeof pastedText !== 'string') {
      ingestError('Pilih file CSV/TSV/TXT atau tempel teks data terlebih dahulu.', 400)
    }

    const { textNoBom, bufferNoBom } = decodePastedText(pastedText)
    return {
      mode: 'text',
      sourceLabel: 'teks tempel',
      textNoBom,
      rawBufferNoBom: bufferNoBom,
      delimiterOption,
      targetDatabase,
      tableName,
      columns: parsedColumns,
    }
  }

  let body: Record<string, unknown>
  try {
    body = await readBody<Record<string, unknown>>(event)
  } catch {
    ingestError('Format permintaan tidak valid.', 400)
  }

  if (!body || typeof body !== 'object') {
    ingestError('Isi permintaan tidak valid.', 400)
  }

  if (typeof body.pastedText !== 'string') {
    ingestError('Teks data wajib diisi.', 400)
  }

  const { textNoBom, bufferNoBom } = decodePastedText(body.pastedText)
  const delimiterOption = typeof body.delimiter === 'string' ? body.delimiter : 'auto'
  const targetDatabase = typeof body.targetDatabase === 'string' ? body.targetDatabase : ''
  const tableName = typeof body.tableName === 'string' ? body.tableName : ''
  const columns = Array.isArray(body.columns)
    ? body.columns.map((item) => String(item ?? ''))
    : null

  return {
    mode: 'text',
    sourceLabel: 'teks tempel',
    textNoBom,
    rawBufferNoBom: bufferNoBom,
    delimiterOption,
    targetDatabase,
    tableName,
    columns,
  }
}

export function sanitizeIngestErrorMessage(error: unknown, fallback: string): string {
  if (isHttpError(error)) {
    return error.message
  }
  if (error instanceof Error && error.message) {
    const raw = error.message
    if (raw.toLowerCase().includes('timeout') || raw.toLowerCase().includes('timed out')) {
      return `${fallback} Penyebab: Waktu eksekusi habis (timeout) saat memproses data.`
    }
    const cleanMsg = raw.replace(/^DB::Exception:\s*/i, '').split('\n')[0]?.trim() || raw
    return `${fallback} Detail: ${cleanMsg}`
  }
  return fallback
}
