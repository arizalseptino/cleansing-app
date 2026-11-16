<template>
  <div class="bento">
    <header class="bento-heading">
      <p class="page-kicker">Ruang kerja</p>
      <h1 class="page-title">Ringkasan BersihData</h1>
      <p class="page-description">Pantau sumber data dan lanjutkan pekerjaan cleansing Anda.</p>
    </header>

    <article class="kartu welcome-card span-7 row-2">
      <p class="eyebrow">Selamat datang</p>
      <h2>Cleansing data, lebih sederhana</h2>
      <p>Pilih tabel, tinjau data, lalu terapkan aturan cleansing dengan alur yang jelas.</p>
      <NuxtLink class="welcome-link" to="/sumber-data">Mulai dari sumber data <span aria-hidden="true">→</span></NuxtLink>
    </article>

    <article class="kartu connection-card span-5">
      <div>
        <div class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <ellipse cx="12" cy="5.5" rx="7.5" ry="3" stroke="currentColor" stroke-width="1.7" />
            <path d="M4.5 5.5v13c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-13M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" stroke="currentColor" stroke-width="1.7" />
          </svg>
        </div>
        <h2>ClickHouse</h2>
        <p v-if="status === 'terhubung'">Terhubung secara lokal (versi {{ version }}).</p>
        <p v-else-if="status === 'memeriksa'">Memeriksa koneksi...</p>
        <template v-else>
          <p>ClickHouse lokal belum terhubung.</p>
          <p v-if="message" class="connection-error">{{ message }}</p>
        </template>
        <button
          class="connection-retry"
          type="button"
          :disabled="status === 'memeriksa'"
          @click="refresh()"
        >
          Periksa ulang
        </button>
      </div>
    </article>

    <article class="kartu summary-card span-5" aria-live="polite">
      <h2 class="card-title">Katalog data</h2>
      <p v-if="catalogPending" class="summary-message" role="status">Memuat jumlah database dan tabel...</p>
      <p v-else-if="catalogError" class="summary-message summary-error" role="alert">
        Ringkasan katalog tidak dapat dimuat: {{ catalogError }}
      </p>
      <div v-else-if="catalogSummary" class="summary-metrics">
        <div>
          <strong>{{ formatNumber(catalogSummary.databases) }}</strong>
          <span>Database</span>
        </div>
        <div>
          <strong>{{ formatNumber(catalogSummary.tables) }}</strong>
          <span>Tabel</span>
        </div>
      </div>
    </article>

    <article class="kartu recent-card span-12" aria-live="polite">
      <div class="recent-heading">
        <div>
          <p class="eyebrow">Aktivitas</p>
          <h2 class="card-title">Riwayat terbaru</h2>
        </div>
        <NuxtLink to="/riwayat">Lihat semua</NuxtLink>
      </div>
      <p v-if="historyPending" class="summary-message" role="status">Memuat riwayat penerapan...</p>
      <p v-else-if="historyError" class="summary-message summary-error" role="alert">
        Riwayat tidak dapat dimuat: {{ historyError }}
      </p>
      <p v-else-if="recentEntries.length === 0" class="summary-message" role="status">
        Belum ada riwayat penerapan cleansing.
      </p>
      <ul v-else class="recent-list">
        <li v-for="entry in recentEntries" :key="entry.id">
          <div class="recent-entry">
            <strong>{{ entry.database_sumber }}.{{ entry.tabel_sumber }}</strong>
            <span>{{ entry.fitur_id }} · {{ formatDate(entry.waktu_mulai) }}</span>
          </div>
          <span
            class="history-status"
            :class="entry.status === 'sukses' ? 'history-status--success' : 'history-status--failure'"
          >
            {{ entry.status === 'sukses' ? 'Sukses' : 'Gagal' }}
          </span>
        </li>
      </ul>
    </article>

    <NuxtLink class="kartu shortcut-card span-4" to="/sumber-data">
      <span class="shortcut-label">Sumber data</span>
      <span>Pilih database dan tinjau isi tabel <span aria-hidden="true">→</span></span>
    </NuxtLink>
    <NuxtLink class="kartu shortcut-card span-4" to="/cleansing">
      <span class="shortcut-label">Cleansing</span>
      <span>Atur dan pratinjau cleansing <span aria-hidden="true">→</span></span>
    </NuxtLink>
    <NuxtLink class="kartu shortcut-card span-4" to="/riwayat">
      <span class="shortcut-label">Riwayat</span>
      <span>Lihat penerapan sebelumnya <span aria-hidden="true">→</span></span>
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
type CatalogResponse<T> = { data: T[] }
type HistoryEntry = {
  id: string
  waktu_mulai: string
  fitur_id: string
  database_sumber: string
  tabel_sumber: string
  status: string
}
type HistoryResponse = { data: HistoryEntry[] }

const { status, version, message, refresh } = useClickHouseStatus()
const catalogPending = ref(true)
const catalogError = ref('')
const catalogSummary = ref<{ databases: number; tables: number } | null>(null)
const historyPending = ref(true)
const historyError = ref('')
const recentEntries = ref<HistoryEntry[]>([])

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'data' in error
    && error.data && typeof error.data === 'object'
    && 'message' in error.data && typeof error.data.message === 'string') {
    return error.data.message
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return fallback
}

async function loadCatalogSummary() {
  catalogPending.value = true
  catalogError.value = ''
  try {
    const response = await $fetch<CatalogResponse<{ name: string }>>('/api/databases')
    const tableResponses = await Promise.all(response.data.map(({ name }) =>
      $fetch<CatalogResponse<{ name: string }>>('/api/tables', { query: { database: name } }),
    ))
    catalogSummary.value = {
      databases: response.data.length,
      tables: tableResponses.reduce((count, result) => count + result.data.length, 0),
    }
  } catch (error) {
    catalogSummary.value = null
    catalogError.value = getErrorMessage(error, 'Terjadi kesalahan saat mengambil katalog data.')
  } finally {
    catalogPending.value = false
  }
}

async function loadRecentHistory() {
  historyPending.value = true
  historyError.value = ''
  try {
    const response = await $fetch<HistoryResponse>('/api/cleansing/history', {
      query: { page: 1, limit: 3 },
    })
    recentEntries.value = response.data
  } catch (error) {
    recentEntries.value = []
    historyError.value = getErrorMessage(error, 'Terjadi kesalahan saat mengambil riwayat.')
  } finally {
    historyPending.value = false
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  }).format(date)
}

onMounted(() => {
  void loadCatalogSummary()
  void loadRecentHistory()
})
</script>

<style scoped>
.welcome-card {
  display: flex;
  min-height: 340px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: clamp(24px, 4vw, 42px);
  border-top: 3px solid var(--warna-pistachio);
  background: linear-gradient(145deg, #fff 35%, var(--warna-latar) 100%);
}

.connection-error {
  margin-top: 4px !important;
  overflow-wrap: anywhere;
}

.connection-retry {
  min-height: 44px;
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: var(--warna-biru-muda);
  font-size: 14px;
  cursor: pointer;
}

.connection-retry:hover {
  background: var(--warna-pistachio);
}

.connection-retry:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.connection-retry:focus-visible {
  outline: 2px solid var(--warna-utama);
  outline-offset: 2px;
}

.welcome-card h2 {
  max-width: 560px;
  margin: 18px 0 10px;
  color: #263a4e;
  font-size: clamp(28px, 3.2vw, 42px);
  font-weight: 650;
  letter-spacing: -0.045em;
  line-height: 1.15;
}

.welcome-card > p:not(.eyebrow) {
  max-width: 480px;
  margin: 0;
  color: var(--warna-redup);
}

.welcome-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  color: #355f28;
  font-weight: 700;
  text-decoration: none;
}

.welcome-link:hover,
.recent-heading > a:hover {
  text-decoration: underline;
}

.summary-card .card-title,
.recent-heading .card-title {
  margin: 0;
}

.summary-metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.summary-metrics > div {
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 14px;
  border-radius: 12px;
  background: #f3f8fc;
}

.summary-metrics strong {
  color: #263a4e;
  font-size: clamp(24px, 2.8vw, 34px);
  line-height: 1.2;
}

.summary-metrics span,
.summary-message {
  color: var(--warna-redup);
  font-size: 13px;
}

.summary-message {
  margin: 12px 0 0;
  overflow-wrap: anywhere;
}

.summary-error {
  color: #a64b42;
}

.recent-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.recent-heading .eyebrow {
  margin-bottom: 4px;
}

.recent-heading > a {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 650;
  text-decoration: none;
}

.recent-list {
  display: grid;
  gap: 0;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.recent-list li {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 12px 0;
  border-top: 1px solid #e8eff5;
}

.recent-entry {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.recent-entry strong,
.recent-entry span {
  overflow-wrap: anywhere;
}

.recent-entry strong {
  color: #375875;
  font-size: 14px;
}

.recent-entry span {
  color: var(--warna-redup);
  font-size: 12px;
}

.history-status {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 12px;
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

.shortcut-card {
  display: grid;
  gap: 8px;
  color: #375875;
  text-decoration: none;
  transition: border-color 160ms ease, transform 160ms ease;
}

.shortcut-card:hover {
  transform: translateY(-2px);
  border-color: var(--warna-utama);
}

.shortcut-label {
  color: #263a4e;
  font-size: 16px;
  font-weight: 700;
}

.shortcut-card > span:last-child {
  color: var(--warna-redup);
  font-size: 13px;
}

@media (max-width: 720px) {
  .welcome-card {
    min-height: 250px;
  }
}
</style>
