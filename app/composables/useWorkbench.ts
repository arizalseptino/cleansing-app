export type WorkbenchSource = {
  database: string
  table: string
}

export type WorkbenchStep = {
  id: string
  op: string
  params: Record<string, unknown>
}

export type WorkbenchSaveOptions = {
  engine: 'MergeTree' | 'ReplacingMergeTree'
  orderBy: string[]
  saveOriginal: boolean
}

type StoredPipeline = {
  source: WorkbenchSource
  steps: WorkbenchStep[]
  saveOptions: WorkbenchSaveOptions
}

export type WorkbenchPreviewDisplayFilter = {
  column: string
  kind: 'null' | 'empty' | 'text' | 'contains'
  value?: string | null
}

export type WorkbenchPreviewParams = {
  source: WorkbenchSource
  steps: WorkbenchStep[]
  page: number
  limit: number
  displayFilter?: WorkbenchPreviewDisplayFilter
}

export type WorkbenchPreviewResponse = {
  aborted?: boolean
  columns: string[]
  rows: Record<string, unknown>[]
  totalRows: number
  page: number
  limit: number
  isSampled?: boolean
  sampleLimit?: number
  warnings?: string[]
  changesRowCount?: boolean
}

const storageKey = 'bersihdata-workbench-v1'
let previewAbortController: AbortController | null = null

function isPreviewAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  if (!error || typeof error !== 'object') return false
  const err = error as {
    name?: unknown
    code?: unknown
    statusCode?: unknown
    status?: unknown
    message?: unknown
    cause?: unknown
  }
  if (err.name === 'AbortError' || err.code === 'ABORT_ERR') return true
  if (err.statusCode === 499 || err.status === 499) return true
  if (typeof err.message === 'string' && /\b(AbortError|aborted|Client Closed Request)\b/i.test(err.message)) return true
  if (err.cause && err.cause !== error) return isPreviewAbortError(err.cause)
  return false
}

function defaultSaveOptions(): WorkbenchSaveOptions {
  return {
    engine: 'MergeTree',
    orderBy: [],
    saveOriginal: false,
  }
}

export function useWorkbench() {
  const selectedSource = useSelectedSource()
  const pipeline = useState<StoredPipeline>('workbench-pipeline', () => ({
    source: { database: '', table: '' },
    steps: [],
    saveOptions: defaultSaveOptions(),
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
        pipeline.value.saveOptions = defaultSaveOptions()
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
          const rawSave = parsed.saveOptions
          const saveOptions: WorkbenchSaveOptions = rawSave && typeof rawSave === 'object'
            ? {
                engine: rawSave.engine === 'ReplacingMergeTree' ? 'ReplacingMergeTree' : 'MergeTree',
                orderBy: Array.isArray(rawSave.orderBy) ? rawSave.orderBy.filter((c): c is string => typeof c === 'string').slice(0, 1) : [],
                saveOriginal: Boolean(rawSave.saveOriginal),
              }
            : defaultSaveOptions()
          pipeline.value = {
            source: {
              database: parsed.source.database,
              table: parsed.source.table,
            },
            steps: parsed.steps.filter((step): step is WorkbenchStep =>
              Boolean(step && typeof step.id === 'string' && typeof step.op === 'string'
                && step.params && typeof step.params === 'object' && !Array.isArray(step.params)),
            ),
            saveOptions,
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
      pipeline.value.saveOptions = defaultSaveOptions()
      selectedStep.value = 0
      page.value = 1
    }
    persist()
  }

  function setSaveOptions(options: Partial<WorkbenchSaveOptions>): void {
    pipeline.value.saveOptions = {
      engine: options.engine === 'ReplacingMergeTree' ? 'ReplacingMergeTree' : (options.engine ?? pipeline.value.saveOptions.engine),
      orderBy: Array.isArray(options.orderBy) ? options.orderBy.slice(0, 1) : pipeline.value.saveOptions.orderBy,
      saveOriginal: typeof options.saveOriginal === 'boolean' ? options.saveOriginal : pipeline.value.saveOptions.saveOriginal,
    }
    persist()
  }

  function savePipeline(): void {
    persist()
  }

  function abortPreview(): void {
    if (previewAbortController) {
      previewAbortController.abort()
      previewAbortController = null
    }
  }

  async function fetchPreview(
    params: WorkbenchPreviewParams,
  ): Promise<{ aborted: boolean; data?: WorkbenchPreviewResponse }> {
    abortPreview()
    const controller = new AbortController()
    previewAbortController = controller

    try {
      const data = await $fetch<WorkbenchPreviewResponse>('/api/workbench/preview', {
        method: 'POST',
        body: {
          source: params.source,
          steps: params.steps,
          page: params.page,
          limit: params.limit,
          ...(params.displayFilter ? { displayFilter: params.displayFilter } : {}),
        },
        signal: controller.signal,
      })
      if (controller.signal.aborted || data.aborted) {
        return { aborted: true }
      }
      return { aborted: false, data }
    } catch (error) {
      if (isPreviewAbortError(error, controller.signal)) {
        return { aborted: true }
      }
      throw error
    } finally {
      if (previewAbortController === controller) {
        previewAbortController = null
      }
    }
  }

  return {
    pipeline,
    selectedStep,
    page,
    limit,
    persistenceError,
    initialize,
    setSource,
    setSaveOptions,
    savePipeline,
    abortPreview,
    fetchPreview,
  }
}
