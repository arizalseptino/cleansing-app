import { createClient } from '@clickhouse/client'

let client: ReturnType<typeof createClient> | null = null

export function useClickHouse() {
  if (!client) {
    const config = useRuntimeConfig()
    client = createClient({
      url: config.clickhouseUrl,
      username: config.clickhouseUser,
      password: config.clickhousePassword,
    })
  }
  return client
}