type ClickHouseHealthResponse =
  | { ok: true; version: string }
  | { ok: false; message: string }

type ClickHouseStatus = 'memeriksa' | 'terhubung' | 'gagal'

export function useClickHouseStatus() {
  const { data, error, pending, refresh } = useFetch<ClickHouseHealthResponse>('/api/health', {
    key: 'health',
  })

  const status = computed<ClickHouseStatus>(() => {
    if (pending.value) return 'memeriksa'
    if (error.value) return 'gagal'
    return data.value?.ok && data.value.version ? 'terhubung' : 'gagal'
  })

  const version = computed(() => data.value?.ok ? data.value.version : undefined)
  const message = computed(() => {
    if (error.value) return error.value.message
    if (data.value && !data.value.ok) return data.value.message
    if (status.value === 'gagal') return 'Tidak dapat memeriksa koneksi ClickHouse.'
    return undefined
  })

  return { status, version, message, refresh }
}
