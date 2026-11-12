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

    <section v-if="selectedDatabase && selectedTable" class="kartu rows-card" aria-label="Isi tabel">
      <div class="rows-heading">
        <div>
          <p class="page-kicker">Pratinjau data</p>
          <h2 class="card-title">Isi tabel</h2>
        </div>
        <code>{{ selectedTable }}</code>
      </div>

      <p v-if="rowsPending" class="source-message" role="status">Memuat isi tabel...</p>
      <p v-else-if="rowsError" class="source-message source-error" role="alert">
        Gagal memuat isi tabel: {{ rowsError }}
      </p>
      <template v-else>
        <p v-if="!orderGuaranteed" class="source-message rows-order-note" role="status">
          Tabel ini tidak memiliki sorting key; urutan baris tidak dijamin.
        </p>

        <div class="rows-toolbar">
          <p class="rows-range">{{ rowsRange }}</p>
          <label class="rows-limit-field" for="rows-limit">
            Baris per halaman
            <select id="rows-limit" :value="pageSize" @change="handlePageSizeChange">
              <option :value="25">25</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </label>
        </div>

        <p v-if="rowCount === 0" class="source-message" role="status">
          Tabel ini belum memiliki data.
        </p>
        <div v-else class="rows-table-viewport">
          <table class="rows-table">
            <thead>
              <tr>
                <th v-for="column in rowColumns" :key="column.name" scope="col">
                  <span :title="`${column.name} (${column.type})`">{{ column.name }}</span>
                  <small>{{ column.type }}</small>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in tableRows" :key="rowIndex">
                <td v-for="column in rowColumns" :key="column.name">
                  <span
                    class="rows-cell-value"
                    :class="{
                      'rows-cell-value--null': row[column.name] === null,
                      'rows-cell-value--empty': row[column.name] === '',
                    }"
                    :title="displayCellValue(row[column.name])"
                  >
                    {{ displayCellValue(row[column.name]) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <nav v-if="rowCount > 0" class="rows-pagination" aria-label="Navigasi halaman tabel">
          <button
            type="button"
            :disabled="pageNumber <= 1 || rowsPending"
            @click="changePage(pageNumber - 1)"
          >
            Sebelumnya
          </button>
          <span>Halaman {{ pageNumber }} dari {{ totalPages }}</span>
          <button
            type="button"
            :disabled="pageNumber >= totalPages || rowsPending"
            @click="changePage(pageNumber + 1)"
          >
            Berikutnya
          </button>
        </nav>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
type CatalogResponse<T> = { data: T[] }
type Database = { name: string }
type Table = { name: string; engine: string }
type Column = { name: string; type: string }
type TableRow = Record<string, unknown>
type RowsResponse = {
  columns: Column[]
  rows: TableRow[]
  count: number
  page: number
  limit: number
  orderGuaranteed: boolean
}

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
const rowColumns = ref<Column[]>([])
const tableRows = ref<TableRow[]>([])
const rowCount = ref(0)
const pageNumber = ref(1)
const pageSize = ref(50)
const rowsPending = ref(false)
const rowsError = ref('')
const orderGuaranteed = ref(true)
let rowRequestId = 0

const totalPages = computed(() => Math.max(1, Math.ceil(rowCount.value / pageSize.value)))
const rowsRange = computed(() => {
  const first = rowCount.value === 0 ? 0 : (pageNumber.value - 1) * pageSize.value + 1
  const last = Math.min(pageNumber.value * pageSize.value, rowCount.value)
  const format = (value: number) => new Intl.NumberFormat('id-ID').format(value)
  return `${format(first)}-${format(last)} dari ${format(rowCount.value)}`
})

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

async function loadRows(database: string, table: string) {
  const requestId = ++rowRequestId
  const requestedPage = pageNumber.value
  const requestedLimit = pageSize.value
  rowsPending.value = true
  rowsError.value = ''
  tableRows.value = []
  rowColumns.value = []
  rowCount.value = 0

  try {
    const response = await $fetch<RowsResponse>('/api/rows', {
      query: {
        database,
        table,
        page: requestedPage,
        limit: requestedLimit,
      },
    })

    if (requestId !== rowRequestId
      || selectedDatabase.value !== database
      || selectedTable.value !== table) {
      return
    }

    rowColumns.value = response.columns
    tableRows.value = response.rows
    rowCount.value = response.count
    pageNumber.value = response.page
    orderGuaranteed.value = response.orderGuaranteed
  } catch (error) {
    if (requestId === rowRequestId
      && selectedDatabase.value === database
      && selectedTable.value === table) {
      rowsError.value = getErrorMessage(error, 'Terjadi kesalahan saat mengambil isi tabel.')
    }
  } finally {
    if (requestId === rowRequestId) {
      rowsPending.value = false
    }
  }
}

function displayCellValue(value: unknown): string {
  if (value === null) return 'NULL'
  if (value === '') return '(kosong)'
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value) ?? String(value)
  return String(value)
}

function handlePageSizeChange(event: Event) {
  const selectedSize = Number((event.target as HTMLSelectElement).value)
  if (![25, 50, 100].includes(selectedSize)) return

  pageSize.value = selectedSize
  pageNumber.value = 1
  if (selectedDatabase.value && selectedTable.value) {
    void loadRows(selectedDatabase.value, selectedTable.value)
  }
}

function changePage(page: number) {
  if (page < 1 || page > totalPages.value || rowsPending.value) return

  pageNumber.value = page
  if (selectedDatabase.value && selectedTable.value) {
    void loadRows(selectedDatabase.value, selectedTable.value)
  }
}

watch(
  [selectedDatabase, selectedTable],
  ([database, table]) => {
    pageNumber.value = 1
    rowRequestId += 1
    tableRows.value = []
    rowColumns.value = []
    rowCount.value = 0
    rowsError.value = ''
    orderGuaranteed.value = true

    if (database && table) {
      void loadRows(database, table)
    } else {
      rowsPending.value = false
    }
  },
  { immediate: true },
)

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
.rows-card {
  max-width: 920px;
  margin-top: 14px;
}

.rows-heading,
.rows-toolbar,
.rows-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.rows-heading {
  min-width: 0;
  margin-bottom: 12px;
}

.rows-heading .page-kicker {
  margin-bottom: 4px;
}

.rows-heading .card-title {
  margin: 0;
}

.rows-heading code {
  max-width: 50%;
  overflow: hidden;
  color: #375875;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rows-order-note {
  margin-top: 0;
}

.rows-toolbar {
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.rows-range {
  margin: 0;
  color: var(--warna-redup);
  font-size: 13px;
}

.rows-limit-field {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--warna-redup);
  font-size: 13px;
}

.rows-limit-field select {
  min-height: 40px;
  padding: 6px 9px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
}

.rows-table-viewport {
  max-width: 100%;
  max-height: 520px;
  overflow: auto;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
}

.rows-table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
}

.rows-table th,
.rows-table td {
  max-width: 240px;
  padding: 10px 12px;
  border-bottom: 1px solid #e8eff5;
  text-align: left;
  vertical-align: top;
}

.rows-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: #375875;
  background: #f3f8fc;
  font-weight: 700;
}

.rows-table th small {
  display: block;
  max-width: 210px;
  overflow: hidden;
  color: var(--warna-redup);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rows-table td {
  color: var(--warna-teks);
  background: #fff;
}

.rows-table tr:last-child td {
  border-bottom: 0;
}

.rows-cell-value {
  display: block;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rows-cell-value--null {
  color: #8a97a6;
  font-style: italic;
}

.rows-cell-value--empty {
  color: var(--warna-redup);
  font-style: italic;
}

.rows-pagination {
  justify-content: flex-end;
  flex-wrap: wrap;
  margin-top: 14px;
}

.rows-pagination span {
  color: var(--warna-redup);
  font-size: 13px;
}

.rows-pagination button {
  min-height: 42px;
  padding: 7px 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: var(--warna-biru-muda);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.rows-pagination button:hover:not(:disabled) {
  border-color: var(--warna-utama);
}

.rows-pagination button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.rows-pagination button:focus-visible,
.rows-limit-field select:focus-visible {
  outline: 2px solid var(--warna-utama);
  outline-offset: 2px;
}

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
