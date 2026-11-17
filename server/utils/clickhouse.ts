import { createClient } from '@clickhouse/client'
import { useMockClickHouse } from './mock-clickhouse'

export type ClickHouseLikeClient = {
  query: (params: {
    query: string
    query_params?: Record<string, unknown>
    format?: string
    clickhouse_settings?: Record<string, unknown>
  }) => Promise<{ json: <T = unknown>() => Promise<T> }>
  command: (params: {
    query: string
    query_params?: Record<string, unknown>
    clickhouse_settings?: Record<string, unknown>
  }) => Promise<unknown>
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
      }) as unknown as ClickHouseLikeClient
    } else {
      console.warn('[AI Studio] NUXT_CLICKHOUSE_URL is not configured — using in-memory ClickHouse simulation')
      client = useMockClickHouse()
    }
  }
  return client
}