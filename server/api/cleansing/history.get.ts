import { ensureCleansingHistoryTable } from '../../features/cleansing-history'
import { quoteIdentifier } from '../../features/metadata'

type HistoryRow = {
  id: string
  waktu_mulai: string
  durasi_ms: number
  fitur_id: string
  database_sumber: string
  tabel_sumber: string
  tabel_hasil: string
  parameter: string
  baris_sumber: number
  baris_terisi: number
  baris_ambigu: number
  status: string
  pesan: string | null
}

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message, message })
}

function parseInteger(value: unknown, name: string, defaultValue: number): number {
  if (value === undefined) return defaultValue
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    badRequest(`${name} harus berupa bilangan bulat.`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    badRequest(`${name} berada di luar rentang yang didukung.`)
  }
  return parsed
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const page = parseInteger(query.page, 'page', 1)
  const limit = parseInteger(query.limit, 'limit', 50)
  if (page < 1) badRequest('page harus bernilai minimal 1.')
  if (limit < 1 || limit > 100) badRequest('limit harus berada di antara 1 dan 100.')

  const offset = (page - 1) * limit
  if (!Number.isSafeInteger(offset)) {
    badRequest('Kombinasi page dan limit terlalu besar.')
  }

  const client = useClickHouse()
  try {
    await ensureCleansingHistoryTable(client)
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal menyiapkan tabel riwayat',
      message: 'Tabel riwayat tidak dapat disiapkan di ClickHouse.',
    })
  }

  const table = `${quoteIdentifier('bersihdata')}.${quoteIdentifier('riwayat_cleansing')}`
  try {
    const countResult = await client.query({
      query: `SELECT count() AS total FROM ${table}`,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 15 },
    })
    const countRows = await countResult.json<{ total: number | string }[]>()
    const total = Number(countRows[0]?.total ?? 0)
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error('Jumlah riwayat tidak valid.')
    }

    const rowsResult = await client.query({
      query: `
        SELECT
          ${quoteIdentifier('id')},
          formatDateTime(${quoteIdentifier('waktu_mulai')}, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS ${quoteIdentifier('waktu_mulai')},
          ${quoteIdentifier('durasi_ms')},
          ${quoteIdentifier('fitur_id')},
          ${quoteIdentifier('database_sumber')},
          ${quoteIdentifier('tabel_sumber')},
          ${quoteIdentifier('tabel_hasil')},
          ${quoteIdentifier('parameter')},
          ${quoteIdentifier('baris_sumber')},
          ${quoteIdentifier('baris_terisi')},
          ${quoteIdentifier('baris_ambigu')},
          ${quoteIdentifier('status')},
          ${quoteIdentifier('pesan')}
        FROM ${table}
        ORDER BY ${quoteIdentifier('waktu_mulai')} DESC, ${quoteIdentifier('id')} DESC
        LIMIT {limit:UInt32} OFFSET {offset:UInt64}
      `,
      query_params: { limit, offset: String(offset) },
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 15 },
    })
    const data = await rowsResult.json<HistoryRow[]>()
    return { data, total, page, limit }
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal memuat riwayat cleansing',
      message: 'Riwayat cleansing tidak dapat diambil dari ClickHouse.',
    })
  }
})
