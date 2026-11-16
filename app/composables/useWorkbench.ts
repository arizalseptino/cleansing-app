export type WorkbenchSource = {
  database: string
  table: string
}

export type WorkbenchStep = {
  id: string
  op: string
  params: Record<string, unknown>
}

type StoredPipeline = {
  source: WorkbenchSource
  steps: WorkbenchStep[]
}

const storageKey = 'bersihdata-workbench-v1'

export function useWorkbench() {
  const selectedSource = useSelectedSource()
  const pipeline = useState<StoredPipeline>('workbench-pipeline', () => ({
    source: { database: '', table: '' },
    steps: [],
  }))
  const selectedStep = useState<number>('workbench-selected-step', () => 0)
  const page = useState<number>('workbench-page', () => 1)
  const limit = useState<number>('workbench-limit', () => 50)
  const persistenceError = useState<string>('workbench-persistence-error', () => '')
  const initialized = useState<boolean>('workbench-initialized', () => false)

  function persist(): void {
    if (!import.meta.client) return
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(pipeline.value))
      persistenceError.value = ''
    } catch (error) {
      persistenceError.value = error instanceof Error
        ? `Pipeline tidak dapat disimpan di sesi ini: ${error.message}`
        : 'Pipeline tidak dapat disimpan di sesi ini.'
    }
  }

  function initialize(): void {
    if (!import.meta.client) return
    if (initialized.value) {
      const database = selectedSource.database.value ?? ''
      const table = selectedSource.table.value ?? ''
      if (database && (database !== pipeline.value.source.database || table !== pipeline.value.source.table)) {
        pipeline.value.source = { database, table }
        pipeline.value.steps = []
        selectedStep.value = 0
        page.value = 1
        persist()
      }
      return
    }
    initialized.value = true
    let restored = false
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<StoredPipeline>
        if (parsed.source && typeof parsed.source.database === 'string'
          && typeof parsed.source.table === 'string' && Array.isArray(parsed.steps)) {
          pipeline.value = {
            source: {
              database: parsed.source.database,
              table: parsed.source.table,
            },
            steps: parsed.steps.filter((step): step is WorkbenchStep =>
              Boolean(step && typeof step.id === 'string' && typeof step.op === 'string'
                && step.params && typeof step.params === 'object' && !Array.isArray(step.params)),
            ),
          }
          restored = true
        }
      }
      if (restored) {
        if (pipeline.value.source.database) {
          selectedSource.setDatabase(pipeline.value.source.database)
          selectedSource.setTable(pipeline.value.source.table || null)
        } else {
          selectedSource.setDatabase(null)
        }
      } else if (selectedSource.database.value) {
        pipeline.value.source.database = selectedSource.database.value
        pipeline.value.source.table = selectedSource.table.value ?? ''
      } else if (pipeline.value.source.database) {
        selectedSource.setDatabase(pipeline.value.source.database)
        selectedSource.setTable(pipeline.value.source.table || null)
      }
      persist()
    } catch (error) {
      persistenceError.value = error instanceof Error
        ? `Pipeline sesi tidak dapat dipulihkan: ${error.message}`
        : 'Pipeline sesi tidak dapat dipulihkan.'
    }
  }

  function setSource(database: string, table: string): void {
    const changed = pipeline.value.source.database !== database || pipeline.value.source.table !== table
    pipeline.value.source = { database, table }
    selectedSource.setDatabase(database || null)
    selectedSource.setTable(table || null)
    if (changed) {
      pipeline.value.steps = []
      selectedStep.value = 0
      page.value = 1
    }
    persist()
  }

  function savePipeline(): void {
    persist()
  }

  return {
    pipeline,
    selectedStep,
    page,
    limit,
    persistenceError,
    initialize,
    setSource,
    savePipeline,
  }
}
