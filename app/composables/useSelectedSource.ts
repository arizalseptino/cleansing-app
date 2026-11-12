export function useSelectedSource() {
  const database = useState<string | null>('selected-source-database', () => null)
  const table = useState<string | null>('selected-source-table', () => null)

  function setDatabase(value: string | null) {
    database.value = value
    table.value = null
  }

  function setTable(value: string | null) {
    table.value = value
  }

  return { database, table, setDatabase, setTable }
}
