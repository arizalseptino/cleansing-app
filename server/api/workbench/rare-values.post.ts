import { compilePipeline } from '../../workbench/compiler'
import type { PipelineStep } from '../../workbench/types'
import { isTextType, quoteIdentifier, readonlySettings } from '../../workbench/utils'

function badRequest(statusCode: number, statusMessage: string, message: string): never {
  throw createError({ statusCode, statusMessage, message })
}

export default defineEventHandler(async (event) => {
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    badRequest(400, 'Payload tidak valid', 'Body harus berupa JSON yang valid.')
  }

  if (!body || typeof body !== 'object' || !('source' in body) || !('steps' in body)) {
    badRequest(400, 'Payload tidak valid', 'Body harus berisi source dan steps.')
  }

  const record = body as Record<string, unknown>
  if (!record.source || typeof record.source !== 'object' || !Array.isArray(record.steps)) {
    badRequest(400, 'Payload tidak valid', 'Sumber data dan daftar langkah wajib valid.')
  }

  const steps = record.steps as PipelineStep[]
  const upTo = record.upTo === undefined ? steps.length : Number(record.upTo)
  if (!Number.isSafeInteger(upTo) || upTo < 0 || upTo > steps.length) {
    badRequest(400, 'Langkah acuan tidak valid', 'Parameter upTo harus berada di antara 0 dan jumlah langkah pipeline.')
  }

  const column = typeof record.column === 'string' ? record.column : ''
  if (!column.trim()) {
    badRequest(400, 'Kolom wajib dipilih', 'Pilih kolom teks untuk mengecek nilai frekuensi rendah.')
  }

  const threshold = record.threshold === undefined ? 10 : Number(record.threshold)
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 1000) {
    badRequest(400, 'Ambang N tidak valid', 'Ambang kemunculan N harus berupa bilangan bulat antara 1 dan 1000.')
  }

  const limit = record.limit === undefined ? 100 : Number(record.limit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    badRequest(400, 'Batas daftar tidak valid', 'Batas daftar nilai frekuensi rendah harus berupa bilangan bulat antara 1 dan 200.')
  }

  const search = record.search === undefined ? '' : record.search
  if (typeof search !== 'string' || search.length > 200) {
    badRequest(400, 'Pencarian tidak valid', 'Kata pencarian harus berupa teks dengan panjang maksimal 200 karakter.')
  }

  const excludeNull = record.excludeNull === undefined ? false : record.excludeNull
  const excludeEmpty = record.excludeEmpty === undefined ? false : record.excludeEmpty
  if (typeof excludeNull !== 'boolean' || typeof excludeEmpty !== 'boolean') {
    badRequest(400, 'Opsi pengecualian tidak valid', 'Opsi pengecualian NULL dan string kosong harus berupa boolean.')
  }

  const client = useClickHouse()
  const compiled = await compilePipeline(client, {
    source: record.source as { database: string; table: string },
    steps: steps.slice(0, upTo),
  })

  const columnMeta = compiled.schema.find((item) => item.name === column)
  if (!columnMeta) {
    badRequest(404, 'Kolom tidak ditemukan', `Kolom "${column}" tidak ditemukan pada keluaran langkah ke-${upTo}.`)
  }
  if (!isTextType(columnMeta.type)) {
    badRequest(400, 'Kolom harus bertipe teks', `Kolom "${column}" (${columnMeta.type}) bukan kolom bertipe teks.`)
  }

  const quoted = quoteIdentifier(columnMeta.name)
  const baseWhereConditions: string[] = []
  const queryParams: Record<string, unknown> = {
    ...compiled.params,
    rv_threshold: threshold,
    rv_limit: limit,
  }

  if (excludeNull) {
    baseWhereConditions.push(`NOT isNull(${quoted})`)
  }
  if (excludeEmpty) {
    baseWhereConditions.push(`(isNull(${quoted}) OR toString(${quoted}) != '')`)
  }
  const listWhereConditions = [...baseWhereConditions]
  if (search.length > 0) {
    queryParams.rv_search = search
    listWhereConditions.push(
      `positionCaseInsensitiveUTF8(if(isNull(${quoted}), '(NULL)', if(toString(${quoted}) = '', '(kosong)', toString(${quoted}))), {rv_search:String}) > 0`,
    )
  }

  const baseWhereClause = baseWhereConditions.length ? `WHERE ${baseWhereConditions.join(' AND ')}` : ''
  const whereClause = listWhereConditions.length ? `WHERE ${listWhereConditions.join(' AND ')}` : ''

  try {
    const [listResult, summaryResult] = await Promise.all([
      client.query({
        query: `
          SELECT
            isNull(${quoted}) AS is_null,
            ifNull(toString(${quoted}), '') AS val,
            count() AS cnt
          FROM (${compiled.sql})
          ${whereClause}
          GROUP BY isNull(${quoted}), ifNull(toString(${quoted}), '')
          HAVING count() < {rv_threshold:UInt32}
          ORDER BY cnt ASC, val ASC, is_null DESC
          LIMIT {rv_limit:UInt32}
        `,
        query_params: queryParams,
        format: 'JSONEachRow',
        clickhouse_settings: readonlySettings,
      }),
      client.query({
        query: `
          SELECT
            count() AS unique_values,
            countIf(cnt < {rv_threshold:UInt32}) AS rare_values,
            sum(if(cnt < {rv_threshold:UInt32}, cnt, 0)) AS affected_rows
          FROM (
            SELECT count() AS cnt
            FROM (${compiled.sql})
            ${baseWhereClause}
            GROUP BY isNull(${quoted}), ifNull(toString(${quoted}), '')
          )
        `,
        query_params: queryParams,
        format: 'JSONEachRow',
        clickhouse_settings: readonlySettings,
      }),
    ])

    const listRows = await listResult.json<Array<{ is_null: number | string; val: string; cnt: number | string }>>()
    const summaryRows = await summaryResult.json<Array<{
      unique_values: number | string
      rare_values: number | string
      affected_rows: number | string
    }>>()
    const summaryRow = summaryRows[0]

    return {
      column: columnMeta.name,
      upTo,
      threshold,
      limit,
      items: listRows.map((row) => {
        const isNull = Number(row.is_null) === 1
        const textVal = String(row.val ?? '')
        const jenis: 'null' | 'empty' | 'text' = isNull ? 'null' : textVal === '' ? 'empty' : 'text'
        return {
          nilai: isNull ? '(NULL)' : textVal === '' ? '(kosong)' : textVal,
          jumlah: Number(row.cnt ?? 0),
          jenis,
          nilaiAsli: isNull ? null : textVal,
        }
      }),
      summary: {
        uniqueValues: Number(summaryRow?.unique_values ?? 0),
        rareValues: Number(summaryRow?.rare_values ?? 0),
        affectedRows: Number(summaryRow?.affected_rows ?? 0),
      },
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal menganalisis nilai frekuensi rendah',
      message: 'Analisis nilai frekuensi rendah tidak dapat dihitung melalui ClickHouse.',
    })
  }
})
