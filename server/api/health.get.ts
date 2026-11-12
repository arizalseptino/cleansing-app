import { useClickHouse } from "../utils/clickhouse"

export default defineEventHandler(async () => {
  const ch = useClickHouse()
  try {
    const rs = await ch.query({
      query: 'SELECT version() AS version',
      format: 'JSONEachRow',
    })
    const rows = await rs.json<{ version: string }>()
    const version = rows[0]?.version

    if (!version) {
      return { ok: false, message: 'ClickHouse version unavailable' }
    }

    return { ok: true, version }
  } catch (e: any) {
    return { ok: false, message: e.message }
  }
})