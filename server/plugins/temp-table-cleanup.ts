import { useClickHouse } from '../utils/clickhouse'
import { triggerStartupTempTableCleanup } from '../features/temp-table-registry'

export default defineNitroPlugin(() => {
  try {
    const client = useClickHouse()
    triggerStartupTempTableCleanup(client)
  } catch (err) {
    console.warn('[temp-registry] Tidak dapat menjadwalkan pembersihan tabel sementara startup:', err)
  }
})
