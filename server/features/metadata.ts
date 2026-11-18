import type { useClickHouse } from '../utils/clickhouse'

export type TableMetadata = {
  engine: string
  sorting_key: string
}

export type ColumnMetadata = {
  name: string
  type: string
  default_kind?: string
}

const querySettings = {
  readonly: 1,
  max_execution_time: 15,
}

function isSystemDatabase(database: string): boolean {
  return ['system', 'information_schema', 'bersihdata'].includes(database.toLowerCase())
}

function databaseError(message: string, statusCode: 400 | 404 | 500): never {
  throw createError({ statusCode, statusMessage: message, message })
}

function isHttpError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'statusCode' in error
    && typeof error.statusCode === 'number',
  )
}

export function requiredParameter(parameters: Record<string, unknown>, key: string, label: string): string {
  const value = parameters[key]
  if (typeof value !== 'string' || !value.trim() || value.length > 256) {
    databaseError(`${label} wajib dipilih.`, 400)
  }
  return value
}

export async function validateDatabase(client: ReturnType<typeof useClickHouse>, database: string): Promise<void> {
  if (isSystemDatabase(database)) {
    databaseError(
      database.toLowerCase() === 'bersihdata'
        ? 'Database khusus aplikasi tidak dapat dipilih sebagai sumber atau master.'
        : 'Database sistem tidak dapat dipilih.',
      400,
    )
  }

  try {
    const result = await client.query({
      query: 'SELECT name FROM system.databases WHERE name = {database:String} LIMIT 1',
      query_params: { database },
      format: 'JSONEachRow',
      clickhouse_settings: querySettings,
    })
    const rows = await result.json<{ name: string }[]>()
    if (rows.length === 0) {
      databaseError('Database yang dipilih tidak ditemukan.', 404)
    }
  } catch (error) {
    if (isHttpError(error)) throw error
    databaseError('Database tidak dapat divalidasi melalui ClickHouse.', 500)
  }
}

export async function validateTable(
  client: ReturnType<typeof useClickHouse>,
  database: string,
  table: string,
): Promise<TableMetadata> {
  try {
    const result = await client.query({
      query: `
        SELECT engine, sorting_key
        FROM system.tables
        WHERE database = {database:String} AND name = {table:String}
        LIMIT 1
      `,
      query_params: { database, table },
      format: 'JSONEachRow',
      clickhouse_settings: querySettings,
    })
    const rows = await result.json<TableMetadata[]>()
    if (!rows[0]) {
      databaseError('Tabel yang dipilih tidak ditemukan dalam database tersebut.', 404)
    }
    return rows[0]
  } catch (error) {
    if (isHttpError(error)) throw error
    databaseError('Tabel tidak dapat divalidasi melalui ClickHouse.', 500)
  }
}

export async function validateTextColumn(
  client: ReturnType<typeof useClickHouse>,
  database: string,
  table: string,
  column: string,
  label: string,
): Promise<void> {
  try {
    const result = await client.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = {database:String}
          AND table = {table:String}
          AND name = {column:String}
        LIMIT 1
      `,
      query_params: { database, table, column },
      format: 'JSONEachRow',
      clickhouse_settings: querySettings,
    })
    const rows = await result.json<ColumnMetadata[]>()
    if (!rows[0]) {
      databaseError(`Kolom ${label} tidak ditemukan pada tabel yang dipilih.`, 404)
    }
    if (!['String', 'Nullable(String)', 'LowCardinality(String)'].includes(rows[0].type)) {
      databaseError(`Kolom ${label} harus bertipe teks.`, 400)
    }
  } catch (error) {
    if (isHttpError(error)) throw error
    databaseError(`Kolom ${label} tidak dapat divalidasi melalui ClickHouse.`, 500)
  }
}

export function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
}

export function quoteSortingKey(sortingKey: string, columns: ColumnMetadata[]): {
  expression: string
  columns: string[]
} {
  const names = new Set(columns.map(({ name }) => name))
  const keyColumns: string[] = []
  const tokens = /`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|[A-Za-z_][A-Za-z0-9_]*|./gs
  const expression = sortingKey.replace(tokens, (token, offset: number, fullExpression: string) => {
    if (token.startsWith("'")) return token

    const quoted = token.startsWith('`')
    const name = quoted ? token.slice(1, -1).replace(/\\([\\`])/g, '$1') : token
    if (!names.has(name)) return token

    if (!quoted && /^\w+$/.test(token) && /^\s*\(/.test(fullExpression.slice(offset + token.length))) {
      return token
    }

    if (!keyColumns.includes(name)) keyColumns.push(name)
    return quoteIdentifier(name)
  })

  return { expression, columns: keyColumns }
}

export async function createMergeTreeTableSafe(
  client: ReturnType<typeof useClickHouse>,
  createSqlBase: string,
  maxExecutionTimeSec = 60,
): Promise<void> {
  const settingsCandidates = [
    " SETTINGS auto_statistics_types = '', string_serialization_version = 'single_stream', serialization_info_version = 'basic'",
    " SETTINGS auto_statistics_types = '', string_serialization_version = 'single_stream'",
    " SETTINGS auto_statistics_types = ''",
    '',
  ]

  let lastError: unknown
  for (let i = 0; i < settingsCandidates.length; i += 1) {
    const suffix = settingsCandidates[i]
    try {
      await client.command({
        query: `${createSqlBase}${suffix}`,
        clickhouse_settings: { max_execution_time: maxExecutionTimeSec },
      })
      return
    } catch (err) {
      lastError = err
      const msg = err instanceof Error ? err.message.toLowerCase() : ''
      const isSettingErr = msg.includes('unknown_setting')
        || msg.includes('unknown setting')
        || msg.includes('auto_statistics_types')
        || msg.includes('string_serialization_version')
        || msg.includes('serialization_info_version')
      if (!isSettingErr || i === settingsCandidates.length - 1) {
        throw err
      }
    }
  }
  throw lastError
}
