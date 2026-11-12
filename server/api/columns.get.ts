export default defineEventHandler(async (event) => {
  const { database, table } = getQuery(event)

  if (typeof database !== 'string' || !database.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Database wajib dipilih',
      message: 'Parameter database wajib diisi.',
    })
  }

  if (['system', 'INFORMATION_SCHEMA', 'information_schema'].includes(database)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Database sistem tidak dapat dipilih',
      message: 'Pilih database selain database sistem.',
    })
  }

  if (typeof table !== 'string' || !table.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Tabel wajib dipilih',
      message: 'Parameter tabel wajib diisi.',
    })
  }

  let databaseRows: { name: string }[]
  try {
    const result = await useClickHouse().query({
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

  let tableRows: { name: string }[]
  try {
    const result = await useClickHouse().query({
      query: 'SELECT name FROM system.tables WHERE database = {db:String} AND name = {table:String} LIMIT 1',
      query_params: { db: database, table },
      format: 'JSONEachRow',
    })
    tableRows = await result.json<{ name: string }[]>()
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal memvalidasi tabel',
      message: 'Tabel tidak dapat divalidasi melalui ClickHouse.',
    })
  }

  if (tableRows.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Tabel tidak ditemukan',
      message: 'Tabel yang diminta tidak ditemukan dalam database tersebut.',
    })
  }

  try {
    const result = await useClickHouse().query({
      query: 'SELECT name, type FROM system.columns WHERE database = {db:String} AND table = {table:String} ORDER BY position',
      query_params: { db: database, table },
      format: 'JSONEachRow',
    })
    const columns = await result.json<{ name: string; type: string }[]>()

    return { data: columns }
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal memuat daftar kolom',
      message: 'Daftar kolom tidak dapat diambil dari ClickHouse.',
    })
  }
})
