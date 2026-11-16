export type SourceReference = {
  database: string
  table: string
}

export type PipelineStep = {
  id?: string
  op: string
  params?: Record<string, unknown>
}

export type Pipeline = {
  source: SourceReference
  steps: PipelineStep[]
}

export type ColumnMetadata = {
  name: string
  type: string
  default_kind?: string
}

export type OperationParamType =
  | 'column'
  | 'columns'
  | 'text'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'pairs'
  | 'table-ref'

export type OperationParamDefinition = {
  key: string
  label: string
  description: string
  type: OperationParamType
  required?: boolean
  options?: string[]
  allowEmpty?: boolean
}

export type OperationDefinition = {
  id: string
  name: string
  description: string
  params: OperationParamDefinition[]
  validate: (context: OperationContext) => void | Promise<void>
  compile: (context: OperationContext) => Promise<CompiledStep>
}

export type CompiledStep = {
  sql: string
  params: Record<string, unknown>
  touchedColumns: string[]
  addedColumns: string[]
  beforeColumns?: string[]
}

export type OperationContext = {
  client: ReturnType<typeof import('../utils/clickhouse').useClickHouse>
  source: SourceReference
  schema: ColumnMetadata[]
  params: Record<string, unknown>
  metadata: {
    engine: string
    sorting_key: string
  }
}

export type StepSchemaStatus = {
  index: number
  valid: boolean
  schema?: ColumnMetadata[]
  error?: string
}

export type CompiledPipeline = {
  source: SourceReference
  sql: string
  params: Record<string, unknown>
  schema: ColumnMetadata[]
  stepSchemas: StepSchemaStatus[]
}
