<template>
  <div class="workbench-page">
    <section class="kartu wb-source" aria-label="Sumber data">
      <div class="wb-source-title">
        <h2 class="card-title">Sumber</h2>
        <p>Tabel sumber tidak diubah oleh pratinjau.</p>
      </div>
      <div class="wb-source-field">
        <label for="workbench-database">Database</label>
        <select
          id="workbench-database"
          :title="pipeline.source.database || 'Database'"
          :value="pipeline.source.database"
          :disabled="databasesPending || Boolean(databasesError)"
          @change="changeDatabase"
        >
          <option value="">Pilih database</option>
          <option v-for="database in databases" :key="database.name" :value="database.name">
            {{ database.name }}
          </option>
        </select>
      </div>
      <div class="wb-source-field">
        <label for="workbench-table">Tabel sumber</label>
        <select
          id="workbench-table"
          :title="pipeline.source.table || 'Tabel sumber'"
          :value="pipeline.source.table"
          :disabled="!pipeline.source.database || tablesPending || Boolean(tablesError)"
          @change="changeTable"
        >
          <option value="">Pilih tabel</option>
          <option v-for="table in tables" :key="table.name" :value="table.name">
            {{ table.name }}
          </option>
        </select>
      </div>
      <button
        class="wb-button wb-primary wb-save-open"
        type="button"
        :disabled="!canOpenSave"
        @click="openSaveDialog"
      >
        Simpan sebagai tabel baru
      </button>
      <p v-if="databasesPending" class="wb-message" role="status">Memuat daftar database...</p>
      <p v-else-if="databasesError" class="wb-message wb-error" role="alert">
        {{ databasesError }} <button class="wb-link-button" type="button" @click="loadDatabases">Coba lagi</button>
      </p>
      <p v-if="tablesPending" class="wb-message" role="status">Memuat daftar tabel...</p>
      <p v-else-if="tablesError" class="wb-message wb-error" role="alert">
        {{ tablesError }} <button class="wb-link-button" type="button" @click="loadTables(pipeline.source.database)">Coba lagi</button>
      </p>
      <p v-if="persistenceError" class="wb-message wb-error" role="alert">{{ persistenceError }}</p>
    </section>

    <div class="wb-grid">
      <section class="kartu wb-steps-card" aria-label="Langkah cleansing">
        <div class="wb-card-heading">
          <div>
            <p class="page-kicker">Pipeline</p>
            <h2 class="card-title">Langkah</h2>
          </div>
          <button class="wb-button wb-small" type="button" :disabled="!sourceReady" @click="showOperations">
            Tambah langkah
          </button>
        </div>

        <p v-if="!sourceReady" class="wb-message">Pilih database dan tabel untuk memulai.</p>
        <template v-else>
          <button
            class="wb-step wb-source-step"
            :class="{ 'wb-step-selected': selectedStep === 0 }"
            type="button"
            @click="selectStep(0)"
          >
            <span class="wb-step-number">0</span>
            <span class="wb-step-copy">
              <strong>Data sumber</strong>
              <small :title="pipeline.source.table">{{ pipeline.source.table }}</small>
            </span>
            <span class="wb-status wb-status-valid">Sumber</span>
          </button>

          <ol v-if="pipeline.steps.length" class="wb-step-list">
            <li v-for="(step, index) in pipeline.steps" :key="step.id">
              <div class="wb-step-row">
                <button
                  class="wb-step"
                  :class="{ 'wb-step-selected': selectedStep === index + 1 }"
                  type="button"
                  @click="selectStep(index + 1)"
                >
                  <span class="wb-step-number">{{ index + 1 }}</span>
                  <span class="wb-step-copy">
                    <strong :title="operationName(step.op)">{{ operationName(step.op) }}</strong>
                    <small :title="touchedColumns(step).join(', ')">{{ touchedColumns(step).join(', ') || 'Tanpa kolom langsung' }}</small>
                  </span>
                  <span class="wb-status" :class="`wb-status-${stepStates[index]?.status ?? 'loading'}`">
                    {{ stepStatusLabel(stepStates[index]?.status) }}
                  </span>
                </button>
                <div class="wb-step-tools">
                  <button
                    class="wb-icon-button"
                    type="button"
                    :disabled="index === 0"
                    :aria-label="`Geser langkah ${index + 1} ke atas`"
                    @click="moveStep(index, -1)"
                  >Naik</button>
                  <button
                    class="wb-icon-button"
                    type="button"
                    :disabled="index === pipeline.steps.length - 1"
                    :aria-label="`Geser langkah ${index + 1} ke bawah`"
                    @click="moveStep(index, 1)"
                  >Turun</button>
                  <button class="wb-icon-button" type="button" @click="editStep(index)">Edit</button>
                  <button class="wb-icon-button wb-danger-text" type="button" @click="deleteStep(index)">Hapus</button>
                </div>
                <p v-if="stepStates[index]?.status === 'error'" class="wb-step-error" role="alert">
                  {{ stepStates[index]?.message }}
                </p>
                <p v-for="warning in stepStates[index]?.warnings ?? []" :key="warning" class="wb-message" role="status">
                  {{ warning }}
                </p>
              </div>
            </li>
          </ol>
          <p v-else class="wb-message">Belum ada langkah. Tambahkan operasi untuk membentuk hasil.</p>
        </template>

        <button
          class="wb-sql-link"
          type="button"
          :disabled="!sourceReady || pipeline.steps.length === 0"
          @click="openSql"
        >
          Lihat SQL
        </button>
      </section>

      <section class="kartu wb-data-card" aria-label="Data keluaran">
        <div class="wb-card-heading wb-data-heading">
          <div class="wb-data-title">
            <p class="page-kicker">Pratinjau</p>
            <h2 class="card-title">{{ selectedStep === 0 ? 'Data sumber' : `Hasil langkah ${selectedStep}` }}</h2>
          </div>
          <label class="wb-limit-field" for="workbench-limit">
            Baris per halaman
            <select id="workbench-limit" :value="limit" @change="changeLimit">
              <option :value="25">25</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </label>
        </div>
        <div class="wb-data-actions">
          <button
            class="wb-button wb-small"
            type="button"
            :disabled="selectedStep === 0 || !sourceReady || previewPending || stepStates[selectedStep - 1]?.status !== 'valid'"
            @click="loadStatistics"
          >
            Hitung statistik langkah ini
          </button>
          <span v-if="previewPending" class="wb-inline-status" role="status">Sedang menghitung pratinjau...</span>
        </div>
        <p v-for="warning in previewWarnings" :key="warning" class="wb-message" role="status">{{ warning }}</p>
        <p v-if="!sourceReady" class="wb-message">Pilih sumber untuk melihat data.</p>
        <p v-else-if="previewPending && previewRows.length === 0" class="wb-message" role="status">Memuat data...</p>
        <p v-else-if="previewError" class="wb-message wb-error" role="alert">{{ previewError }}</p>
        <p v-else-if="previewRows.length === 0" class="wb-message" role="status">Tidak ada baris pada halaman ini.</p>
        <template v-else>
          <div class="wb-table-viewport">
            <table class="wb-table">
              <thead>
                <tr>
                  <th v-for="column in visibleColumns" :key="column.name" scope="col">
                    <div class="wb-column-heading">
                      <button
                        class="wb-column-menu-button"
                        type="button"
                        :aria-expanded="activeColumnMenu === column.name"
                        @click="toggleColumnMenu(column.name)"
                      >
                        <span class="wb-column-name" :title="column.name">{{ column.name }}</span>
                      </button>
                      <small :title="column.type">{{ column.type }}</small>
                      <div v-if="activeColumnMenu === column.name" class="wb-column-menu">
                        <strong>Operasi untuk {{ column.name }}</strong>
                        <button
                          v-for="operation in columnOperations(column)"
                          :key="operation.id"
                          type="button"
                          @click="chooseOperation(operation, column.name)"
                        >
                          {{ operation.name }}
                        </button>
                        <p v-if="columnOperations(column).length === 0">Tidak ada operasi yang cocok.</p>
                      </div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in previewRows" :key="`${page}-${rowIndex}`">
                  <td v-for="column in visibleColumns" :key="column.name">
                    <span
                      class="wb-cell"
                      :class="{
                        'wb-cell-null': row[column.name] === null,
                        'wb-cell-empty': row[column.name] === '',
                        'wb-cell-changed': isChanged(row, column.name),
                      }"
                      :title="cellTitle(row, column.name)"
                    >
                      {{ displayValue(row[column.name]) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <nav class="wb-pagination" aria-label="Halaman data pratinjau">
            <span>{{ numberFormat(totalRows) }} baris · Halaman {{ page }} dari {{ totalPages }}</span>
            <div>
              <button class="wb-button wb-small" type="button" :disabled="page <= 1 || previewPending" @click="changePage(page - 1)">
                Sebelumnya
              </button>
              <button class="wb-button wb-small" type="button" :disabled="page >= totalPages || previewPending" @click="changePage(page + 1)">
                Berikutnya
              </button>
            </div>
          </nav>
        </template>

        <section v-if="statistics || statisticsError" class="wb-statistics" aria-live="polite">
          <h3>Statistik langkah {{ selectedStep }}</h3>
          <template v-if="statistics">
            <p>{{ numberFormat(statistics.rowsIn) }} baris masuk · {{ numberFormat(statistics.rowsOut) }} baris keluar · {{ numberFormat(statistics.rowsDropped) }} baris dibuang.</p>
            <p v-if="statistics.duplicateGroups !== undefined">
              {{ numberFormat(statistics.duplicateGroups) }} grup duplikat ·
              {{ numberFormat(statistics.discardedRows) }} baris dibuang ·
              {{ numberFormat(statistics.conflictGroups) }} grup memiliki isi yang berbeda.
            </p>
            <div v-for="(columnStats, columnName) in statistics.stats" :key="columnName" class="wb-stat-column">
              <strong>{{ columnName }}</strong>
              <span>Berubah: {{ numberFormat(columnStats.changed) }}</span>
              <span>NULL/kosong sebelum: {{ columnStats.beforeNullOrEmpty === null ? 'Tidak ada pada sumber' : numberFormat(columnStats.beforeNullOrEmpty) }}</span>
              <span>NULL/kosong sesudah: {{ numberFormat(columnStats.afterNullOrEmpty) }}</span>
            </div>
            <p v-if="Object.keys(statistics.stats).length === 0">Tidak ada kolom yang berubah untuk diringkas.</p>
          </template>
          <p v-if="statisticsError" class="wb-error" role="alert">{{ statisticsError }}</p>
        </section>
      </section>

      <section class="kartu wb-operations-card" aria-label="Operasi">
        <div class="wb-card-heading">
          <div>
            <p class="page-kicker">Buat perubahan</p>
            <h2 class="card-title">Operasi</h2>
          </div>
          <button v-if="selectedOperation" class="wb-link-button" type="button" @click="resetOperationForm">
            Kembali
          </button>
        </div>
        <p v-if="operationsPending" class="wb-message" role="status">Memuat daftar operasi...</p>
        <p v-else-if="operationsError" class="wb-message wb-error" role="alert">
          {{ operationsError }} <button class="wb-link-button" type="button" @click="loadOperations">Coba lagi</button>
        </p>
        <template v-else-if="selectedOperation">
          <h3 class="wb-operation-name">{{ selectedOperation.name }}</h3>
          <p v-if="masterColumnsError" class="wb-message wb-error" role="alert">{{ masterColumnsError }}</p>
          <WorkbenchOperationForm
            :key="formKey"
            :operation="selectedOperation"
            :schema="schemaBeforeSelectedStep"
            :master-columns="masterColumns"
            :databases="databases"
            :tables-by-database="tablesByDatabase"
            :initial-params="formInitialParams"
            :editing="editingStepIndex !== null"
            :prefilled-column="prefilledColumn"
            @submit="commitForm"
            @database-change="loadTables"
            @table-change="loadMasterColumns"
          />
        </template>
        <template v-else>
          <p class="wb-message">Pilih operasi untuk mengatur langkah baru.</p>
          <ul class="wb-operation-list">
            <li v-for="operation in operations" :key="operation.id">
              <button type="button" :disabled="!sourceReady" @click="chooseOperation(operation)">
                <strong>{{ operation.name }}</strong>
                <span>{{ operation.description }}</span>
              </button>
            </li>
          </ul>
        </template>
      </section>
    </div>

    <div v-if="showSqlPanel || showSaveDialog" class="wb-backdrop" @click.self="closePanels" />
    <section
      v-if="showSqlPanel"
      class="kartu wb-dialog wb-sql-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wb-sql-title"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <div class="wb-dialog-heading">
        <h2 id="wb-sql-title" class="card-title">SQL pratinjau</h2>
        <button class="wb-icon-button" type="button" @click="showSqlPanel = false">Tutup</button>
      </div>
      <p class="wb-message">Query ini hanya untuk dibaca. Parameter dikirim terpisah.</p>
      <p v-if="sqlPending" class="wb-message" role="status">Memuat SQL...</p>
      <p v-else-if="sqlError" class="wb-message wb-error" role="alert">{{ sqlError }}</p>
      <template v-else-if="sqlResult">
        <pre class="wb-code">{{ sqlResult.sql }}</pre>
        <h3>Parameter</h3>
        <pre class="wb-code">{{ formatJson(sqlResult.params) }}</pre>
        <button class="wb-button" type="button" @click="copySql">
          {{ sqlCopied ? 'Disalin' : 'Salin SQL' }}
        </button>
        <button class="wb-button" type="button" @click="copyParameters">
          {{ parametersCopied ? 'Parameter disalin' : 'Salin parameter' }}
        </button>
        <p v-if="copyError" class="wb-error" role="alert">{{ copyError }}</p>
      </template>
    </section>

    <section
      v-if="showSaveDialog"
      class="kartu wb-dialog wb-save-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wb-save-title"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <div class="wb-dialog-heading">
        <h2 id="wb-save-title" class="card-title">{{ applyResult ? 'Tabel baru berhasil dibuat' : 'Simpan sebagai tabel baru' }}</h2>
        <button v-if="!applying" class="wb-icon-button" type="button" @click="closeSaveDialog">Tutup</button>
      </div>
      <template v-if="applyResult">
        <p class="wb-safety-note">Tabel sumber tetap tidak diubah.</p>
        <dl class="wb-summary">
          <div><dt>Tabel hasil</dt><dd><code>{{ applyResult.database }}.{{ applyResult.table }}</code></dd></div>
          <div><dt>Jumlah baris</dt><dd>{{ numberFormat(applyResult.rows) }}</dd></div>
          <div><dt>Jumlah langkah</dt><dd>{{ numberFormat(applyResult.steps) }}</dd></div>
          <div><dt>Durasi</dt><dd>{{ applyResult.durationMs === undefined ? 'Tidak dikirim API' : `${numberFormat(applyResult.durationMs)} ms` }}</dd></div>
          <div><dt>Verifikasi</dt><dd>{{ applyResult.verification ?? 'Hasil verifikasi tidak dikirim API.' }}</dd></div>
        </dl>
        <button class="wb-button wb-primary" type="button" @click="viewResultTable">Lihat isi tabel hasil</button>
      </template>
      <template v-else>
        <form class="wb-save-form" @submit.prevent="applyPipeline">
          <p class="wb-safety-note">Tabel sumber <code>{{ pipeline.source.database }}.{{ pipeline.source.table }}</code> tidak akan diubah.</p>
          <section class="wb-save-statistics" aria-live="polite">
            <h3>Ringkasan seluruh pipeline</h3>
            <p v-if="pipelineStatisticsPending" class="wb-message" role="status">Menghitung ringkasan sebelum dan sesudah...</p>
            <p v-else-if="pipelineStatisticsError" class="wb-error" role="alert">{{ pipelineStatisticsError }}</p>
            <template v-else-if="pipelineStatistics">
              <p>{{ numberFormat(pipelineStatistics.rowsIn) }} baris masuk · {{ numberFormat(pipelineStatistics.rowsOut) }} baris hasil · {{ numberFormat(pipelineStatistics.rowsDropped) }} baris dibuang</p>
              <p v-if="pipelineStatistics.duplicateGroups !== undefined">
                {{ numberFormat(pipelineStatistics.duplicateGroups) }} grup duplikat ·
                {{ numberFormat(pipelineStatistics.discardedRows) }} baris dibuang ·
                {{ numberFormat(pipelineStatistics.conflictGroups) }} grup memiliki isi yang berbeda.
              </p>
              <div v-for="(columnStats, columnName) in pipelineStatistics.stats" :key="columnName" class="wb-stat-column">
                <strong>{{ columnName }}</strong>
                <span>Berubah: {{ numberFormat(columnStats.changed) }}</span>
                <span>NULL/kosong sebelum: {{ columnStats.beforeNullOrEmpty === null ? 'Tidak tersedia pada sumber' : numberFormat(columnStats.beforeNullOrEmpty) }}</span>
                <span>NULL/kosong sesudah: {{ numberFormat(columnStats.afterNullOrEmpty) }}</span>
              </div>
              <p v-if="Object.keys(pipelineStatistics.stats).length === 0">Tidak ada kolom yang berubah untuk diringkas.</p>
            </template>
          </section>
          <label for="wb-result-name">Nama tabel hasil</label>
          <input id="wb-result-name" v-model="resultTableName" maxlength="64" required :disabled="applying" />
          <p v-if="resultTableName && !validResultName" class="wb-error" role="alert">
            Nama harus diawali huruf dan hanya berisi huruf, angka, atau garis bawah.
          </p>

          <label for="wb-result-engine">Engine</label>
          <select id="wb-result-engine" v-model="resultEngine" :disabled="applying">
            <option value="MergeTree">MergeTree</option>
            <option value="ReplacingMergeTree">ReplacingMergeTree</option>
          </select>

          <fieldset class="wb-order-fields" :disabled="applying">
            <legend>Kolom ORDER BY</legend>
            <p>Pilih satu kolom untuk mengurutkan tabel hasil.</p>
            <label v-for="column in finalSchema" :key="column.name" class="wb-order-option">
              <input
                :checked="orderBy[0] === column.name"
                type="radio"
                name="wb-result-order-by"
                :disabled="isNullable(column.type)"
                @change="selectOrderBy(column.name)"
              />
              <span>{{ column.name }} <small>({{ column.type }})</small></span>
              <small v-if="isNullable(column.type)" class="wb-nullable-note">Kolom Nullable tidak dapat dipilih.</small>
            </label>
          </fieldset>

          <label class="wb-save-original">
            <input v-model="saveOriginal" type="checkbox" :disabled="applying || originalColumnNames.length === 0" />
            <span>
              Simpan nilai sebelum perubahan
              <template v-if="originalColumnNames.length">
                di <code>{{ originalColumnNames.map((column) => `${column}_asli`).join(', ') }}</code>
              </template>
              <template v-else> (tidak ada kolom sumber yang memenuhi syarat)</template>
            </span>
          </label>
          <p class="wb-message">Nilai yang disimpan berasal langsung dari tabel sumber, sebelum langkah pipeline dijalankan.</p>

          <div>
            <h3>Ringkasan langkah</h3>
            <ol class="wb-summary-steps">
              <li v-for="(step, index) in pipeline.steps" :key="step.id">
                {{ index + 1 }}. {{ operationName(step.op) }} — {{ touchedColumns(step).join(', ') || 'Tanpa kolom langsung' }}
              </li>
            </ol>
          </div>
          <div>
            <h3>Kolom hasil</h3>
            <ul class="wb-result-columns">
              <li v-for="column in finalSchema" :key="column.name">{{ column.name }} <small>({{ column.type }})</small></li>
            </ul>
          </div>
          <p v-if="applyError" class="wb-error" role="alert">{{ applyError }}</p>
          <p v-if="applying" class="wb-message" role="status">Sedang membuat tabel baru. Mohon tunggu...</p>
          <div class="wb-dialog-actions">
            <button class="wb-button wb-primary" type="submit" :disabled="!canApply || applying">
              {{ applying ? 'Sedang membuat...' : 'Ya, buat tabel' }}
            </button>
            <button class="wb-button" type="button" :disabled="applying" @click="closeSaveDialog">Batal</button>
          </div>
        </form>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { WorkbenchStep } from '~/composables/useWorkbench'

type Database = { name: string }
type Table = { name: string; engine?: string }
type Column = { name: string; type: string }
type OperationParam = { key: string; label: string; description: string; type: string; required?: boolean; options?: string[] }
type Operation = { id: string; name: string; description: string; params: OperationParam[] }
type StepState = { status: 'valid' | 'error' | 'loading'; schema?: Column[]; message?: string; warnings?: string[] }
type PreviewRow = Record<string, unknown>
type PreviewResponse = { columns: string[]; rows: PreviewRow[]; totalRows: number; page: number; limit: number; warnings?: string[] }
type SchemaResponse = { valid: boolean; schema?: Column[]; error?: string; steps?: Array<{ index: number; valid: boolean; schema?: Column[]; error?: string; warnings?: string[] }> }
type StatisticsResponse = {
  scope: 'step' | 'pipeline'
  step?: number
  rowsIn: number
  rowsOut: number
  totalRows: number
  stats: Record<string, {
    changed: number
    beforeNullOrEmpty: number | null
    afterNullOrEmpty: number
  }>
  rowsDropped: number
  duplicateGroups?: number
  discardedRows?: number
  conflictGroups?: number
  [key: string]: unknown
}
type SqlResponse = { sql: string; params: Record<string, unknown>; schema: Column[]; warnings?: string[] }
type ApplyResponse = {
  status: string
  database: string
  table: string
  rows: number
  steps: number
  durationMs?: number
  verification?: string
}

const workbench = useWorkbench()
const { pipeline, selectedStep, page, limit, persistenceError } = workbench
const selectedSource = useSelectedSource()
const databases = ref<Database[]>([])
const tables = ref<Table[]>([])
const tablesByDatabase = reactive<Record<string, Table[]>>({})
const operations = ref<Operation[]>([])
const sourceColumns = ref<Column[]>([])
const stepStates = ref<StepState[]>([])
const databasesPending = ref(false)
const tablesPending = ref(false)
const operationsPending = ref(false)
const databasesError = ref('')
const tablesError = ref('')
const operationsError = ref('')
const masterColumnsError = ref('')
const previewPending = ref(false)
const previewError = ref('')
const previewRows = ref<PreviewRow[]>([])
const previewWarnings = ref<string[]>([])
const totalRows = ref(0)
const statistics = ref<StatisticsResponse | null>(null)
const statisticsError = ref('')
const pipelineStatistics = ref<StatisticsResponse | null>(null)
const pipelineStatisticsError = ref('')
const pipelineStatisticsPending = ref(false)
const sqlPending = ref(false)
const sqlError = ref('')
const sqlResult = ref<SqlResponse | null>(null)
const sqlCopied = ref(false)
const parametersCopied = ref(false)
const copyError = ref('')
const selectedOperationId = ref('')
const formInitialParams = ref<Record<string, unknown>>({})
const editingStepIndex = ref<number | null>(null)
const insertAtIndex = ref<number | null>(null)
const prefilledColumn = ref('')
const formKey = ref(0)
const activeColumnMenu = ref('')
const showSqlPanel = ref(false)
const showSaveDialog = ref(false)
const resultTableName = ref('')
const resultEngine = ref('MergeTree')
const orderBy = ref<string[]>([])
const saveOriginal = ref(false)
const applying = ref(false)
const applyError = ref('')
const applyResult = ref<ApplyResponse | null>(null)
const masterColumns = ref<Column[]>([])

let previewController: AbortController | null = null
let previewRequest = 0
let schemaRequest = 0
let statisticsRequest = 0
let pipelineStatisticsRequest = 0
let masterColumnsRequest = 0
let returnFocusElement: HTMLElement | null = null

const sourceReady = computed(() => Boolean(pipeline.value.source.database && pipeline.value.source.table))
const selectedOperation = computed(() => operations.value.find(({ id }) => id === selectedOperationId.value) ?? null)
const visibleColumns = computed(() => {
  const schema = selectedStep.value === 0
    ? sourceColumns.value
    : stepStates.value[selectedStep.value - 1]?.schema ?? []
  return schema.filter(({ name }) => !name.startsWith('__sebelum_'))
})
const finalSchema = computed(() => pipeline.value.steps.length
  ? stepStates.value[pipeline.value.steps.length - 1]?.schema ?? []
  : sourceColumns.value)
const schemaBeforeSelectedStep = computed(() => selectedStep.value > 0
  ? editingStepIndex.value !== null
    ? stepStates.value[editingStepIndex.value - 1]?.schema ?? sourceColumns.value
    : insertAtIndex.value !== null
      ? insertAtIndex.value > 0
        ? stepStates.value[insertAtIndex.value - 1]?.schema ?? sourceColumns.value
        : sourceColumns.value
      : finalSchema.value
  : editingStepIndex.value !== null
    ? sourceColumns.value
    : insertAtIndex.value !== null
      ? insertAtIndex.value > 0
        ? stepStates.value[insertAtIndex.value - 1]?.schema ?? sourceColumns.value
        : sourceColumns.value
      : finalSchema.value)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / limit.value)))
const validResultName = computed(() => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(resultTableName.value))
const originalColumnNames = computed(() => [...new Set(
  pipeline.value.steps
    .filter((step) => step.op !== 'add_column')
    .flatMap((step) => touchedColumns(step)),
) ].filter((name) => sourceColumns.value.some((column) => column.name === name)))
const canApply = computed(() => sourceReady.value
  && pipeline.value.steps.length > 0
  && validResultName.value
  && !applying.value
  && stepStates.value.length === pipeline.value.steps.length
  && stepStates.value.every(({ status }) => status === 'valid'))
const canOpenSave = computed(() => sourceReady.value
  && pipeline.value.steps.length > 0
  && stepStates.value.length === pipeline.value.steps.length
  && stepStates.value.every(({ status }) => status === 'valid'))

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object'
      && 'message' in error.data && typeof error.data.message === 'string') return error.data.message
    if ('message' in error && typeof error.message === 'string') return error.message
  }
  return fallback
}

function numberFormat(value: number): string {
  return new Intl.NumberFormat('id-ID').format(Number(value) || 0)
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '{}'
}

function displayValue(value: unknown): string {
  if (value === null) return 'NULL'
  if (value === '') return '(string kosong)'
  if (typeof value === 'string' && /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    return JSON.stringify(value)
  }
  if (typeof value === 'object') return JSON.stringify(value) ?? String(value)
  return String(value)
}

function isChanged(row: PreviewRow, column: string): boolean {
  const previousKey = `__sebelum_${column}`
  if (!(previousKey in row)) return false
  return JSON.stringify(row[column]) !== JSON.stringify(row[previousKey])
}

function cellTitle(row: PreviewRow, column: string): string {
  const current = displayValue(row[column])
  if (isChanged(row, column)) return `Nilai sebelumnya: ${displayValue(row[`__sebelum_${column}`])} · Nilai sekarang: ${current}`
  return current
}

function operationName(id: string): string {
  return operations.value.find((operation) => operation.id === id)?.name ?? id
}

function touchedColumns(step: WorkbenchStep): string[] {
  if (step.op === 'add_column') {
    return typeof step.params.name === 'string' && step.params.name ? [step.params.name] : []
  }
  if (step.op === 'fill_from_master') {
    return typeof step.params.targetColumn === 'string' && step.params.targetColumn
      ? [step.params.targetColumn]
      : []
  }
  const values = Object.entries(step.params)
    .filter(([key, value]) => /column/i.test(key) && typeof value === 'string' && value)
    .map(([, value]) => String(value))
  return [...new Set(values)]
}

function stepStatusLabel(status?: StepState['status']): string {
  if (status === 'valid') return 'Valid'
  if (status === 'error') return 'Kesalahan'
  return 'Sedang dihitung'
}

function isNullable(type: string): boolean {
  return /Nullable\s*\(/.test(type)
}

async function loadDatabases(): Promise<void> {
  databasesPending.value = true
  databasesError.value = ''
  try {
    const response = await $fetch<{ data: Database[] }>('/api/databases')
    databases.value = response.data
  } catch (error) {
    databasesError.value = getErrorMessage(error, 'Daftar database tidak dapat dimuat.')
  } finally {
    databasesPending.value = false
  }
}

async function loadTables(database: string): Promise<void> {
  if (!database) return
  const isSourceDatabase = database === pipeline.value.source.database
  if (isSourceDatabase) {
    tablesPending.value = true
    tablesError.value = ''
    tables.value = []
  }
  try {
    const response = await $fetch<{ data: Table[] }>('/api/tables', { query: { database } })
    tablesByDatabase[database] = response.data
    if (pipeline.value.source.database === database) tables.value = response.data
  } catch (error) {
    if (isSourceDatabase) tablesError.value = getErrorMessage(error, 'Daftar tabel tidak dapat dimuat.')
  } finally {
    if (isSourceDatabase) tablesPending.value = false
  }
}

async function loadSourceColumns(database: string, table: string): Promise<void> {
  sourceColumns.value = []
  if (!database || !table) return
  try {
    const response = await $fetch<{ data: Column[] }>('/api/columns', { query: { database, table } })
    if (pipeline.value.source.database === database && pipeline.value.source.table === table) {
      sourceColumns.value = response.data
    }
  } catch (error) {
    previewError.value = getErrorMessage(error, 'Skema tabel sumber tidak dapat dimuat.')
  }
}

async function loadMasterColumns(database: string, table: string): Promise<void> {
  const request = ++masterColumnsRequest
  masterColumns.value = []
  masterColumnsError.value = ''
  if (!database || !table) return
  try {
    const response = await $fetch<{ data: Column[] }>('/api/columns', { query: { database, table } })
    if (request === masterColumnsRequest) masterColumns.value = response.data
  } catch (error) {
    if (request === masterColumnsRequest) {
      masterColumnsError.value = getErrorMessage(error, 'Kolom tabel master tidak dapat dimuat.')
    }
  }
}

async function loadOperations(): Promise<void> {
  operationsPending.value = true
  operationsError.value = ''
  try {
    const response = await $fetch<{ data: Operation[] }>('/api/workbench/ops')
    operations.value = response.data
  } catch (error) {
    operationsError.value = getErrorMessage(error, 'Daftar operasi tidak dapat dimuat.')
  } finally {
    operationsPending.value = false
  }
}

function changeDatabase(event: Event): void {
  const database = (event.target as HTMLSelectElement).value
  workbench.setSource(database, '')
  tables.value = []
  sourceColumns.value = []
  if (database) void loadTables(database)
}

function changeTable(event: Event): void {
  const table = (event.target as HTMLSelectElement).value
  workbench.setSource(pipeline.value.source.database, table)
  void loadSourceColumns(pipeline.value.source.database, table)
}

function selectStep(index: number): void {
  selectedStep.value = index
  page.value = 1
  statistics.value = null
  activeColumnMenu.value = ''
  resetOperationForm()
}

function showOperations(): void {
  selectedOperationId.value = ''
  editingStepIndex.value = null
  insertAtIndex.value = pipeline.value.steps.length
  selectedStep.value = pipeline.value.steps.length
  formInitialParams.value = {}
}

function resetOperationForm(): void {
  selectedOperationId.value = ''
  formInitialParams.value = {}
  editingStepIndex.value = null
  insertAtIndex.value = null
  prefilledColumn.value = ''
  formKey.value += 1
}

function chooseOperation(operation: Operation, column = ''): void {
  selectedOperationId.value = operation.id
  editingStepIndex.value = null
  insertAtIndex.value = selectedStep.value
  formInitialParams.value = {}
  prefilledColumn.value = column
  formKey.value += 1
  activeColumnMenu.value = ''
}

function editStep(index: number): void {
  const step = pipeline.value.steps[index]
  const operation = operations.value.find(({ id }) => id === step.op)
  if (!operation) return
  selectedStep.value = index + 1
  selectedOperationId.value = operation.id
  editingStepIndex.value = index
  insertAtIndex.value = null
  formInitialParams.value = JSON.parse(JSON.stringify(step.params))
  const masterDatabase = String(step.params.masterDatabase ?? '')
  const masterTable = String(step.params.masterTable ?? '')
  if (masterDatabase) void loadTables(masterDatabase)
  if (masterDatabase && masterTable) void loadMasterColumns(masterDatabase, masterTable)
  prefilledColumn.value = ''
  formKey.value += 1
}

function commitForm(params: Record<string, unknown>): void {
  if (!selectedOperation.value) return
  const changed: WorkbenchStep = {
    id: editingStepIndex.value === null
      ? `step-${Date.now()}-${Math.random().toString(36).slice(2)}`
      : pipeline.value.steps[editingStepIndex.value].id,
    op: selectedOperation.value.id,
    params,
  }
  if (editingStepIndex.value === null) {
    const insertionIndex = Math.max(0, Math.min(insertAtIndex.value ?? pipeline.value.steps.length, pipeline.value.steps.length))
    pipeline.value.steps.splice(insertionIndex, 0, changed)
    selectedStep.value = insertionIndex + 1
  } else {
    pipeline.value.steps.splice(editingStepIndex.value, 1, changed)
    selectedStep.value = editingStepIndex.value + 1
  }
  page.value = 1
  statistics.value = null
  resetOperationForm()
  workbench.savePipeline()
}

function moveStep(index: number, offset: number): void {
  const target = index + offset
  if (target < 0 || target >= pipeline.value.steps.length) return
  const selectedId = selectedStep.value > 0 ? pipeline.value.steps[selectedStep.value - 1]?.id : ''
  const [step] = pipeline.value.steps.splice(index, 1)
  pipeline.value.steps.splice(target, 0, step)
  const selectedIndex = pipeline.value.steps.findIndex(({ id }) => id === selectedId)
  if (selectedIndex >= 0) selectedStep.value = selectedIndex + 1
  page.value = 1
  statistics.value = null
  workbench.savePipeline()
}

function deleteStep(index: number): void {
  pipeline.value.steps.splice(index, 1)
  if (selectedStep.value > pipeline.value.steps.length) selectedStep.value = pipeline.value.steps.length
  else if (selectedStep.value === index + 1) selectedStep.value = Math.max(0, index)
  page.value = 1
  statistics.value = null
  resetOperationForm()
  workbench.savePipeline()
}

function changePage(nextPage: number): void {
  if (nextPage < 1 || nextPage > totalPages.value || previewPending.value) return
  page.value = nextPage
}

function changeLimit(event: Event): void {
  const nextLimit = Number((event.target as HTMLSelectElement).value)
  if (![25, 50, 100].includes(nextLimit)) return
  limit.value = nextLimit
  page.value = 1
}

async function refreshStepSchemas(): Promise<void> {
  const request = ++schemaRequest
  const source = pipeline.value.source
  const steps = pipeline.value.steps
  if (!source.database || !source.table) {
    stepStates.value = []
    return
  }
  const statuses: StepState[] = []
  for (let index = 0; index < steps.length; index += 1) {
    if (request !== schemaRequest) return
    stepStates.value = [...statuses, ...steps.slice(index).map(() => ({ status: 'loading' as const }))]
    try {
      const response = await $fetch<SchemaResponse>('/api/workbench/schema', {
        method: 'POST',
        body: { source, steps: steps.slice(0, index + 1) },
      })
      if (request !== schemaRequest) return
      if (!response.valid) {
        const message = response.error || 'Skema langkah tidak valid.'
        statuses.push({ status: 'error', message })
        for (let rest = index + 1; rest < steps.length; rest += 1) {
          statuses.push({ status: 'error', message })
        }
        break
      }
      statuses.push({
        status: 'valid',
        schema: response.schema ?? [],
        warnings: response.steps?.[index]?.warnings?.map((warning) => `Langkah ${index + 1}: ${warning}`) ?? [],
      })
    } catch (error) {
      if (request !== schemaRequest) return
      const message = getErrorMessage(error, 'Skema langkah tidak dapat diperiksa.')
      statuses.push({ status: 'error', message })
      for (let rest = index + 1; rest < steps.length; rest += 1) {
        statuses.push({ status: 'error', message })
      }
      break
    }
  }
  if (request === schemaRequest) stepStates.value = statuses
}

async function loadPreview(): Promise<void> {
  const request = ++previewRequest
  previewController?.abort()
  previewController = null
  if (!sourceReady.value) {
    previewRows.value = []
    previewWarnings.value = []
    totalRows.value = 0
    previewError.value = ''
    previewPending.value = false
    return
  }
  const controller = new AbortController()
  previewController = controller
  previewPending.value = true
  previewError.value = ''
  previewRows.value = []
  previewWarnings.value = []
  const steps = pipeline.value.steps.slice(0, selectedStep.value)
  try {
    const response = await $fetch<PreviewResponse>('/api/workbench/preview', {
      method: 'POST',
      body: { source: pipeline.value.source, steps, page: page.value, limit: limit.value },
      signal: controller.signal,
    })
    if (request !== previewRequest) return
    previewRows.value = response.rows
    previewWarnings.value = response.warnings ?? []
    totalRows.value = Number(response.totalRows)
    page.value = response.page
  } catch (error) {
    if (request !== previewRequest || controller.signal.aborted) return
    previewError.value = getErrorMessage(error, 'Pratinjau tidak dapat dimuat.')
  } finally {
    if (request === previewRequest) previewPending.value = false
  }
}

async function loadStatistics(): Promise<void> {
  if (selectedStep.value < 1) return
  const request = ++statisticsRequest
  statistics.value = null
  statisticsError.value = ''
  try {
    const response = await $fetch<StatisticsResponse>('/api/workbench/stats', {
      method: 'POST',
      body: {
        source: pipeline.value.source,
        steps: pipeline.value.steps.slice(0, selectedStep.value),
        step: selectedStep.value,
        scope: 'step',
      },
    })
    if (request === statisticsRequest) statistics.value = response
  } catch (error) {
    if (request === statisticsRequest) statisticsError.value = getErrorMessage(error, 'Statistik tidak dapat dihitung.')
  }
}

async function openSql(): Promise<void> {
  showSqlPanel.value = true
  sqlResult.value = null
  sqlError.value = ''
  sqlPending.value = true
  try {
    sqlResult.value = await $fetch<SqlResponse>('/api/workbench/sql', {
      method: 'POST',
      body: { source: pipeline.value.source, steps: pipeline.value.steps.slice(0, selectedStep.value) },
    })
  } catch (error) {
    sqlError.value = getErrorMessage(error, 'SQL tidak dapat dimuat.')
  } finally {
    sqlPending.value = false
  }
}

async function copySql(): Promise<void> {
  if (!sqlResult.value) return
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(sqlResult.value.sql)
    sqlCopied.value = true
    window.setTimeout(() => { sqlCopied.value = false }, 1800)
  } catch (error) {
    copyError.value = getErrorMessage(error, 'SQL tidak dapat disalin dari peramban ini.')
  }
}

async function copyParameters(): Promise<void> {
  if (!sqlResult.value) return
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(formatJson(sqlResult.value.params))
    parametersCopied.value = true
    window.setTimeout(() => { parametersCopied.value = false }, 1800)
  } catch (error) {
    copyError.value = getErrorMessage(error, 'Parameter tidak dapat disalin dari peramban ini.')
  }
}

function operationMatchesColumn(operation: Operation, column: Column): boolean {
  const columnParams = operation.params.filter(({ type }) => type === 'column')
  if (!columnParams.length) return false
  return columnParams.some((parameter) => {
    const textOnly = `${parameter.label} ${parameter.description}`.toLowerCase().includes('teks')
      || operation.id === 'trim_text'
      || operation.id === 'replace_values'
      || (operation.id === 'fill_from_master' && /Column$/.test(parameter.key))
    return !textOnly || isTextColumn(column)
  })
}

function columnOperations(column: Column): Operation[] {
  return operations.value.filter((operation) => operationMatchesColumn(operation, column))
}

function toggleColumnMenu(column: string): void {
  activeColumnMenu.value = activeColumnMenu.value === column ? '' : column
}

function isTextColumn(column: Column): boolean {
  const type = column.type.replace(/Nullable\s*\(/g, '').replace(/LowCardinality\s*\(/g, '')
  return /^\s*String\s*\)*\s*$/.test(type)
}

function openSaveDialog(): void {
  const sourceName = pipeline.value.source.table
  resultTableName.value = `${sourceName}_cleaned`.slice(0, 64)
  resultEngine.value = 'MergeTree'
  orderBy.value = []
  saveOriginal.value = false
  applyError.value = ''
  applyResult.value = null
  pipelineStatistics.value = null
  pipelineStatisticsError.value = ''
  showSaveDialog.value = true
  void loadPipelineStatistics()
}

async function loadPipelineStatistics(): Promise<void> {
  const request = ++pipelineStatisticsRequest
  pipelineStatisticsPending.value = true
  pipelineStatistics.value = null
  pipelineStatisticsError.value = ''
  try {
    const response = await $fetch<StatisticsResponse>('/api/workbench/stats', {
      method: 'POST',
      body: {
        source: pipeline.value.source,
        steps: pipeline.value.steps,
        scope: 'pipeline',
      },
    })
    if (request === pipelineStatisticsRequest) pipelineStatistics.value = response
  } catch (error) {
    if (request === pipelineStatisticsRequest) {
      pipelineStatisticsError.value = getErrorMessage(error, 'Ringkasan pipeline tidak dapat dihitung.')
    }
  } finally {
    if (request === pipelineStatisticsRequest) pipelineStatisticsPending.value = false
  }
}

function selectOrderBy(column: string): void {
  orderBy.value = [column]
}

async function applyPipeline(): Promise<void> {
  if (!canApply.value) return
  applying.value = true
  applyError.value = ''
  try {
    const response = await $fetch<ApplyResponse>('/api/workbench/apply', {
      method: 'POST',
      body: {
        source: pipeline.value.source,
        steps: pipeline.value.steps,
        resultTableName: resultTableName.value,
        engine: resultEngine.value,
        orderBy: orderBy.value,
        saveOriginal: saveOriginal.value,
      },
    })
    applyResult.value = response
  } catch (error) {
    applyError.value = getErrorMessage(error, 'Tabel hasil tidak dapat dibuat.')
  } finally {
    applying.value = false
  }
}

async function viewResultTable(): Promise<void> {
  if (!applyResult.value) return
  selectedSource.setDatabase(applyResult.value.database)
  selectedSource.setTable(applyResult.value.table)
  await navigateTo('/sumber-data')
}

function closePanels(): void {
  if (!applying.value) {
    showSqlPanel.value = false
    closeSaveDialog()
  }
}

function closeSaveDialog(): void {
  if (applying.value) return
  showSaveDialog.value = false
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closePanels()
    return
  }
  if (event.key !== 'Tab') return
  const dialog = event.currentTarget as HTMLElement
  const focusable = [...dialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getAttribute('aria-hidden') !== 'true')
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
    event.preventDefault()
    first.focus()
  }
}

watch([showSqlPanel, showSaveDialog], async ([sqlOpen, saveOpen], [wasSqlOpen, wasSaveOpen]) => {
  if (sqlOpen || saveOpen) {
    if (!wasSqlOpen && !wasSaveOpen) {
      returnFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    await nextTick()
    const dialog = document.querySelector<HTMLElement>(saveOpen ? '.wb-save-dialog' : '.wb-sql-dialog')
    const initialFocus = dialog?.querySelector<HTMLElement>('button:not(:disabled)')
    ;(initialFocus ?? dialog)?.focus()
  } else if (wasSqlOpen || wasSaveOpen) {
    returnFocusElement?.focus()
    returnFocusElement = null
  }
})

watch(
  () => `${pipeline.value.source.database}\u0000${pipeline.value.source.table}\u0000${JSON.stringify(pipeline.value.steps)}`,
  () => {
    page.value = 1
    statistics.value = null
    workbench.savePipeline()
    void refreshStepSchemas()
    if (pipeline.value.source.database && pipeline.value.source.table) {
      void loadSourceColumns(pipeline.value.source.database, pipeline.value.source.table)
    }
    void loadPreview()
  },
)

watch([selectedStep, page, limit], () => {
  statistics.value = null
  void loadPreview()
})

watch(
  () => pipeline.value.source.database,
  (database) => {
    if (database) void loadTables(database)
    else tables.value = []
  },
)

onMounted(async () => {
  workbench.initialize()
  await Promise.all([loadDatabases(), loadOperations()])
  if (pipeline.value.source.database) await loadTables(pipeline.value.source.database)
  if (pipeline.value.source.database && pipeline.value.source.table) {
    await loadSourceColumns(pipeline.value.source.database, pipeline.value.source.table)
    void refreshStepSchemas()
    void loadPreview()
  }
})
</script>

<style scoped>
.workbench-page {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.workbench-page > *,
.wb-grid > * {
  min-width: 0;
}

.wb-source {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr) auto;
  align-items: end;
  gap: 12px;
}

.wb-source-title {
  grid-column: 1 / -1;
}

.wb-source-title .card-title {
  margin: 0;
}

.wb-source-title p {
  margin: 4px 0 0;
  color: var(--warna-redup);
  font-size: 13px;
}

.wb-source-field {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.wb-source-field label,
.wb-save-form > label {
  color: #40566d;
  font-size: 13px;
  font-weight: 650;
}

.wb-source select,
.wb-save-form > input,
.wb-save-form > select {
  width: 100%;
  min-width: 0;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
}

.wb-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(220px, 0.9fr) minmax(0, 2fr) minmax(250px, 1fr);
  align-items: start;
  gap: 16px;
}

.wb-steps-card,
.wb-data-card,
.wb-operations-card {
  min-width: 0;
  margin: 0;
}

.wb-card-heading,
.wb-data-actions,
.wb-pagination,
.wb-pagination > div,
.wb-dialog-heading,
.wb-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.wb-card-heading {
  margin-bottom: 14px;
}

.wb-card-heading .page-kicker,
.wb-data-title .page-kicker {
  margin-bottom: 3px;
}

.wb-card-heading .card-title,
.wb-data-title .card-title {
  margin: 0;
}

.wb-button,
.wb-icon-button,
.wb-link-button,
.wb-sql-link {
  min-height: 38px;
  padding: 7px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: #375875;
  background: #fff;
  font: inherit;
  cursor: pointer;
}

.wb-button:disabled,
.wb-icon-button:disabled,
.wb-link-button:disabled,
.wb-sql-link:disabled {
  color: #8998a8;
  background: #f5f8fa;
  cursor: not-allowed;
}

.wb-small {
  min-height: 34px;
  padding: 5px 8px;
  font-size: 12px;
}

.wb-primary {
  border-color: var(--warna-utama);
  color: #fff;
  background: var(--warna-utama);
  font-weight: 700;
}

.wb-save-open {
  min-height: 42px;
  white-space: normal;
}

.wb-message,
.wb-inline-status {
  margin: 8px 0;
  color: var(--warna-redup);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.wb-error,
.wb-danger-text {
  color: #963c35;
}

.wb-warning {
  margin: 0;
  padding: 9px;
  border: 1px solid #ecdca4;
  border-radius: 8px;
  color: #74591c;
  background: #fff9e6;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.wb-link-button {
  min-height: 0;
  padding: 0;
  border: 0;
  color: var(--warna-utama);
  background: transparent;
  font-size: 13px;
}

.wb-step-list {
  display: grid;
  gap: 9px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.wb-step-row {
  min-width: 0;
}

.wb-step {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  color: var(--warna-teks);
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.wb-step-selected {
  border-color: var(--warna-utama);
  box-shadow: 0 0 0 2px rgb(87 152 215 / 12%);
}

.wb-step-number {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 50%;
  color: #375875;
  background: var(--warna-biru-muda);
  font-size: 12px;
  font-weight: 750;
}

.wb-step-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.wb-step-copy strong,
.wb-step-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-step-copy strong {
  font-size: 12px;
}

.wb-step-copy small {
  color: var(--warna-redup);
  font-size: 11px;
}

.wb-status {
  padding: 3px 6px;
  border: 1px solid var(--warna-garis);
  border-radius: 999px;
  color: #5a6c7d;
  font-size: 10px;
  white-space: nowrap;
}

.wb-status-valid {
  border-color: #c9dec1;
  color: #315d27;
  background: #edf5e9;
}

.wb-status-error {
  border-color: #f0c8c4;
  color: #8a352e;
  background: #fdf0ee;
}

.wb-status-loading {
  color: #526479;
  background: #f2f5f8;
}

.wb-step-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 6px 0 0 35px;
}

.wb-icon-button {
  min-height: 30px;
  padding: 4px 7px;
  font-size: 11px;
}

.wb-step-error {
  margin: 7px 0 0 35px;
  color: #963c35;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.wb-sql-link {
  width: 100%;
  margin-top: 15px;
  color: var(--warna-utama);
  font-size: 13px;
  font-weight: 650;
}

.wb-data-card {
  overflow: hidden;
}

.wb-data-heading {
  flex-wrap: wrap;
}

.wb-limit-field {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-limit-field select {
  min-height: 36px;
  padding: 5px 8px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  background: #fff;
  font: inherit;
}

.wb-data-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.wb-inline-status {
  margin: 0;
}

.wb-table-viewport {
  width: 100%;
  max-width: 100%;
  max-height: 560px;
  overflow: auto;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  overscroll-behavior: contain;
}

.wb-table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}

.wb-table th,
.wb-table td {
  max-width: 280px;
  min-width: 130px;
  padding: 9px 10px;
  border-right: 1px solid #e8eff5;
  border-bottom: 1px solid #e8eff5;
  text-align: left;
  vertical-align: top;
}

.wb-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: #526479;
  background: #f5f8fa;
  font-weight: 650;
}

.wb-table th:last-child,
.wb-table td:last-child {
  border-right: 0;
}

.wb-column-heading {
  position: relative;
  display: grid;
  gap: 4px;
}

.wb-column-menu-button {
  max-width: 100%;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.wb-column-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-column-heading > small {
  display: block;
  max-width: 220px;
  overflow: hidden;
  color: #8190a0;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-column-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 4;
  display: grid;
  min-width: 190px;
  max-width: min(260px, 80vw);
  gap: 5px;
  padding: 9px;
  border: 1px solid var(--warna-garis);
  border-radius: 9px;
  background: #fff;
  box-shadow: var(--bayangan-kartu);
}

.wb-column-menu strong,
.wb-column-menu button,
.wb-column-menu p {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 11px;
}

.wb-column-menu button {
  padding: 6px;
  border: 0;
  border-radius: 6px;
  color: #375875;
  background: #f5f8fa;
  text-align: left;
  cursor: pointer;
}

.wb-cell {
  display: block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-cell-null {
  color: #9c3e36;
  font-style: italic;
}

.wb-cell-empty {
  color: #718196;
  font-style: italic;
}

.wb-cell-changed {
  padding: 1px 4px;
  border-radius: 4px;
  outline: 1px solid #e3c85b;
  background: #fff4bf;
}

.wb-pagination {
  flex-wrap: wrap;
  margin-top: 12px;
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-pagination > div {
  flex-wrap: wrap;
}

.wb-statistics {
  display: grid;
  gap: 8px;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  background: #f8fafc;
}

.wb-statistics h3,
.wb-statistics p {
  margin: 0;
}

.wb-statistics h3 {
  font-size: 14px;
}

.wb-statistics p,
.wb-stat-column span {
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-stat-column {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding-top: 8px;
  border-top: 1px solid #e3ebf2;
}

.wb-stat-column strong {
  width: 100%;
  font-size: 12px;
}

.wb-operation-list {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.wb-operation-list button {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 9px;
  color: var(--warna-teks);
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.wb-operation-list button:disabled {
  cursor: not-allowed;
}

.wb-operation-list strong {
  font-size: 13px;
}

.wb-operation-list span {
  color: var(--warna-redup);
  font-size: 11px;
}

.wb-operation-name {
  margin: 0 0 12px;
  color: #263a4e;
  font-size: 15px;
}

.wb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 8;
  background: rgb(21 38 55 / 38%);
}

.wb-dialog {
  position: fixed;
  inset: 50% auto auto 50%;
  z-index: 9;
  width: min(680px, calc(100vw - 32px));
  max-height: min(88vh, 900px);
  overflow: auto;
  transform: translate(-50%, -50%);
}

.wb-dialog-heading .card-title {
  margin: 0;
}

.wb-sql-dialog h3,
.wb-save-form h3 {
  margin: 16px 0 7px;
  color: #30455b;
  font-size: 14px;
}

.wb-code {
  max-height: 300px;
  overflow: auto;
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  background: #f7fafc;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.wb-save-form {
  display: grid;
  gap: 10px;
}

.wb-safety-note {
  margin: 0;
  padding: 10px;
  border: 1px solid #d5e5c4;
  border-radius: 8px;
  color: #426132;
  background: #f1f7e9;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.wb-order-fields {
  display: grid;
  gap: 8px;
  margin: 4px 0;
  padding: 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 9px;
}

.wb-order-fields legend {
  padding: 0 5px;
  color: #40566d;
  font-size: 13px;
  font-weight: 700;
}

.wb-order-fields > p {
  margin: 0;
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-order-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 6px;
  color: #526479;
  font-size: 12px;
}

.wb-order-option input,
.wb-save-original input {
  width: 16px;
  min-height: 16px;
  margin: 3px 0 0;
}

.wb-order-option > span {
  overflow-wrap: anywhere;
}

.wb-nullable-note {
  grid-column: 2;
  color: #8a6a22;
}

.wb-save-original {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #40566d;
  font-size: 13px;
}

.wb-summary {
  display: grid;
  gap: 9px;
  margin: 14px 0;
}

.wb-summary > div {
  display: grid;
  grid-template-columns: minmax(110px, 0.7fr) minmax(0, 1.3fr);
  gap: 8px;
}

.wb-summary dt {
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-summary dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.wb-summary-steps,
.wb-result-columns {
  display: grid;
  gap: 5px;
  margin: 0;
  padding-left: 20px;
  color: #526479;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.wb-result-columns {
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  padding: 0;
  list-style: none;
}

.wb-dialog-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-top: 6px;
}

@media (max-width: 1100px) {
  .wb-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .wb-operations-card {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .wb-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .wb-operations-card {
    grid-column: auto;
  }

  .wb-source {
    grid-template-columns: minmax(0, 1fr);
  }

  .wb-source-title {
    grid-column: 1;
  }

  .wb-save-open {
    width: 100%;
  }

  .wb-dialog {
    width: calc(100vw - 24px);
    max-height: 90vh;
    padding: 16px;
  }

  .wb-table th,
  .wb-table td {
    max-width: 220px;
    min-width: 120px;
  }
}

@media (max-width: 420px) {
  .wb-card-heading,
  .wb-data-heading,
  .wb-pagination,
  .wb-dialog-heading {
    align-items: flex-start;
  }

  .wb-step {
    grid-template-columns: 26px minmax(0, 1fr);
  }

  .wb-status {
    grid-column: 2;
    justify-self: start;
  }

  .wb-summary > div {
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .wb-pagination {
    flex-direction: column;
  }
}
</style>
