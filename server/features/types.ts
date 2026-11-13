import type { useClickHouse } from '../utils/clickhouse'

export type FeatureParameter = {
  key: string
  label: string
  description: string
  kind: 'source-database' | 'source-table' | 'source-column' | 'master-database' | 'master-table' | 'master-column'
  optional?: boolean
}

export type FeaturePreview = {
  statistics: {
    sourceRows: number
    targetEmptyRows: number
    fillableRows: number
    ambiguousRows: number
    remainingEmptyRows: number
  }
  keyColumns: { name: string; valueKey: string }[]
  sourceColumn: string
  targetColumn: string
  examples: {
    fillable: Record<string, unknown>[]
    ambiguous: Record<string, unknown>[]
    remainingEmpty: Record<string, unknown>[]
  }
  orderedBySortingKey: boolean
}

export type CleansingFeature = {
  id: string
  name: string
  description: string
  parameters: FeatureParameter[]
  preview: (client: ReturnType<typeof useClickHouse>, parameters: Record<string, unknown>) => Promise<FeaturePreview>
}
