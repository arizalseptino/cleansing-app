type Column = { name: string; type: string }
type TableMetadata = { engine: string; sorting_key: string }

function badRequest(message: string): never {
  throw createError({
    statusCode: 400,
    statusMessage: message,
    message,
  })
}

function parseInteger(value: unknown, name: string, defaultValue?: number): number {
  if (value === undefined && defaultValue !== undefined) {
    return defaultValue
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return badRequest(`${name} harus berupa bilangan bulat.`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    return badRequest(`${name} berada di luar rentang yang didukung.`)
  }

  return parsed
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
}

function quoteSortingKey(sortingKey: string, columns: Column[]): string {
  const columnNames = new Set(columns.map(({ name }) => name))
  const tokenPattern = /`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|[A-Za-z_][A-Za-z0-9_]*|./gs

  return sortingKey.replace(tokenPattern, (token, offset: number, expression: string) => {
    if (token.startsWith("'")) {
      return token
    }

    const isQuotedIdentifier = token.startsWith('`')
    const name = isQuotedIdentifier
      ? token.slice(1, -1).replace(/\\([\\`])/g, '$1')
      : token

    if (!columnNames.has(name)) {
      return token
    }

    if (!isQuotedIdentifier && /^\w+$/.test(token)) {
      const remainder = expression.slice(offset + token.length)
      if (/^\s*\(/.test(remainder)) {
        return token
      }
    }

    return quoteIdentifier(name)
  })
}

export default defineEventHandler(async (event) => {
  const { database, table, page: pageValue, limit: limitValue } = getQuery(event)

  if (typeof database !== 'string' || !database.trim()) {
    badRequest('Parameter database wajib diisi.')
  }

  if (['system', 'information_schema'].includes(database.toLowerCase())) {
    badRequest('Database sistem tidak dapat dipilih.')
  }

  if (typeof table !== 'string' || !table.trim()) {
    badRequest('Parameter table wajib diisi.')
  }

  const page = parseInteger(pageValue, 'page', 1)
  const limit = parseInteger(limitValue, 'limit', 50)
  if (page < 1) {
    badRequest('page harus bernilai minimal 1.')
  }
  if (limit < 1 || limit > 100) {
    badRequest('limit harus berada di antara 1 dan 100.')
  }

  const offset = (page - 1) * limit
  if (!Number.isSafeInteger(offset)) {
    badRequest('Kombinasi page dan limit terlalu besar.')
  }

  const client = useClickHouse()
  let databaseRows: { name: string }[]
  try {
    const result = await client.query({
      query: 'SELECT name FROM system.databases WHERE name = {db:String} LIMIT 1',
      query_params: { db: database },
      format: 'JSONEachRow',
    })
    databaseRows = await result.json<{ name: string }[]>()
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal memvalidasi database',
      message: 'Database tidak dapat divalidasi melalui ClickHouse.',
    })
  }

  if (databaseRows.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Database tidak ditemukan',
      message: 'Database yang diminta tidak ditemukan.',
    })
  }

  let tableRows: TableMetadata[]
  try {
    const result = await client.query({
      query: `
        SELECT engine, sorting_key
        FROM system.tables
        WHERE database = {db:String} AND name = {table:String}
        LIMIT 1
      `,
      query_params: { db: database, table },
      format: 'JSONEachRow',
    })
    tableRows = await result.json<TableMetadata[]>()
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal memvalidasi tabel',
      message: 'Tabel tidak dapat divalidasi melalui ClickHouse.',
    })
  }

  const metadata = tableRows[0]
  if (!metadata) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Tabel tidak ditemukan',
      message: 'Tabel yang diminta tidak ditemukan dalam database tersebut.',
    })
  }

  let columns: Column[]
  try {
    const result = await client.query({
      query: `
        SELECT name, type
        FROM system.columns
        WHERE database = {db:String} AND table = {table:String}
        ORDER BY position
      `,
      query_params: { db: database, table },
      format: 'JSONEachRow',
    })
    columns = await result.json<Column[]>()
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal memuat kolom',
      message: 'Daftar kolom tabel tidak dapat diambil dari ClickHouse.',
    })
  }

  const sortingKey = metadata.sorting_key.trim()
  const hasSortingKey = Boolean(sortingKey) && !/^tuple\(\)$/i.test(sortingKey)
  const useFinal = /^(?:Replicated)?(?:Replacing|Collapsing|VersionedCollapsing)MergeTree$/.test(metadata.engine)
  const tableIdentifier = `${quoteIdentifier(database)}.${quoteIdentifier(table)}`
  const finalClause = useFinal ? ' FINAL' : ''

  try {
    let count = 0
    let rows: Record<string, unknown>[] = []

    if (columns.length > 0) {
      const countResult = await client.query({
        query: `SELECT count() AS total FROM ${tableIdentifier}${finalClause}`,
        format: 'JSONEachRow',
      })
      const countRows = await countResult.json<{ total: number | string }[]>()
      const countRow = countRows[0]
      const parsedCount = Number(countRow?.total)
      if (!Number.isSafeInteger(parsedCount) || parsedCount < 0) {
        throw new Error('ClickHouse returned an invalid row count.')
      }
      count = parsedCount

      const orderClause = hasSortingKey
        ? ` ORDER BY ${quoteSortingKey(sortingKey, columns)}`
        : ''
      const selectResult = await client.query({
        query: `
          SELECT ${columns.map(({ name }) => quoteIdentifier(name)).join(', ')}
          FROM ${tableIdentifier}${finalClause}${orderClause}
          LIMIT {limit:UInt32} OFFSET {offset:UInt64}
        `,
        query_params: { limit, offset: String(offset) },
        format: 'JSONEachRow',
      })
      rows = await selectResult.json<Record<string, unknown>[]>()
    }

    return {
      columns,
      rows,
      count,
      page,
      limit,
      orderGuaranteed: hasSortingKey,
    }
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal memuat isi tabel',
      message: 'Isi tabel tidak dapat diambil dari ClickHouse.',
    })
  }
})
