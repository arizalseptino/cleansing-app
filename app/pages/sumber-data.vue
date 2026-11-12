<template>
  <div>
    <p class="page-kicker">Ruang kerja</p>
    <h1 class="page-title">Sumber data</h1>
    <p class="page-description">Pilih database dan tabel ClickHouse yang ingin Anda bersihkan.</p>

    <!-- Memisahkan kontrol pilihan dari metadata tabel yang dipilih. -->
    <section class="dashboard-grid" aria-label="Pemilihan database dan ringkasan tabel">
      <article class="kartu source-card">
        <h2 class="card-title">Pilih sumber</h2>

        <label class="source-field" for="database-select">Database</label>
        <select
          id="database-select"
          :value="selectedDatabase ?? ''"
          :disabled="databasesPending || databases.length === 0 || Boolean(databasesError)"
          @change="handleDatabaseChange"
        >
          <option value="" disabled>Pilih database</option>
          <option v-for="database in databases" :key="database.name" :value="database.name">
            {{ database.name }}
          </option>
        </select>

        <p v-if="databasesPending" class="source-message" role="status">Memuat daftar database...</p>
        <p v-else-if="databasesError" class="source-message source-error" role="alert">
          Gagal memuat database: {{ databasesError }}
        </p>
        <template v-else-if="databases.length === 0">
          <p class="source-message" role="status">Tidak ada database yang dapat dipilih.</p>
        </template>
        <button
          v-if="databasesError"
          class="source-retry"
          type="button"
          @click="loadDatabases"
        >
          Coba lagi
        </button>

        <label class="source-field" for="table-select">Tabel</label>
        <select
          id="table-select"
          :value="selectedTable ?? ''"
          :disabled="!selectedDatabase || tablesPending || tables.length === 0 || Boolean(tablesError)"
          @change="handleTableChange"
        >
          <option value="" disabled>
            {{ selectedDatabase ? 'Pilih tabel' : 'Pilih database terlebih dahulu' }}
          </option>
          <option v-for="table in tables" :key="table.name" :value="table.name">
            {{ table.name }}
          </option>
        </select>

        <p v-if="tablesPending" class="source-message" role="status">Memuat daftar tabel...</p>
        <p v-else-if="tablesError" class="source-message source-error" role="alert">
          Gagal memuat tabel: {{ tablesError }}
        </p>
        <p v-else-if="selectedDatabase && tables.length === 0" class="source-message" role="status">
          Database ini belum memiliki tabel.
        </p>
        <button
          v-if="tablesError && selectedDatabase"
          class="source-retry"
          type="button"
          @click="loadTables(selectedDatabase, true)"
        >
          Coba lagi
        </button>
      </article>

      <article class="kartu source-card" aria-live="polite">
        <h2 class="card-title">Ringkasan tabel</h2>
        <template v-if="selectedTable">
          <dl class="table-summary">
            <div>
              <dt>Tabel</dt>
              <dd><code>{{ selectedTable }}</code></dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>{{ selectedEngine }}</dd>
            </div>
          </dl>

          <h3 class="columns-title">Kolom</h3>
          <p v-if="columnsPending" class="source-message" role="status">Memuat daftar kolom...</p>
          <p v-else-if="columnsError" class="source-message source-error" role="alert">
            Gagal memuat kolom: {{ columnsError }}
          </p>
          <p v-else-if="columns.length === 0" class="source-message" role="status">
            Tabel ini belum memiliki kolom.
          </p>
          <ul v-else class="column-list">
            <li v-for="column in columns" :key="column.name">
              <code>{{ column.name }}</code>
              <span>{{ column.type }}</span>
            </li>
          </ul>
          <button
            v-if="columnsError && selectedDatabase"
            class="source-retry"
            type="button"
            @click="loadColumns(selectedDatabase, selectedTable)"
          >
            Coba lagi
          </button>
        </template>
        <p v-else class="source-message">Pilih tabel untuk melihat engine dan daftar kolomnya.</p>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
type CatalogResponse<T> = { data: T[] }
type Database = { name: string }
type Table = { name: string; engine: string }
type Column = { name: string; type: string }

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object'
      && 'message' in error.data && typeof error.data.message === 'string') {
      return error.data.message
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message
    }
  }

  return fallback
}

const source = useSelectedSource()
const selectedDatabase = source.database
const selectedTable = source.table

const databases = ref<Database[]>([])
const databasesPending = ref(true)
const databasesError = ref('')
const tables = ref<Table[]>([])
const tablesPending = ref(false)
const tablesError = ref('')
const columns = ref<Column[]>([])
const columnsPending = ref(false)
const columnsError = ref('')
const selectedEngine = ref('')

async function loadDatabases() {
  databasesPending.value = true
  databasesError.value = ''

  try {
    const response = await $fetch<CatalogResponse<Database>>('/api/databases')
    databases.value = response.data

    if (selectedDatabase.value && !databases.value.some(({ name }) => name === selectedDatabase.value)) {
      source.setDatabase(null)
    }

    if (selectedDatabase.value) {
      await loadTables(selectedDatabase.value, true)
    }
  } catch (error) {
    databasesError.value = getErrorMessage(error, 'Terjadi kesalahan saat mengambil daftar database.')
  } finally {
    databasesPending.value = false
  }
}

async function loadTables(database: string, restoreSelection = false) {
  tablesPending.value = true
  tablesError.value = ''
  tables.value = []
  columns.value = []
  columnsError.value = ''
  selectedEngine.value = ''

  try {
    const response = await $fetch<CatalogResponse<Table>>('/api/tables', {
      query: { database },
    })

    if (selectedDatabase.value !== database) return
    tables.value = response.data

    if (restoreSelection && selectedTable.value) {
      const selected = tables.value.find(({ name }) => name === selectedTable.value)
      if (selected) {
        selectedEngine.value = selected.engine
        await loadColumns(database, selected.name)
      } else {
        source.setTable(null)
      }
    } else {
      source.setTable(null)
    }
  } catch (error) {
    if (selectedDatabase.value === database) {
      tablesError.value = getErrorMessage(error, 'Terjadi kesalahan saat mengambil daftar tabel.')
    }
  } finally {
    if (selectedDatabase.value === database) {
      tablesPending.value = false
    }
  }
}

async function loadColumns(database: string, table: string) {
  columnsPending.value = true
  columnsError.value = ''
  columns.value = []

  try {
    const response = await $fetch<CatalogResponse<Column>>('/api/columns', {
      query: { database, table },
    })

    if (selectedDatabase.value === database && selectedTable.value === table) {
      columns.value = response.data
    }
  } catch (error) {
    if (selectedDatabase.value === database && selectedTable.value === table) {
      columnsError.value = getErrorMessage(error, 'Terjadi kesalahan saat mengambil daftar kolom.')
    }
  } finally {
    if (selectedDatabase.value === database && selectedTable.value === table) {
      columnsPending.value = false
    }
  }
}

async function handleDatabaseChange(event: Event) {
  const database = (event.target as HTMLSelectElement).value
  source.setDatabase(database || null)
  tables.value = []
  tablesError.value = ''
  columns.value = []
  columnsError.value = ''
  selectedEngine.value = ''

  if (database) {
    await loadTables(database)
  }
}

async function handleTableChange(event: Event) {
  const table = (event.target as HTMLSelectElement).value
  source.setTable(table || null)
  columns.value = []
  columnsError.value = ''
  selectedEngine.value = tables.value.find((item) => item.name === table)?.engine ?? ''

  if (selectedDatabase.value && table) {
    await loadColumns(selectedDatabase.value, table)
  }
}

onMounted(loadDatabases)
</script>

<style scoped>
.source-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.source-card .card-title {
  margin: 0 0 8px;
}

.source-field {
  color: var(--warna-teks);
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
}

.source-card select {
  width: 100%;
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}

.source-card select:hover:not(:disabled) {
  border-color: var(--warna-utama);
}

.source-card select:active:not(:disabled) {
  background: var(--warna-biru-muda);
}

.source-card select:focus-visible,
.source-retry:focus-visible {
  outline: 2px solid var(--warna-utama);
  outline-offset: 2px;
}

.source-card select:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.source-message {
  margin: 2px 0 8px;
  color: var(--warna-redup);
  font-size: 14px;
  overflow-wrap: anywhere;
}

.source-error {
  color: #a64b42;
}

.source-retry {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: var(--warna-biru-muda);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.source-retry:hover {
  background: var(--warna-pistachio);
}

.source-retry:active {
  filter: brightness(0.94);
}

.table-summary {
  display: grid;
  width: 100%;
  gap: 10px;
  margin: 4px 0 12px;
}

.table-summary div {
  display: grid;
  grid-template-columns: minmax(72px, 0.35fr) minmax(0, 1fr);
  gap: 12px;
}

.table-summary dt {
  color: var(--warna-redup);
  font-size: 14px;
}

.table-summary dd {
  min-width: 0;
  margin: 0;
  color: var(--warna-teks);
  font-size: 15px;
  overflow-wrap: anywhere;
}

.columns-title {
  align-self: flex-start;
  margin: 8px 0 4px;
  color: var(--warna-teks);
  font-size: 16px;
}

.column-list {
  display: grid;
  width: 100%;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.column-list li {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
  border-top: 1px solid var(--warna-garis);
  font-size: 14px;
}

.column-list code,
.column-list span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.column-list span {
  color: var(--warna-redup);
  text-align: right;
}

@media (prefers-reduced-motion: reduce) {
  .source-card *,
  .source-card *::before,
  .source-card *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
