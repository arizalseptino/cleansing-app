export default defineEventHandler(async () => {
  try {
    const result = await useClickHouse().query({
      query: `
        SELECT name
        FROM system.databases
        WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
        ORDER BY name
      `,
      format: 'JSONEachRow',
    })
    const databases = await result.json<{ name: string }[]>()

    return { data: databases }
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal memuat daftar database',
      message: 'Daftar database tidak dapat diambil dari ClickHouse.',
    })
  }
})
