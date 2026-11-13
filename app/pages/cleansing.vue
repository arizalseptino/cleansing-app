<template>
  <div>
    <p class="page-kicker">Ruang kerja</p>
    <h1 class="page-title">Cleansing data</h1>
    <p class="page-description">
      Pilih fitur dan kolom untuk melihat perkiraan hasil cleansing pada data ClickHouse.
    </p>

    <section class="kartu cleansing-card" aria-label="Pengaturan pratinjau cleansing">
      <h2 class="card-title">Atur pratinjau</h2>
      <div class="cleansing-form">
        <div class="field-group">
          <label for="feature-select">Fitur cleansing</label>
          <select
            id="feature-select"
            v-model="selectedFeatureId"
            :disabled="featuresPending || features.length === 0"
          >
            <option value="">Pilih fitur</option>
            <option v-for="feature in features" :key="feature.id" :value="feature.id">
              {{ feature.name }}
            </option>
          </select>
          <p v-if="featuresPending" class="field-message" role="status">Memuat daftar fitur...</p>
          <p v-else-if="featuresError" class="field-message field-error" role="alert">
            Gagal memuat fitur: {{ featuresError }}
            <button type="button" class="inline-retry" @click="loadFeatures">Coba lagi</button>
          </p>
          <p v-else-if="features.length === 0" class="field-message" role="status">
            Belum ada fitur cleansing yang tersedia.
          </p>
        </div>

        <p v-if="selectedFeature" class="feature-description">{{ selectedFeature.description }}</p>

        <template v-if="selectedFeature">
          <div class="field-group">
            <label for="source-database">Database sumber</label>
            <select
              id="source-database"
              :value="sourceDatabase ?? ''"
              :disabled="databasesPending || databases.length === 0"
              @change="handleSourceDatabaseChange"
            >
              <option value="">Pilih database sumber</option>
              <option v-for="database in databases" :key="database.name" :value="database.name">
                {{ database.name }}
              </option>
            </select>
            <p v-if="databasesPending" class="field-message" role="status">Memuat daftar database...</p>
            <p v-else-if="databasesError" class="field-message field-error" role="alert">
              Gagal memuat database: {{ databasesError }}
              <button type="button" class="inline-retry" @click="loadDatabases">Coba lagi</button>
            </p>
          </div>

          <div class="field-group">
            <label for="source-table">Tabel sumber</label>
            <select
              id="source-table"
              :value="sourceTable ?? ''"
              :disabled="!sourceDatabase || sourceTablesPending || sourceTables.length === 0"
              @change="handleSourceTableChange"
            >
              <option value="">Pilih tabel sumber</option>
              <option v-for="table in sourceTables" :key="table.name" :value="table.name">
                {{ table.name }}
              </option>
            </select>
            <p v-if="!sourceDatabase" class="field-message">Pilih database sumber terlebih dahulu.</p>
            <p v-else-if="sourceTablesPending" class="field-message" role="status">Memuat tabel sumber...</p>
            <p v-else-if="sourceTablesError" class="field-message field-error" role="alert">
              Gagal memuat tabel sumber: {{ sourceTablesError }}
              <button type="button" class="inline-retry" @click="loadSourceTables(sourceDatabase)">Coba lagi</button>
            </p>
            <p v-else-if="sourceTables.length === 0" class="field-message" role="status">
              Tidak ada tabel sumber yang dapat dipilih.
            </p>
          </div>

          <div class="field-group">
            <label for="source-column">Kolom sumber teks</label>
            <select
              id="source-column"
              v-model="sourceColumn"
              :disabled="!sourceTable || sourceColumnsPending || sourceTextColumns.length === 0"
            >
              <option value="">Pilih kolom sumber teks</option>
              <option v-for="column in sourceTextColumns" :key="column.name" :value="column.name">
                {{ column.name }} ({{ column.type }})
              </option>
            </select>
            <p v-if="sourceColumnsPending" class="field-message" role="status">Memuat kolom sumber...</p>
            <p v-else-if="sourceColumnsError" class="field-message field-error" role="alert">
              Gagal memuat kolom sumber: {{ sourceColumnsError }}
              <button
                v-if="sourceDatabase && sourceTable"
                type="button"
                class="inline-retry"
                @click="loadSourceColumns(sourceDatabase, sourceTable)"
              >
                Coba lagi
              </button>
            </p>
            <p v-else-if="sourceTable && sourceTextColumns.length === 0" class="field-message" role="status">
              Tabel ini tidak memiliki kolom bertipe teks yang didukung.
            </p>
          </div>

          <div class="field-group">
            <label for="target-column">Kolom target kosong</label>
            <select
              id="target-column"
              v-model="targetColumn"
              :disabled="!sourceTable || sourceColumnsPending || sourceTextColumns.length === 0"
            >
              <option value="">Pilih kolom target</option>
              <option v-for="column in sourceTextColumns" :key="column.name" :value="column.name">
                {{ column.name }} ({{ column.type }})
              </option>
            </select>
          </div>

          <div class="field-group">
            <label for="master-database">Database master</label>
            <select
              id="master-database"
              v-model="masterDatabase"
              :disabled="databasesPending || databases.length === 0"
              @change="handleMasterDatabaseChange"
            >
              <option value="">Pilih database master</option>
              <option v-for="database in databases" :key="database.name" :value="database.name">
                {{ database.name }}
              </option>
            </select>
          </div>

          <div class="field-group">
            <label for="master-table">Tabel master</label>
            <select
              id="master-table"
              v-model="masterTable"
              :disabled="!masterDatabase || masterTablesPending || masterTables.length === 0"
              @change="handleMasterTableChange"
            >
              <option value="">Pilih tabel master</option>
              <option v-for="table in masterTables" :key="table.name" :value="table.name">
                {{ table.name }}
              </option>
            </select>
            <p v-if="masterTablesPending" class="field-message" role="status">Memuat tabel master...</p>
            <p v-else-if="masterTablesError" class="field-message field-error" role="alert">
              Gagal memuat tabel master: {{ masterTablesError }}
              <button
                v-if="masterDatabase"
                type="button"
                class="inline-retry"
                @click="loadMasterTables(masterDatabase)"
              >
                Coba lagi
              </button>
            </p>
            <p v-else-if="masterDatabase && masterTables.length === 0" class="field-message" role="status">
              Database ini tidak memiliki tabel yang dapat dipilih.
            </p>
          </div>

          <div class="field-group">
            <label for="master-column">Kolom kunci pencarian</label>
            <select
              id="master-column"
              v-model="masterColumn"
              :disabled="!masterTable || masterColumnsPending || masterTextColumns.length === 0"
            >
              <option value="">Pilih kolom kunci pencarian</option>
              <option v-for="column in masterTextColumns" :key="column.name" :value="column.name">
                {{ column.name }} ({{ column.type }})
              </option>
            </select>
            <p v-if="masterColumnsPending" class="field-message" role="status">Memuat kolom master...</p>
            <p v-else-if="masterColumnsError" class="field-message field-error" role="alert">
              Gagal memuat kolom master: {{ masterColumnsError }}
              <button
                v-if="masterDatabase && masterTable"
                type="button"
                class="inline-retry"
                @click="loadMasterColumns(masterDatabase, masterTable)"
              >
                Coba lagi
              </button>
            </p>
            <p v-else-if="masterTable && masterTextColumns.length === 0" class="field-message" role="status">
              Tabel master ini tidak memiliki kolom bertipe teks yang didukung.
            </p>
          </div>

          <div class="field-group">
            <label for="master-fill-column">Kolom nilai pengisi (opsional)</label>
            <select
              id="master-fill-column"
              v-model="masterFillColumn"
              :disabled="!masterTable || masterColumnsPending || masterTextColumns.length === 0"
            >
              <option value="">Gunakan kolom kunci pencarian sebagai nilai pengisi</option>
              <option v-for="column in masterTextColumns" :key="column.name" :value="column.name">
                {{ column.name }} ({{ column.type }})
              </option>
            </select>
          </div>
        </template>
      </div>

      <p class="safety-note">
        Pratinjau ini hanya membaca data dan tidak mengubah tabel maupun isinya. Penerapan hasil akan tersedia pada tahap berikutnya.
      </p>
      <button class="preview-button" type="button" :disabled="!canPreview || previewPending" @click="runPreview">
        {{ previewPending ? 'Menjalankan pratinjau...' : 'Pratinjau' }}
      </button>
      <p v-if="previewError" class="preview-error" role="alert">{{ previewError }}</p>
      <button
        v-if="previewResult"
        class="apply-open-button"
        type="button"
        :disabled="!canApply"
        @click="openApplyConfirmation"
      >
        Terapkan ke tabel baru
      </button>
      <p v-if="previewResult && !previewMatchesCurrentParameters" class="field-message" role="status">
        Parameter berubah sejak pratinjau. Jalankan pratinjau ulang sebelum menerapkan.
      </p>
    </section>

    <section
      v-if="showApplyConfirmation"
      class="kartu apply-confirmation"
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-confirmation-title"
    >
      <h2 id="apply-confirmation-title" class="card-title">Konfirmasi tabel hasil</h2>
      <div class="field-group">
        <label for="result-table-name">Nama tabel hasil</label>
        <input
          id="result-table-name"
          v-model="resultTableName"
          type="text"
          maxlength="64"
          autocomplete="off"
          :disabled="applying"
        />
        <p v-if="!resultNameValid" class="field-message field-error" role="alert">
          Nama harus diawali huruf dan hanya berisi huruf, angka, atau garis bawah (maksimal 64 karakter).
        </p>
      </div>
      <label class="save-original-option">
        <input v-model="saveOriginal" type="checkbox" :disabled="applying" />
        <span>Simpan nilai lama di kolom <code>{{ targetOriginalColumnName }}</code></span>
      </label>

      <dl class="apply-summary">
        <div>
          <dt>Tabel sumber</dt>
          <dd><code>{{ sourceDatabase }}.{{ sourceTable }}</code> tidak akan diubah.</dd>
        </div>
        <div>
          <dt>Tabel hasil yang dibuat</dt>
          <dd><code>{{ sourceDatabase }}.{{ resultTableName || '(nama belum diisi)' }}</code></dd>
        </div>
        <div>
          <dt>Perkiraan baris yang akan terisi</dt>
          <dd>{{ formatNumber(previewResult?.statistics.fillableRows ?? 0) }}</dd>
        </div>
      </dl>

      <p v-if="!canApply" class="field-message field-error" role="alert">
        Parameter tidak sama dengan pratinjau. Tutup konfirmasi dan jalankan pratinjau ulang.
      </p>
      <p v-if="applyError" class="preview-error" role="alert">{{ applyError }}</p>
      <p v-if="applying" class="field-message" role="status">
        Sedang membuat dan mengisi tabel hasil. Mohon tunggu...
      </p>
      <div class="apply-actions">
        <button
          class="preview-button"
          type="button"
          :disabled="!canApply || !resultNameValid || applying"
          @click="applyToNewTable"
        >
          {{ applying ? 'Sedang menerapkan...' : 'Ya, buat tabel hasil' }}
        </button>
        <button class="cancel-button" type="button" :disabled="applying" @click="showApplyConfirmation = false">
          Batal
        </button>
      </div>
    </section>

    <section v-if="applyResult" class="kartu apply-result" aria-live="polite">
      <h2 class="card-title">Penerapan berhasil</h2>
      <p class="field-message">Tabel sumber tetap tidak diubah. Tabel hasil baru sudah selesai diverifikasi.</p>
      <dl class="apply-summary">
        <div>
          <dt>Tabel hasil</dt>
          <dd><code>{{ applyResult.database }}.{{ applyResult.tableName }}</code></dd>
        </div>
        <div>
          <dt>Jumlah baris</dt>
          <dd>{{ formatNumber(applyResult.rowCount) }}</dd>
        </div>
        <div>
          <dt>Baris terisi</dt>
          <dd>{{ formatNumber(applyResult.filledRows) }}</dd>
        </div>
        <div>
          <dt>Baris ambigu dibiarkan kosong</dt>
          <dd>{{ formatNumber(applyResult.ambiguousRowsLeftEmpty) }}</dd>
        </div>
        <div>
          <dt>Durasi</dt>
          <dd>{{ formatDuration(applyResult.durationMs) }}</dd>
        </div>
      </dl>
      <button class="preview-button" type="button" @click="viewResultTable">
        Lihat isi tabel hasil
      </button>
    </section>

    <section v-if="previewResult" class="kartu result-card" aria-live="polite">
      <h2 class="card-title">Hasil pratinjau</h2>
      <div class="statistics-grid">
        <article class="statistic-card">
          <span>Jumlah baris sumber</span>
          <strong>{{ formatNumber(previewResult.statistics.sourceRows) }}</strong>
        </article>
        <article class="statistic-card">
          <span>Target kosong</span>
          <strong>{{ formatNumber(previewResult.statistics.targetEmptyRows) }}</strong>
        </article>
        <article class="statistic-card">
          <span>Bisa diisi</span>
          <strong>{{ formatNumber(previewResult.statistics.fillableRows) }}</strong>
        </article>
        <article class="statistic-card statistic-warning">
          <span>Ambigu</span>
          <strong>{{ formatNumber(previewResult.statistics.ambiguousRows) }}</strong>
        </article>
        <article class="statistic-card">
          <span>Tetap kosong</span>
          <strong>{{ formatNumber(previewResult.statistics.remainingEmptyRows) }}</strong>
        </article>
      </div>

      <p v-if="!previewResult.orderedBySortingKey" class="field-message" role="status">
        Tabel sumber tidak memiliki sorting key; urutan contoh baris tidak dijamin.
      </p>
      <p v-else class="field-message" role="status">
        Contoh baris diurutkan menggunakan kolom sorting key tabel sumber.
      </p>

      <div class="category-tabs" role="tablist" aria-label="Kategori contoh pratinjau">
        <button
          v-for="category in categories"
          :key="category.key"
          type="button"
          role="tab"
          :aria-selected="activeCategory === category.key"
          :class="{ 'category-tab--active': activeCategory === category.key }"
          @click="activeCategory = category.key"
        >
          {{ category.label }}
          <span>{{ formatNumber(previewResult.statistics[category.countKey]) }}</span>
        </button>
      </div>

      <p v-if="activeExamples.length === 0" class="field-message" role="status">
        Tidak ada contoh baris untuk kategori {{ activeCategoryLabel }}.
      </p>
      <div v-else class="preview-table-viewport">
        <table class="preview-table">
          <thead>
            <tr>
              <th v-for="column in previewResult.keyColumns" :key="column.valueKey" scope="col">
                {{ column.name }} (kunci)
              </th>
              <th scope="col">{{ previewResult.sourceColumn }} (sumber)</th>
              <th scope="col">{{ previewResult.targetColumn }} (sebelum)</th>
              <th scope="col">{{ previewResult.targetColumn }} (usulan)</th>
              <th scope="col">Kunci master yang cocok</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in activeExamples" :key="index">
              <td v-for="column in previewResult.keyColumns" :key="column.valueKey">
                {{ displayValue(row[column.valueKey]) }}
              </td>
              <td>{{ displayValue(row.__source_text) }}</td>
              <td>{{ displayValue(row.__target_before) }}</td>
              <td>{{ displayValue(row.suggested_value) }}</td>
              <td>{{ displayValue(row.matched_master_key) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
type Database = { name: string }
type Table = { name: string; engine: string }
type Column = { name: string; type: string }
type FeatureParameter = { key: string; label: string; description: string; kind: string }
type Feature = { id: string; name: string; description: string; parameters: FeatureParameter[] }
type PreviewResult = {
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
type ApplyResult = {
  database: string
  tableName: string
  rowCount: number
  filledRows: number
  ambiguousRowsLeftEmpty: number
  durationMs: number
}
type CategoryKey = 'fillable' | 'ambiguous' | 'remainingEmpty'
type CategoryDefinition = { key: CategoryKey; label: string; countKey: 'fillableRows' | 'ambiguousRows' | 'remainingEmptyRows' }
type CatalogResponse<T> = { data: T[] }

const source = useSelectedSource()
const sourceDatabase = source.database
const sourceTable = source.table
const features = ref<Feature[]>([])
const selectedFeatureId = ref('')
const featuresPending = ref(true)
const featuresError = ref('')
const databases = ref<Database[]>([])
const databasesPending = ref(true)
const databasesError = ref('')
const sourceTables = ref<Table[]>([])
const sourceTablesPending = ref(false)
const sourceTablesError = ref('')
const sourceColumns = ref<Column[]>([])
const sourceColumnsPending = ref(false)
const sourceColumnsError = ref('')
const sourceColumn = ref('')
const targetColumn = ref('')
const masterDatabase = ref('')
const masterTables = ref<Table[]>([])
const masterTablesPending = ref(false)
const masterTablesError = ref('')
const masterTable = ref('')
const masterColumns = ref<Column[]>([])
const masterColumnsPending = ref(false)
const masterColumnsError = ref('')
const masterColumn = ref('')
const masterFillColumn = ref('')
const previewPending = ref(false)
const previewError = ref('')
const previewResult = ref<PreviewResult | null>(null)
const previewSignature = ref('')
const activeCategory = ref<CategoryKey>('fillable')
const showApplyConfirmation = ref(false)
const resultTableName = ref('')
const saveOriginal = ref(true)
const applying = ref(false)
const applyError = ref('')
const applyResult = ref<ApplyResult | null>(null)
const categories: CategoryDefinition[] = [
  { key: 'fillable', label: 'Bisa diisi', countKey: 'fillableRows' },
  { key: 'ambiguous', label: 'Ambigu', countKey: 'ambiguousRows' },
  { key: 'remainingEmpty', label: 'Tetap kosong', countKey: 'remainingEmptyRows' },
]

const textTypes = new Set(['String', 'Nullable(String)', 'LowCardinality(String)'])
const sourceTextColumns = computed(() => sourceColumns.value.filter(({ type }) => textTypes.has(type)))
const masterTextColumns = computed(() => masterColumns.value.filter(({ type }) => textTypes.has(type)))
const selectedFeature = computed(() => features.value.find(({ id }) => id === selectedFeatureId.value))
const activeExamples = computed(() => previewResult.value?.examples[activeCategory.value] ?? [])
const activeCategoryLabel = computed(() => categories.find(({ key }) => key === activeCategory.value)?.label ?? '')
const currentPreviewSignature = computed(() => JSON.stringify({
  featureId: selectedFeatureId.value,
  parameters: getPreviewParameters(),
}))
const previewMatchesCurrentParameters = computed(() => Boolean(
  previewSignature.value && previewSignature.value === currentPreviewSignature.value,
))
const canApply = computed(() => Boolean(
  previewResult.value
  && previewMatchesCurrentParameters.value
  && !applying.value
  && !applyResult.value,
))
const resultNameValid = computed(() => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(resultTableName.value))
const targetOriginalColumnName = computed(() => `${targetColumn.value}_asli`)
const canPreview = computed(() => Boolean(
  selectedFeature.value
  && sourceDatabase.value
  && sourceTable.value
  && sourceColumn.value
  && targetColumn.value
  && masterDatabase.value
  && masterTable.value
  && masterColumn.value,
))

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object'
      && 'message' in error.data && typeof error.data.message === 'string') {
      return error.data.message
    }
    if ('message' in error && typeof error.message === 'string') return error.message
  }
  return fallback
}

function getPreviewParameters(): Record<string, string | undefined> {
  return {
    sourceDatabase: sourceDatabase.value ?? undefined,
    sourceTable: sourceTable.value ?? undefined,
    sourceColumn: sourceColumn.value || undefined,
    targetColumn: targetColumn.value || undefined,
    masterDatabase: masterDatabase.value || undefined,
    masterTable: masterTable.value || undefined,
    masterColumn: masterColumn.value || undefined,
    masterFillColumn: masterFillColumn.value || undefined,
  }
}

async function loadFeatures() {
  featuresPending.value = true
  featuresError.value = ''
  try {
    const response = await $fetch<CatalogResponse<Feature>>('/api/cleansing/features')
    features.value = response.data
  } catch (error) {
    featuresError.value = getErrorMessage(error, 'Daftar fitur tidak dapat dimuat.')
  } finally {
    featuresPending.value = false
  }
}

async function loadDatabases() {
  databasesPending.value = true
  databasesError.value = ''
  try {
    const response = await $fetch<CatalogResponse<Database>>('/api/databases')
    databases.value = response.data
  } catch (error) {
    databasesError.value = getErrorMessage(error, 'Daftar database tidak dapat dimuat.')
  } finally {
    databasesPending.value = false
  }
}

async function loadSourceTables(database: string) {
  sourceTablesPending.value = true
  sourceTablesError.value = ''
  sourceTables.value = []
  sourceColumns.value = []
  sourceColumn.value = ''
  targetColumn.value = ''
  try {
    const response = await $fetch<CatalogResponse<Table>>('/api/tables', { query: { database } })
    if (sourceDatabase.value !== database) return
    sourceTables.value = response.data
    if (sourceTable.value && !sourceTables.value.some(({ name }) => name === sourceTable.value)) {
      source.setTable(null)
    }
  } catch (error) {
    if (sourceDatabase.value === database) {
      sourceTablesError.value = getErrorMessage(error, 'Daftar tabel sumber tidak dapat dimuat.')
    }
  } finally {
    if (sourceDatabase.value === database) sourceTablesPending.value = false
  }
}

async function loadSourceColumns(database: string, table: string) {
  sourceColumnsPending.value = true
  sourceColumnsError.value = ''
  sourceColumns.value = []
  sourceColumn.value = ''
  targetColumn.value = ''
  try {
    const response = await $fetch<CatalogResponse<Column>>('/api/columns', { query: { database, table } })
    if (sourceDatabase.value === database && sourceTable.value === table) {
      sourceColumns.value = response.data
    }
  } catch (error) {
    if (sourceDatabase.value === database && sourceTable.value === table) {
      sourceColumnsError.value = getErrorMessage(error, 'Daftar kolom sumber tidak dapat dimuat.')
    }
  } finally {
    if (sourceDatabase.value === database && sourceTable.value === table) sourceColumnsPending.value = false
  }
}

async function loadMasterTables(database: string) {
  masterTablesPending.value = true
  masterTablesError.value = ''
  masterTables.value = []
  masterTable.value = ''
  masterColumns.value = []
  masterColumn.value = ''
  masterFillColumn.value = ''
  try {
    const response = await $fetch<CatalogResponse<Table>>('/api/tables', { query: { database } })
    if (masterDatabase.value === database) masterTables.value = response.data
  } catch (error) {
    if (masterDatabase.value === database) {
      masterTablesError.value = getErrorMessage(error, 'Daftar tabel master tidak dapat dimuat.')
    }
  } finally {
    if (masterDatabase.value === database) masterTablesPending.value = false
  }
}

async function loadMasterColumns(database: string, table: string) {
  masterColumnsPending.value = true
  masterColumnsError.value = ''
  masterColumns.value = []
  masterColumn.value = ''
  masterFillColumn.value = ''
  try {
    const response = await $fetch<CatalogResponse<Column>>('/api/columns', { query: { database, table } })
    if (masterDatabase.value === database && masterTable.value === table) {
      masterColumns.value = response.data
    }
  } catch (error) {
    if (masterDatabase.value === database && masterTable.value === table) {
      masterColumnsError.value = getErrorMessage(error, 'Daftar kolom master tidak dapat dimuat.')
    }
  } finally {
    if (masterDatabase.value === database && masterTable.value === table) masterColumnsPending.value = false
  }
}

function handleSourceDatabaseChange(event: Event) {
  const database = (event.target as HTMLSelectElement).value
  source.setDatabase(database || null)
  sourceTablesError.value = ''
  if (database) void loadSourceTables(database)
}

function handleSourceTableChange(event: Event) {
  const table = (event.target as HTMLSelectElement).value
  source.setTable(table || null)
  sourceColumn.value = ''
  targetColumn.value = ''
}

function handleMasterDatabaseChange() {
  masterTables.value = []
  masterTable.value = ''
  masterColumns.value = []
  masterColumn.value = ''
  masterTablesError.value = ''
  if (masterDatabase.value) void loadMasterTables(masterDatabase.value)
}

function handleMasterTableChange() {
  masterColumn.value = ''
  if (masterDatabase.value && masterTable.value) {
    void loadMasterColumns(masterDatabase.value, masterTable.value)
  }
}

async function runPreview() {
  if (!selectedFeature.value || !canPreview.value || previewPending.value) return
  const featureId = selectedFeature.value.id
  const parameters = getPreviewParameters()
  const requestSignature = JSON.stringify({ featureId, parameters })
  previewPending.value = true
  previewError.value = ''
  previewResult.value = null
  previewSignature.value = ''
  applyResult.value = null
  showApplyConfirmation.value = false
  activeCategory.value = 'fillable'
  try {
    previewResult.value = await $fetch<PreviewResult>('/api/cleansing/preview', {
      method: 'POST',
      body: { featureId, parameters },
    })
    previewSignature.value = requestSignature
  } catch (error) {
    previewError.value = getErrorMessage(error, 'Pratinjau tidak dapat dijalankan.')
  } finally {
    previewPending.value = false
  }
}

function openApplyConfirmation() {
  if (!canApply.value || !sourceTable.value) return
  resultTableName.value = `${sourceTable.value}_cleaned`
  saveOriginal.value = true
  applyError.value = ''
  showApplyConfirmation.value = true
}

async function applyToNewTable() {
  if (!selectedFeature.value || !canApply.value || !resultNameValid.value) return
  const featureId = selectedFeature.value.id
  const parameters = getPreviewParameters()
  if (JSON.stringify({ featureId, parameters }) !== previewSignature.value) return

  applying.value = true
  applyError.value = ''
  try {
    applyResult.value = await $fetch<ApplyResult>('/api/cleansing/apply', {
      method: 'POST',
      body: {
        featureId,
        parameters,
        resultTableName: resultTableName.value,
        saveOriginal: saveOriginal.value,
      },
    })
    showApplyConfirmation.value = false
  } catch (error) {
    applyError.value = getErrorMessage(error, 'Penerapan gagal. Tabel sumber tidak diubah.')
  } finally {
    applying.value = false
  }
}

async function viewResultTable() {
  if (!applyResult.value) return
  source.setDatabase(applyResult.value.database)
  source.setTable(applyResult.value.tableName)
  await navigateTo('/sumber-data')
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

function formatDuration(value: number): string {
  if (value < 1000) return `${formatNumber(value)} ms`
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value / 1000)} detik`
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (value === '') return '(kosong)'
  if (typeof value === 'object') return JSON.stringify(value) ?? String(value)
  return String(value)
}

watch([sourceDatabase, sourceTable], ([database, table]) => {
  sourceColumns.value = []
  sourceColumnsError.value = ''
  sourceColumn.value = ''
  targetColumn.value = ''
  if (database && table) void loadSourceColumns(database, table)
})

watch(selectedFeatureId, () => {
  previewResult.value = null
  previewSignature.value = ''
  previewError.value = ''
  applyResult.value = null
  showApplyConfirmation.value = false
})

onMounted(async () => {
  await Promise.all([loadFeatures(), loadDatabases()])
  if (sourceDatabase.value) await loadSourceTables(sourceDatabase.value)
  if (sourceDatabase.value && sourceTable.value) {
    await loadSourceColumns(sourceDatabase.value, sourceTable.value)
  }
})
</script>

<style scoped>
.cleansing-card,
.result-card,
.apply-confirmation,
.apply-result {
  max-width: 920px;
  margin-top: 20px;
}

.cleansing-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.field-group {
  display: grid;
  align-content: start;
  gap: 7px;
  min-width: 0;
}

.field-group label {
  color: #526479;
  font-size: 13px;
  font-weight: 650;
}

.field-group select {
  width: 100%;
  min-height: 44px;
  padding: 8px 11px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
  font-size: 14px;
}

.field-group input[type='text'] {
  width: 100%;
  min-height: 44px;
  padding: 8px 11px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
  font-size: 14px;
}

.field-group select:focus-visible,
.field-group input[type='text']:focus-visible,
.preview-button:focus-visible,
.inline-retry:focus-visible,
.apply-open-button:focus-visible,
.cancel-button:focus-visible {
  outline: 2px solid var(--warna-utama);
  outline-offset: 2px;
}

.field-group select:disabled {
  color: #8b9aac;
  background: #f5f8fa;
}

.field-message,
.feature-description,
.safety-note,
.preview-error {
  margin: 0;
  color: var(--warna-redup);
  font-size: 13px;
}

.field-error,
.preview-error {
  color: #a64b42;
}

.inline-retry {
  margin-left: 5px;
  padding: 0;
  border: 0;
  color: #355f28;
  background: transparent;
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

.feature-description {
  grid-column: 1 / -1;
  margin-top: -6px;
}

.safety-note {
  margin-top: 18px;
  padding: 12px 14px;
  border-left: 3px solid var(--warna-pistachio);
  border-radius: 4px;
  color: #526479;
  background: #f7f9ed;
}

.preview-button {
  min-height: 44px;
  margin-top: 14px;
  padding: 9px 18px;
  border: 1px solid var(--warna-utama);
  border-radius: 8px;
  color: #fff;
  background: var(--warna-utama);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.preview-button:hover:not(:disabled) {
  filter: brightness(0.96);
}

.preview-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.apply-open-button,
.cancel-button {
  min-height: 44px;
  margin: 14px 0 0 8px;
  padding: 9px 16px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: #355875;
  background: var(--warna-biru-muda);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.apply-open-button:disabled,
.cancel-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.apply-confirmation {
  border-top: 3px solid var(--warna-pistachio);
}

.save-original-option {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 14px;
  color: #526479;
  font-size: 13px;
}

.save-original-option input {
  width: 17px;
  height: 17px;
  margin: 2px 0 0;
  accent-color: var(--warna-utama);
}

.save-original-option code,
.apply-summary code {
  overflow-wrap: anywhere;
}

.apply-summary {
  display: grid;
  gap: 10px;
  margin: 16px 0 4px;
}

.apply-summary div {
  display: grid;
  grid-template-columns: minmax(150px, 0.35fr) minmax(0, 1fr);
  gap: 12px;
  padding-bottom: 9px;
  border-bottom: 1px solid #e8f0f7;
}

.apply-summary dt {
  color: var(--warna-redup);
  font-size: 13px;
}

.apply-summary dd {
  margin: 0;
  color: #263a4e;
  font-size: 13px;
  font-weight: 600;
}

.apply-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.apply-actions .cancel-button {
  margin-top: 14px;
}

.apply-result {
  border-top: 3px solid var(--warna-pistachio);
}

.preview-error {
  margin-top: 12px;
}

.statistics-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0;
}

.category-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 14px 0 10px;
  border-bottom: 1px solid var(--warna-garis);
}

.category-tabs button {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  margin-bottom: -1px;
  padding: 8px 11px;
  border: 0;
  border-bottom: 2px solid transparent;
  color: #637287;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}

.category-tabs button span {
  min-width: 22px;
  padding: 1px 6px;
  border-radius: 999px;
  color: #526479;
  background: var(--warna-biru-muda);
  font-size: 11px;
  text-align: center;
}

.category-tabs button.category-tab--active {
  border-bottom-color: var(--warna-utama);
  color: var(--warna-utama);
}

.category-tabs button:focus-visible {
  outline: 2px solid var(--warna-utama);
  outline-offset: -2px;
}

.statistic-card {
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 12px;
  border: 1px solid #e8f0f7;
  border-radius: 10px;
  background: #f7fbfe;
}

.statistic-card span {
  color: var(--warna-redup);
  font-size: 12px;
}

.statistic-card strong {
  color: #263a4e;
  font-size: 21px;
  font-weight: 700;
}

.statistic-warning {
  border-color: #e7e8ce;
  background: #fbfbed;
}

.preview-table-viewport {
  max-width: 100%;
  margin-top: 12px;
  overflow: auto;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
}

.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.preview-table th,
.preview-table td {
  min-width: 130px;
  padding: 10px 12px;
  border-bottom: 1px solid #e8f0f7;
  text-align: left;
  vertical-align: top;
}

.preview-table th {
  color: #526479;
  background: #f4f8fb;
  font-weight: 700;
}

.preview-table td {
  max-width: 320px;
  overflow-wrap: anywhere;
}

@media (max-width: 720px) {
  .cleansing-form {
    grid-template-columns: 1fr;
  }

  .feature-description {
    grid-column: auto;
  }

  .statistics-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 420px) {
  .apply-summary div {
    grid-template-columns: 1fr;
    gap: 3px;
  }

  .statistics-grid {
    grid-template-columns: 1fr;
  }
}
</style>
