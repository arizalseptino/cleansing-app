import { getExportTableInfo } from '../../features/export-table'

export default defineEventHandler(async (event) => {
  const { database, table } = getQuery(event)
  const client = useClickHouse()
  return getExportTableInfo(client, database, table)
})
