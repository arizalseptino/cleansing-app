import type { useClickHouse } from '../utils/clickhouse'
import type { ColumnMetadata, SourceReference } from './types'

export const readonlySettings = { readonly: 1, max_execution_time: 30 }

export function isSystemDatabase(database: string): boolean {
  return ['system', 'information_schema', 'bersihdata'].includes(database.toLowerCase())
}

export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
}

export function safeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function normalizeColumnName(value: unknown): string {
  const name = safeString(value).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nama kolom tidak valid',
      message: 'Nama kolom baru harus diawali huruf atau garis bawah, maksimal 64 karakter, dan hanya memuat huruf, angka, dan garis bawah.',
    })
  }
  return name
}

export async function validateDatabase(client: ReturnType<typeof useClickHouse>, database: string): Promise<void> {
  if (isSystemDatabase(database)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Database sistem tidak dapat dipilih',
      message: 'Pilih database selain database sistem dan database aplikasi.',
    })
  }

  try {
    const result = await client.query({
      query: 'SELECT name FROM system.databases WHERE name = {database:String} LIMIT 1',
      query_params: { database },
      format: 'JSONEachRow',
      clickhouse_settings: readonlySettings,
    })
    const rows = await result.json<{ name: string }[]>()
    if (rows.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Database tidak ditemukan',
        message: 'Database yang dipilih tidak ditemukan di ClickHouse.',
      })
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal validasi database',
      message: 'Database tidak dapat divalidasi melalui ClickHouse.',
    })
  }
}

export async function getTableMetadata(client: ReturnType<typeof useClickHouse>, source: SourceReference): Promise<{ engine: string; sorting_key: string }> {
  await validateDatabase(client, source.database)

  try {
    const result = await client.query({
      query: 'SELECT engine, sorting_key FROM system.tables WHERE database = {database:String} AND name = {table:String} LIMIT 1',
      query_params: { database: source.database, table: source.table },
      format: 'JSONEachRow',
      clickhouse_settings: readonlySettings,
    })
    const rows = await result.json<{ engine: string; sorting_key: string }[]>()
    if (!rows[0]) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Tabel tidak ditemukan',
        message: 'Tabel sumber tidak ditemukan di database tersebut.',
      })
    }
    return rows[0]
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal validasi tabel',
      message: 'Tabel sumber tidak dapat divalidasi melalui ClickHouse.',
    })
  }
}

export async function getTableColumns(client: ReturnType<typeof useClickHouse>, source: SourceReference): Promise<ColumnMetadata[]> {
  try {
    const result = await client.query({
      query: 'SELECT name, type, default_kind FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position',
      query_params: { database: source.database, table: source.table },
      format: 'JSONEachRow',
      clickhouse_settings: readonlySettings,
    })
    return await result.json<ColumnMetadata[]>()
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal membaca skema tabel',
      message: 'Skema tabel sumber tidak dapat dibaca dari ClickHouse.',
    })
  }
}

export function isTextType(type: string): boolean {
  let normalized = type.trim()
  while (/^(Nullable|LowCardinality)\s*\((.*)\)$/.test(normalized)) {
    normalized = normalized.replace(/^(Nullable|LowCardinality)\s*\((.*)\)$/, '$2').trim()
  }
  return normalized === 'String'
}

export function ensureColumnExists(schema: ColumnMetadata[], column: string, label: string): string {
  const found = schema.find((item) => item.name === column)
  if (!found) {
    throw createError({
      statusCode: 404,
      statusMessage: `${label} tidak ditemukan`,
      message: `Kolom ${label} tidak ditemukan pada tabel sumber.`,
    })
  }
  return found.name
}

export function ensureTextColumn(schema: ColumnMetadata[], column: string, label: string): string {
  const found = schema.find((item) => item.name === column)
  if (!found) {
    throw createError({
      statusCode: 404,
      statusMessage: `${label} tidak ditemukan`,
      message: `Kolom ${label} tidak ditemukan pada tabel sumber.`,
    })
  }
  if (!isTextType(found.type)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label} harus bertipe teks`,
      message: `Kolom ${label} harus bertipe teks agar operasi ini dapat dijalankan.`,
    })
  }
  return found.name
}

export function buildInputSql(source: SourceReference): string {
  return `SELECT * FROM ${quoteIdentifier(source.database)}.${quoteIdentifier(source.table)}`
}

export function makeParamLabel(prefix: string, index: number): string {
  return `${prefix}${index}`
}
