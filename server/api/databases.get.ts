export default defineEventHandler(async () => {
  try {
    const result = await useClickHouse().query({
      query: `
        SELECT name
        FROM system.databases
        WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
          AND name != {applicationDatabase:String}
        ORDER BY name
      `,
      query_params: { applicationDatabase: 'bersihdata' },
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 15 },
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
