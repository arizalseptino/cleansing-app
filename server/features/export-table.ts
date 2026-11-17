import type { useClickHouse } from '../utils/clickhouse'
import {
  type ColumnMetadata,
  quoteIdentifier,
  quoteSortingKey,
  requiredParameter,
  validateDatabase,
  validateTable,
} from './metadata'

export type ExportFormat = 'csv' | 'sql'
export type CsvDelimiterKey = 'comma' | 'semicolon' | 'tab'
export type CsvNullAsKey = 'empty' | 'backslashN' | 'NULL'

export type ExportInfoResult = {
  database: string
  table: string
  engine: string
  sortingKey: string
  orderGuaranteed: boolean
  useFinal: boolean
  rowCount: number
  columns: ColumnMetadata[]
}

const READ_METADATA_SETTINGS = {
  readonly: 1,
  max_execution_time: 30,
}

const SQL_TABLE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/
const FINAL_ENGINE_PATTERN = /^(?:Replicated)?(?:Replacing|Collapsing|VersionedCollapsing)MergeTree$/

function exportError(message: string, statusCode: 400 | 404 | 500): never {
  throw createError({ statusCode, statusMessage: message, message })
}

export function isFinalEngine(engine: string): boolean {
  return FINAL_ENGINE_PATTERN.test(engine.trim())
}

export async function getExportTableInfo(
  client: ReturnType<typeof useClickHouse>,
  rawDatabase: unknown,
  rawTable: unknown,
): Promise<ExportInfoResult> {
  const database = requiredParameter({ database: rawDatabase }, 'database', 'Database').trim()
  const table = requiredParameter({ table: rawTable }, 'table', 'Tabel').trim()

  const lowerDb = database.toLowerCase()
  if (lowerDb === 'system' || lowerDb === 'information_schema' || lowerDb === 'bersihdata') {
    exportError('Database sistem dan bersihdata tidak dapat diekspor.', 400)
  }

  await validateDatabase(client, database)
  const metadata = await validateTable(client, database, table)

  let columns: ColumnMetadata[] = []
  try {
    const colResult = await client.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = {database:String} AND table = {table:String}
        ORDER BY position
      `,
      query_params: { database, table },
      format: 'JSONEachRow',
      clickhouse_settings: READ_METADATA_SETTINGS,
    })
    columns = await colResult.json<ColumnMetadata[]>()
  } catch {
    exportError('Daftar kolom tabel tidak dapat diambil dari ClickHouse.', 500)
  }

  const useFinal = isFinalEngine(metadata.engine)
  const sortingKey = metadata.sorting_key.trim()
  const orderGuaranteed = Boolean(sortingKey) && !/^tuple\(\)$/i.test(sortingKey)
  const tableIdentifier = `${quoteIdentifier(database)}.${quoteIdentifier(table)}`
  const finalClause = useFinal ? ' FINAL' : ''

  let rowCount = 0
  if (columns.length > 0) {
    try {
      const countResult = await client.query({
        query: `SELECT count() AS total FROM ${tableIdentifier}${finalClause}`,
        format: 'JSONEachRow',
        clickhouse_settings: READ_METADATA_SETTINGS,
      })
      const countRows = await countResult.json<{ total: number | string }[]>()
      const parsedCount = Number(countRows[0]?.total ?? 0)
      if (!Number.isSafeInteger(parsedCount) || parsedCount < 0) {
        throw new Error('Invalid row count')
      }
      rowCount = parsedCount
    } catch {
      exportError('Jumlah baris tabel tidak dapat dihitung dari ClickHouse.', 500)
    }
  }

  return {
    database,
    table,
    engine: metadata.engine,
    sortingKey,
    orderGuaranteed,
    useFinal,
    rowCount,
    columns,
  }
}

export function parseExportFormat(raw: unknown): ExportFormat {
  if (typeof raw !== 'string') {
    exportError('Parameter format wajib dipilih (csv atau sql).', 400)
  }
  const value = raw.trim().toLowerCase()
  if (value !== 'csv' && value !== 'sql') {
    exportError('Parameter format harus berupa csv atau sql.', 400)
  }
  return value
}

export function parseExportColumns(raw: unknown, allColumns: ColumnMetadata[]): string[] {
  if (allColumns.length === 0) {
    exportError('Tabel tidak memiliki kolom untuk diekspor.', 400)
  }

  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return allColumns.map((col) => col.name)
  }

  if (typeof raw !== 'string') {
    exportError('Parameter columns harus berupa daftar nama kolom dipisah koma.', 400)
  }

  const known = new Set(allColumns.map((col) => col.name))
  const seen = new Set<string>()
  const selected: string[] = []

  for (const part of raw.split(',')) {
    const col = part.trim()
    if (!col) {
      exportError('Daftar kolom tidak valid; terdapat nama kolom kosong.', 400)
    }
    if (!known.has(col)) {
      exportError(`Kolom "${col}" tidak ditemukan pada tabel tersebut.`, 400)
    }
    if (seen.has(col)) {
      exportError(`Kolom "${col}" tercantum lebih dari satu kali.`, 400)
    }
    seen.add(col)
    selected.push(col)
  }

  return selected
}

export function parseOptionalLimit(raw: unknown): number | null {
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return null
  }
  if (typeof raw !== 'string') {
    exportError('Parameter limit harus berupa bilangan bulat positif.', 400)
  }
  const trimmed = raw.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) {
    exportError('Parameter limit harus berupa bilangan bulat positif.', 400)
  }
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    exportError('Parameter limit berada di luar rentang yang didukung.', 400)
  }
  return parsed
}

export function parseBooleanParam(raw: unknown, defaultValue: boolean, label: string): boolean {
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return defaultValue
  }
  if (typeof raw !== 'string') {
    exportError(`Parameter ${label} harus bernilai true atau false.`, 400)
  }
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  exportError(`Parameter ${label} harus bernilai true atau false.`, 400)
}

export function parseCsvDelimiter(raw: unknown): { key: CsvDelimiterKey; value: string } {
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { key: 'comma', value: ',' }
  }
  if (typeof raw !== 'string') {
    exportError('Parameter delimiter harus berupa comma, semicolon, atau tab.', 400)
  }
  const trimmed = raw.trim()
  if (trimmed === 'comma') return { key: 'comma', value: ',' }
  if (trimmed === 'semicolon') return { key: 'semicolon', value: ';' }
  if (trimmed === 'tab') return { key: 'tab', value: '\t' }
  exportError('Parameter delimiter harus berupa comma, semicolon, atau tab.', 400)
}

export function parseCsvNullAs(raw: unknown): { key: CsvNullAsKey; value: string } {
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { key: 'empty', value: '' }
  }
  if (typeof raw !== 'string') {
    exportError('Parameter nullAs harus berupa empty, backslashN, atau NULL.', 400)
  }
  const trimmed = raw.trim()
  if (trimmed === 'empty') return { key: 'empty', value: '' }
  if (trimmed === 'backslashN') return { key: 'backslashN', value: '\\N' }
  if (trimmed === 'NULL') return { key: 'NULL', value: 'NULL' }
  exportError('Parameter nullAs harus berupa empty, backslashN, atau NULL.', 400)
}

export function parseSqlTableName(raw: unknown, defaultTable: string): string {
  const candidate = raw === undefined || (typeof raw === 'string' && raw.trim() === '')
    ? defaultTable
    : raw
  if (typeof candidate !== 'string') {
    exportError('Parameter tableName tidak valid.', 400)
  }
  const trimmed = candidate.trim()
  if (!SQL_TABLE_NAME_PATTERN.test(trimmed)) {
    exportError(
      'Parameter tableName harus diawali huruf, hanya berisi huruf, angka, dan garis bawah, maksimal 64 karakter.',
      400,
    )
  }
  return trimmed
}

export function parseSqlBatchSize(raw: unknown): number {
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return 1000
  }
  if (typeof raw !== 'string') {
    exportError('Parameter batchSize harus berupa bilangan bulat antara 100 dan 10000.', 400)
  }
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) {
    exportError('Parameter batchSize harus berupa bilangan bulat antara 100 dan 10000.', 400)
  }
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 10000) {
    exportError('Parameter batchSize harus berada di antara 100 dan 10000.', 400)
  }
  return parsed
}

export function parseSafeFilename(raw: unknown, defaultBase: string, format: ExportFormat): string {
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    const safeBase = defaultBase.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'ekspor'
    return `${safeBase}.${format}`
  }
  if (typeof raw !== 'string') {
    exportError('Parameter filename tidak valid.', 400)
  }
  const trimmed = raw.trim()
  if (
    !trimmed
    || trimmed.length > 128
    || trimmed.startsWith('.')
    || trimmed.includes('..')
    || !SAFE_FILENAME_PATTERN.test(trimmed)
  ) {
    exportError(
      'Parameter filename hanya boleh berisi huruf, angka, garis bawah, titik, dan tanda hubung (tanpa path atau "..").',
      400,
    )
  }
  return trimmed
}

export function buildExportSelectQuery(
  info: ExportInfoResult,
  selectedColumns: string[],
  limit: number | null,
  clickhouseFormat: 'CSV' | 'CSVWithNames' | 'SQLInsert',
): {
  query: string
  queryParams: Record<string, unknown>
} {
  const tableIdentifier = `${quoteIdentifier(info.database)}.${quoteIdentifier(info.table)}`
  const finalClause = info.useFinal ? ' FINAL' : ''
  const columnList = selectedColumns.map((col) => quoteIdentifier(col)).join(', ')

  let orderClause = ''
  let limitClause = ''
  const queryParams: Record<string, unknown> = {}

  if (limit !== null) {
    if (info.orderGuaranteed) {
      const quotedSort = quoteSortingKey(info.sortingKey, info.columns)
      if (quotedSort.expression.trim()) {
        orderClause = ` ORDER BY ${quotedSort.expression}`
      }
    }
    limitClause = ' LIMIT {export_limit:UInt64}'
    queryParams.export_limit = String(limit)
  }

  return {
    query: `SELECT ${columnList} FROM ${tableIdentifier}${finalClause}${orderClause}${limitClause} FORMAT ${clickhouseFormat}`,
    queryParams,
  }
}

export function rewriteShowCreateTableStatement(rawStatement: string, targetTableName: string): string {
  const trimmed = rawStatement.trim()
  const identToken = '(?:`(?:\\\\.|[^`])*`|[A-Za-z_][A-Za-z0-9_]*)'
  const firstHeaderPattern = new RegExp(
    `^(\\s*CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TEMPORARY\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)(?:${identToken}\\s*\\.\\s*)?${identToken}(?=\\s*(?:\\(|AS\\b|ENGINE\\b|COMMENT\\b|;|$))`,
    'i',
  )

  const match = firstHeaderPattern.exec(trimmed)
  if (!match) {
    exportError('Pernyataan SHOW CREATE TABLE tidak memiliki header CREATE TABLE yang valid.', 500)
  }

  const targetIdent = quoteIdentifier(targetTableName)
  const replaced = `${match[1]}${targetIdent}${trimmed.slice(match[0].length)}`

  if (!replaced.startsWith(match[1] + targetIdent)) {
    exportError('Gagal mengganti nama tabel pada pernyataan CREATE TABLE.', 500)
  }

  return replaced.endsWith(';') ? replaced : `${replaced};`
}
