<template>
  <div>
    <p class="page-kicker">Ruang kerja</p>
    <h1 class="page-title">Riwayat cleansing</h1>
    <p class="page-description">Lihat ringkasan penerapan cleansing yang pernah dijalankan.</p>

    <section class="kartu history-card" aria-label="Riwayat penerapan cleansing">
      <div class="history-heading">
        <h2 class="card-title">Penerapan terbaru</h2>
        <button class="history-refresh" type="button" :disabled="pending" @click="loadHistory(page)">
          Muat ulang
        </button>
      </div>
      <p v-if="featureNamesError" class="history-message" role="status">
        {{ featureNamesError }}
      </p>

      <p v-if="pending" class="history-message" role="status">Memuat riwayat cleansing...</p>
      <div v-else-if="errorMessage" class="history-error" role="alert">
        <p>{{ errorMessage }}</p>
        <button class="history-refresh" type="button" @click="loadHistory(page)">Coba lagi</button>
      </div>
      <template v-else-if="entries.length">
        <div class="history-table-viewport">
          <table class="history-table">
            <thead>
              <tr>
                <th scope="col">Waktu</th>
                <th scope="col">Fitur</th>
                <th scope="col">Sumber ke hasil</th>
                <th scope="col">Baris terisi</th>
                <th scope="col">Status</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="entry in entries" :key="entry.id">
                <tr>
                  <td>{{ formatDate(entry.waktu_mulai) }}</td>
                  <td>{{ featureName(entry.fitur_id) }}</td>
                  <td>
                    <span class="history-table-name">{{ entry.database_sumber }}.{{ entry.tabel_sumber }}</span>
                    <span class="history-arrow" aria-hidden="true">→</span>
                    <span class="history-table-name">{{ entry.database_sumber }}.{{ entry.tabel_hasil || '—' }}</span>
                  </td>
                  <td>{{ formatNumber(entry.baris_terisi) }}</td>
                  <td>
                    <span
                      class="history-status"
                      :class="entry.status === 'sukses' ? 'history-status--success' : 'history-status--failure'"
                    >
                      {{ entry.status === 'sukses' ? 'Sukses' : 'Gagal' }}
                    </span>
                  </td>
                  <td class="history-actions">
                    <button
                      class="history-text-button"
                      type="button"
                      :aria-expanded="expandedEntryId === entry.id"
                      @click="toggleDetails(entry.id)"
                    >
                      {{ expandedEntryId === entry.id ? 'Tutup detail' : 'Parameter' }}
                    </button>
                    <button
                      v-if="entry.status === 'sukses'"
                      class="history-text-button"
                      type="button"
                      @click="viewResult(entry)"
                    >
                      Lihat tabel hasil
                    </button>
                  </td>
                </tr>
                <tr v-if="expandedEntryId === entry.id" class="history-details-row">
                  <td colspan="6">
                    <h3>Parameter penerapan</h3>
                    <pre>{{ formatParameters(entry.parameter) }}</pre>
                    <p v-if="entry.pesan" class="history-detail-message">
                      Pesan: {{ entry.pesan }}
                    </p>
                    <p class="history-detail-meta">
                      {{ formatNumber(entry.baris_sumber) }} baris sumber ·
                      {{ formatNumber(entry.baris_ambigu) }} baris ambigu dibiarkan kosong ·
                      {{ formatNumber(entry.durasi_ms) }} ms
                    </p>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <nav class="history-pagination" aria-label="Halaman riwayat cleansing">
          <span>
            {{ formatNumber(total) }} penerapan · Halaman {{ page }} dari {{ totalPages }}
          </span>
          <div>
            <button type="button" :disabled="page <= 1 || pending" @click="loadHistory(page - 1)">
              Sebelumnya
            </button>
            <button type="button" :disabled="page >= totalPages || pending" @click="loadHistory(page + 1)">
              Berikutnya
            </button>
          </div>
        </nav>
      </template>
      <p v-else class="history-message" role="status">Belum ada riwayat penerapan cleansing.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
type HistoryEntry = {
  id: string
  waktu_mulai: string
  durasi_ms: number
  fitur_id: string
  database_sumber: string
  tabel_sumber: string
  tabel_hasil: string
  parameter: string
  baris_sumber: number
  baris_terisi: number
  baris_ambigu: number
  status: string
  pesan: string | null
}
type HistoryResponse = {
  data: HistoryEntry[]
  total: number
  page: number
  limit: number
}
type Feature = { id: string; name: string }

const source = useSelectedSource()
const entries = ref<HistoryEntry[]>([])
const featureNames = ref<Record<string, string>>({})
const page = ref(1)
const limit = 25
const total = ref(0)
const pending = ref(true)
const errorMessage = ref('')
const featureNamesError = ref('')
const expandedEntryId = ref<string | null>(null)
let requestId = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)))

function getErrorMessage(error: unknown, fallback = 'Riwayat cleansing tidak dapat dimuat.'): string {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object'
      && 'message' in error.data && typeof error.data.message === 'string') {
      return error.data.message
    }
    if ('message' in error && typeof error.message === 'string') return error.message
  }
  return fallback
}

async function loadHistory(requestedPage: number) {
  const currentRequestId = ++requestId
  pending.value = true
  errorMessage.value = ''
  try {
    const response = await $fetch<HistoryResponse>('/api/cleansing/history', {
      query: { page: requestedPage, limit },
    })
    if (currentRequestId !== requestId) return
    entries.value = response.data
    total.value = response.total
    page.value = response.page
    expandedEntryId.value = null
  } catch (error) {
    if (currentRequestId === requestId) errorMessage.value = getErrorMessage(error)
  } finally {
    if (currentRequestId === requestId) pending.value = false
  }
}

async function loadFeatureNames() {
  try {
    const response = await $fetch<{ data: Feature[] }>('/api/cleansing/features')
    featureNames.value = Object.fromEntries(response.data.map(({ id, name }) => [id, name]))
  } catch (error) {
    featureNames.value = {}
    featureNamesError.value = getErrorMessage(
      error,
      'Nama fitur tidak dapat dimuat; ID fitur akan ditampilkan.',
    )
  }
}

function featureName(id: string): string {
  return featureNames.value[id] ?? id
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  }).format(date)
}

function formatParameters(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value || '{}'
  }
}

function toggleDetails(id: string) {
  expandedEntryId.value = expandedEntryId.value === id ? null : id
}

async function viewResult(entry: HistoryEntry) {
  source.setDatabase(entry.database_sumber)
  source.setTable(entry.tabel_hasil)
  await navigateTo('/sumber-data')
}

onMounted(() => {
  void loadHistory(1)
  void loadFeatureNames()
})
</script>

<style scoped>
.history-card {
  max-width: 1080px;
  margin-top: 20px;
}

.history-heading,
.history-pagination,
.history-pagination > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.history-heading {
  margin-bottom: 14px;
}

.history-heading .card-title {
  margin: 0;
}

.history-refresh,
.history-pagination button,
.history-text-button {
  min-height: 36px;
  padding: 7px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: #375875;
  background: #fff;
  font: inherit;
  cursor: pointer;
}

.history-refresh:disabled,
.history-pagination button:disabled {
  color: #8b9aac;
  background: #f5f8fa;
  cursor: not-allowed;
}

.history-message,
.history-error {
  color: var(--warna-redup);
  font-size: 14px;
}

.history-error {
  color: #9c3e36;
}

.history-error p {
  margin-top: 0;
}

.history-table-viewport {
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
}

.history-table {
  width: 100%;
  min-width: 850px;
  border-collapse: collapse;
  font-size: 13px;
}

.history-table th,
.history-table td {
  padding: 11px 12px;
  border-bottom: 1px solid #e8eff5;
  text-align: left;
  vertical-align: top;
}

.history-table th {
  color: #526479;
  background: #f5f8fa;
  font-weight: 650;
  white-space: nowrap;
}

.history-table tbody tr:last-child > td {
  border-bottom: 0;
}

.history-table-name {
  display: block;
  max-width: 240px;
  overflow-wrap: anywhere;
}

.history-arrow {
  display: block;
  padding: 3px 0;
  color: var(--warna-redup);
}

.history-status {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 999px;
  font-weight: 650;
  white-space: nowrap;
}

.history-status--success {
  color: #315d27;
  background: #e7f2e3;
}

.history-status--failure {
  color: #8a352e;
  background: #f8e9e7;
}

.history-actions {
  min-width: 140px;
}

.history-text-button {
  display: block;
  min-height: 32px;
  margin-bottom: 6px;
  padding: 5px 8px;
  font-size: 12px;
}

.history-text-button:last-child {
  margin-bottom: 0;
}

.history-details-row > td {
  background: #f8fafc;
}

.history-details-row h3 {
  margin: 0 0 8px;
  color: #30455b;
  font-size: 13px;
}

.history-details-row pre {
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.history-detail-message {
  color: #8a352e;
}

.history-detail-meta {
  margin-bottom: 0;
  color: var(--warna-redup);
  font-size: 12px;
}

.history-pagination {
  flex-wrap: wrap;
  margin-top: 14px;
  color: var(--warna-redup);
  font-size: 13px;
}

@media (max-width: 620px) {
  .history-heading,
  .history-pagination {
    align-items: flex-start;
  }

  .history-pagination {
    flex-direction: column;
  }
}
</style>
