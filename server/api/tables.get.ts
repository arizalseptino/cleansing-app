export default defineEventHandler(async (event) => {
  const { database } = getQuery(event)

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

  try {
    const result = await useClickHouse().query({
      query: 'SELECT name, engine FROM system.tables WHERE database = {db:String} ORDER BY name',
      query_params: { db: database },
      format: 'JSONEachRow',
    })
    const tables = await result.json<{ name: string; engine: string }[]>()

    return { data: tables }
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal memuat daftar tabel',
      message: 'Daftar tabel tidak dapat diambil dari ClickHouse.',
    })
  }
})
