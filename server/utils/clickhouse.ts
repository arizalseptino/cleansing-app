import { createClient } from '@clickhouse/client'
import type { Readable } from 'node:stream'
import { useMockClickHouse } from './mock-clickhouse'

export type ClickHouseLikeClient = {
  query: (params: {
    query: string
    query_params?: Record<string, unknown>
    format?: string
    clickhouse_settings?: Record<string, unknown>
    abort_signal?: AbortSignal
    query_id?: string
  }) => Promise<{ json: <T = unknown>() => Promise<T> }>
  command: (params: {
    query: string
    query_params?: Record<string, unknown>
    clickhouse_settings?: Record<string, unknown>
    abort_signal?: AbortSignal
    query_id?: string
  }) => Promise<unknown>
  exec: (params: {
    query: string
    query_params?: Record<string, unknown>
    clickhouse_settings?: Record<string, unknown>
    abort_signal?: AbortSignal
    query_id?: string
  }) => Promise<{ stream: Readable; query_id: string }>
  insert: (params: {
    table: string
    values: Readable | Buffer | string
    format?: string
    columns?: string[]
    clickhouse_settings?: Record<string, unknown>
  }) => Promise<unknown>
}

export const CLICKHOUSE_MEMORY_SETTINGS = {
  max_bytes_before_external_group_by: '2000000000',
  max_bytes_before_external_sort: '2000000000',
  join_algorithm: 'auto',
  max_bytes_in_join: '2000000000',
  max_memory_usage: '8000000000',
} as const

export function buildClickHouseQuerySettings(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const { readonly, ...rest } = overrides
  return {
    ...CLICKHOUSE_MEMORY_SETTINGS,
    ...rest,
    ...(readonly !== undefined ? { readonly } : {}),
  }
}

let client: ClickHouseLikeClient | null = null

export function useClickHouse(): ClickHouseLikeClient {
  if (!client) {
    const config = useRuntimeConfig()
    if (config.clickhouseUrl && config.clickhouseUrl.trim()) {
      client = createClient({
        url: config.clickhouseUrl,
        username: config.clickhouseUser,
        password: config.clickhousePassword,
        request_timeout: 600_000,
        keep_alive: {
          enabled: false,
        },
        clickhouse_settings: {
          ...CLICKHOUSE_MEMORY_SETTINGS,
        },
      }) as unknown as ClickHouseLikeClient
    } else {
      console.warn('[AI Studio] NUXT_CLICKHOUSE_URL is not configured — using in-memory ClickHouse simulation')
      client = useMockClickHouse()
    }
  }
  return client
}