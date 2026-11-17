<template>
  <Teleport to="body">
    <div v-if="open" class="export-backdrop" @click.self="handleClose" />
    <section
      v-if="open"
      ref="dialogRef"
      class="kartu export-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-dialog-title"
      tabindex="-1"
      @keydown="handleKeydown"
    >
      <div class="export-dialog-heading">
        <div>
          <p class="page-kicker">Ekspor data</p>
          <h2 id="export-dialog-title" class="card-title">Ekspor tabel</h2>
          <p v-if="database && table" class="export-target-label">
            <code>{{ database }}.{{ table }}</code>
            <template v-if="info">
              · <strong>{{ formatNumber(info.rowCount) }}</strong> baris · {{ formatNumber(info.columns.length) }} kolom
            </template>
          </p>
        </div>
        <button type="button" class="export-close-btn" @click="handleClose">Tutup</button>
      </div>

      <p v-if="infoPending" class="export-message" role="status">Memuat informasi tabel dari ClickHouse...</p>
      <div v-else-if="infoError" class="export-error-box" role="alert">
        <p>{{ infoError }}</p>
        <button type="button" class="export-secondary-btn" @click="loadInfo">Coba lagi</button>
      </div>

      <template v-else-if="info">
        <div v-if="info.rowCount > 1_000_000" class="export-warning-box" role="status">
          <strong>Perhatian ukuran data:</strong> Tabel ini memiliki {{ formatNumber(info.rowCount) }} baris.
          Unduhan penuh dialirkan bertahap tetapi dapat memakan waktu lama; gunakan batas jumlah baris jika hanya memerlukan contoh data.
        </div>

        <p v-if="info.columns.length === 0" class="export-error-box" role="alert">
          Tabel ini belum memiliki kolom yang dapat diekspor.
        </p>

        <form v-else class="export-form" @submit.prevent="triggerDownload">
          <div class="export-section">
            <span class="export-label">Format berkas</span>
            <div class="export-format-tabs" role="radiogroup" aria-label="Format ekspor">
              <button
                type="button"
                role="radio"
                class="export-format-btn"
                :class="{ 'export-format-btn--active': format === 'csv' }"
                :aria-checked="format === 'csv'"
                @click="switchFormat('csv')"
              >
                CSV (.csv)
              </button>
              <button
                type="button"
                role="radio"
                class="export-format-btn"
                :class="{ 'export-format-btn--active': format === 'sql' }"
                :aria-checked="format === 'sql'"
                @click="switchFormat('sql')"
              >
                SQL INSERT (.sql)
              </button>
            </div>
          </div>

          <div class="export-two-cols">
            <label class="export-field" for="export-limit">
              <span>Batas baris (opsional)</span>
              <input
                id="export-limit"
                v-model="limitText"
                type="number"
                min="1"
                step="1"
                placeholder="Semua baris"
              />
              <small v-if="limitText.trim() && !info.orderGuaranteed" class="export-hint">
                Tabel tanpa sorting key; contoh baris mungkin tidak berurutan tetap.
              </small>
              <small v-else-if="limitText.trim()" class="export-hint">
                Diurutkan dengan sorting key tabel agar contoh deterministik.
              </small>
            </label>

            <label class="export-field" for="export-filename">
              <span>Nama berkas (opsional)</span>
              <input
                id="export-filename"
                v-model="filename"
                type="text"
                maxlength="128"
                :placeholder="`${table}.${format}`"
              />
              <small class="export-hint">Hanya huruf, angka, garis bawah, titik, dan tanda hubung.</small>
            </label>
          </div>

          <div v-if="format === 'csv'" class="export-option-box">
            <h3>Pengaturan CSV</h3>
            <div class="export-two-cols">
              <label class="export-field" for="export-csv-delimiter">
                <span>Pemisah kolom</span>
                <select id="export-csv-delimiter" v-model="delimiter">
                  <option value="comma">Koma (,)</option>
                  <option value="semicolon">Titik koma (;)</option>
                  <option value="tab">Tab (\t)</option>
                </select>
              </label>

              <label class="export-field" for="export-csv-null">
                <span>Representasi nilai NULL</span>
                <select id="export-csv-null" v-model="nullAs">
                  <option value="empty">String kosong (kosong)</option>
                  <option value="backslashN">\N</option>
                  <option value="NULL">NULL</option>
                </select>
              </label>
            </div>

            <p class="export-null-note" role="note">
              <template v-if="nullAs === 'empty'">
                Mode <strong>String kosong</strong> tidak membedakan nilai <code>NULL</code> dari teks kosong (<code>""</code>) di dalam CSV.
              </template>
              <template v-else-if="nullAs === 'backslashN'">
                Nilai <code>NULL</code> ditulis sebagai <code>\N</code> (tanpa tanda kutip), terpisah dari teks kosong.
              </template>
              <template v-else>
                Nilai <code>NULL</code> ditulis sebagai <code>NULL</code> (tanpa tanda kutip), terpisah dari teks kosong.
              </template>
            </p>

            <div class="export-checks">
              <label class="export-check">
                <input v-model="header" type="checkbox" />
                <span>Sertakan baris judul nama kolom (header)</span>
              </label>
              <label class="export-check">
                <input v-model="bom" type="checkbox" />
                <span>Tambah UTF-8 BOM (disarankan agar Excel membaca karakter UTF-8 dengan benar)</span>
              </label>
            </div>
          </div>

          <div v-else class="export-option-box">
            <h3>Pengaturan SQL</h3>
            <div class="export-two-cols">
              <label class="export-field" for="export-sql-table">
                <span>Nama tabel pada INSERT</span>
                <input
                  id="export-sql-table"
                  v-model="sqlTableName"
                  type="text"
                  maxlength="64"
                  required
                />
              </label>

              <label class="export-field" for="export-sql-batch">
                <span>Jumlah baris per batch (100 - 10000)</span>
                <input
                  id="export-sql-batch"
                  v-model.number="batchSize"
                  type="number"
                  min="100"
                  max="10000"
                  step="1"
                  required
                />
              </label>
            </div>

            <label class="export-check">
              <input v-model="includeCreate" type="checkbox" />
              <span>Sertakan komentar sumber &amp; pernyataan <code>CREATE TABLE</code> di awal berkas</span>
            </label>
          </div>

          <div class="export-section">
            <div class="export-columns-head">
              <span class="export-label">
                Kolom yang diekspor ({{ selectedColumns.length }} dari {{ info.columns.length }})
              </span>
              <div class="export-columns-tools">
                <button type="button" class="export-link-btn" @click="selectAllColumns">Pilih semua</button>
                <button type="button" class="export-link-btn" @click="clearAllColumns">Kosongkan</button>
              </div>
            </div>
            <div class="export-columns-grid">
              <label v-for="col in info.columns" :key="col.name" class="export-col-check">
                <input
                  :checked="selectedColumns.includes(col.name)"
                  type="checkbox"
                  @change="toggleColumn(col.name)"
                />
                <span class="export-col-name" :title="col.name">{{ col.name }}</span>
                <small :title="col.type">{{ col.type }}</small>
              </label>
            </div>
          </div>

          <p v-if="validationError" class="export-error-text" role="alert">{{ validationError }}</p>
          <p v-if="downloadStartedMessage" class="export-success-note" role="status">
            {{ downloadStartedMessage }}
          </p>

          <div class="export-actions">
            <button
              type="submit"
              class="export-primary-btn"
              :disabled="Boolean(validationError)"
            >
              Unduh {{ format.toUpperCase() }}
            </button>
            <button type="button" class="export-secondary-btn" @click="handleClose">Tutup</button>
          </div>
        </form>
      </template>
    </section>
  </Teleport>
</template>

<script setup lang="ts">
type ExportColumn = { name: string; type: string }
type ExportInfo = {
  database: string
  table: string
  engine: string
  sortingKey: string
  orderGuaranteed: boolean
  useFinal: boolean
  rowCount: number
  columns: ExportColumn[]
}

const props = defineProps<{
  open: boolean
  database: string
  table: string
}>()

const emit = defineEmits<{
  close: []
}>()

const sqlTablePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const safeFilenamePattern = /^[A-Za-z0-9._-]+$/

const dialogRef = ref<HTMLElement | null>(null)
const info = ref<ExportInfo | null>(null)
const infoPending = ref(false)
const infoError = ref('')

const format = ref<'csv' | 'sql'>('csv')
const selectedColumns = ref<string[]>([])
const limitText = ref('')
const filename = ref('')

const delimiter = ref<'comma' | 'semicolon' | 'tab'>('comma')
const header = ref(true)
const nullAs = ref<'empty' | 'backslashN' | 'NULL'>('empty')
const bom = ref(false)

const sqlTableName = ref('')
const includeCreate = ref(true)
const batchSize = ref(1000)

const downloadStartedMessage = ref('')
let infoRequestId = 0

function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

function getErrorMessage(error: unknown, fallback: string): string {
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

function defaultFilename(tableName: string, fmt: 'csv' | 'sql'): string {
  const safeBase = tableName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'ekspor'
  return `${safeBase}.${fmt}`
}

function switchFormat(nextFormat: 'csv' | 'sql') {
  if (format.value === nextFormat) return
  const prevDefault = defaultFilename(props.table, format.value)
  format.value = nextFormat
  downloadStartedMessage.value = ''
  if (!filename.value.trim() || filename.value.trim() === prevDefault) {
    filename.value = defaultFilename(props.table, nextFormat)
  }
}

function toggleColumn(columnName: string) {
  if (!info.value) return
  if (selectedColumns.value.includes(columnName)) {
    selectedColumns.value = selectedColumns.value.filter((c) => c !== columnName)
  } else {
    const selectedSet = new Set([...selectedColumns.value, columnName])
    selectedColumns.value = info.value.columns
      .map((c) => c.name)
      .filter((name) => selectedSet.has(name))
  }
}

function selectAllColumns() {
  if (!info.value) return
  selectedColumns.value = info.value.columns.map((c) => c.name)
}

function clearAllColumns() {
  selectedColumns.value = []
}

const validationError = computed(() => {
  if (!info.value) return 'Informasi tabel belum tersedia.'
  if (selectedColumns.value.length === 0) {
    return 'Pilih minimal satu kolom untuk diekspor.'
  }

  const trimmedLimit = limitText.value.trim()
  if (trimmedLimit) {
    if (!/^[1-9]\d*$/.test(trimmedLimit) || !Number.isSafeInteger(Number(trimmedLimit))) {
      return 'Batas baris harus berupa bilangan bulat positif.'
    }
  }

  const trimmedFile = filename.value.trim()
  if (trimmedFile) {
    if (
      trimmedFile.length > 128
      || trimmedFile.startsWith('.')
      || trimmedFile.includes('..')
      || !safeFilenamePattern.test(trimmedFile)
    ) {
      return 'Nama berkas hanya boleh berisi huruf, angka, garis bawah, titik, dan tanda hubung.'
    }
  }

  if (format.value === 'sql') {
    const trimmedTable = sqlTableName.value.trim()
    if (!sqlTablePattern.test(trimmedTable)) {
      return 'Nama tabel SQL harus diawali huruf, hanya huruf/angka/garis bawah, maks. 64 karakter.'
    }
    if (!Number.isInteger(batchSize.value) || batchSize.value < 100 || batchSize.value > 10000) {
      return 'Ukuran batch SQL harus bilangan bulat antara 100 dan 10000.'
    }
  }

  return ''
})

async function loadInfo() {
  if (!props.database || !props.table) return
  const reqId = ++infoRequestId
  infoPending.value = true
  infoError.value = ''
  info.value = null
  downloadStartedMessage.value = ''

  try {
    const response = await $fetch<ExportInfo>('/api/export/info', {
      query: { database: props.database, table: props.table },
    })
    if (reqId !== infoRequestId) return
    info.value = response
    selectedColumns.value = response.columns.map((c) => c.name)
    sqlTableName.value = sqlTablePattern.test(response.table) ? response.table : 'tabel_ekspor'
    filename.value = defaultFilename(response.table, format.value)
  } catch (error) {
    if (reqId === infoRequestId) {
      infoError.value = getErrorMessage(error, 'Informasi ekspor tabel tidak dapat dimuat.')
    }
  } finally {
    if (reqId === infoRequestId) {
      infoPending.value = false
    }
  }
}

watch(
  () => [props.open, props.database, props.table] as const,
  ([isOpen, database, table]) => {
    if (!isOpen) return
    limitText.value = ''
    format.value = 'csv'
    delimiter.value = 'comma'
    header.value = true
    nullAs.value = 'empty'
    bom.value = false
    includeCreate.value = true
    batchSize.value = 1000
    downloadStartedMessage.value = ''
    if (database && table) {
      void loadInfo()
      nextTick(() => {
        dialogRef.value?.focus()
      })
    }
  },
  { immediate: true },
)

function buildExportUrl(): string {
  const params = new URLSearchParams()
  params.set('database', props.database)
  params.set('table', props.table)
  params.set('format', format.value)

  if (info.value && selectedColumns.value.length < info.value.columns.length) {
    params.set('columns', selectedColumns.value.join(','))
  }

  const trimmedLimit = limitText.value.trim()
  if (trimmedLimit) {
    params.set('limit', trimmedLimit)
  }

  const trimmedFilename = filename.value.trim()
  if (trimmedFilename) {
    params.set('filename', trimmedFilename)
  }

  if (format.value === 'csv') {
    params.set('delimiter', delimiter.value)
    params.set('header', String(header.value))
    params.set('nullAs', nullAs.value)
    params.set('bom', String(bom.value))
  } else {
    params.set('tableName', sqlTableName.value.trim())
    params.set('includeCreate', String(includeCreate.value))
    params.set('batchSize', String(batchSize.value))
  }

  return `/api/export?${params.toString()}`
}

function triggerDownload() {
  if (validationError.value || !info.value) return
  const exportUrl = buildExportUrl()
  const chosenFilename = filename.value.trim() || defaultFilename(props.table, format.value)

  const anchor = document.createElement('a')
  anchor.href = exportUrl
  anchor.download = chosenFilename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  downloadStartedMessage.value = `Unduhan berkas ${chosenFilename} telah dimulai.`
}

function handleClose() {
  emit('close')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    handleClose()
  }
}
</script>

<style scoped>
.export-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  background: rgb(21 38 55 / 44%);
}

.export-dialog {
  position: fixed;
  inset: 50% auto auto 50%;
  z-index: 31;
  display: grid;
  gap: 14px;
  width: min(760px, calc(100vw - 32px));
  max-height: min(90vh, 920px);
  overflow: auto;
  transform: translate(-50%, -50%);
}

.export-dialog-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.export-dialog-heading .page-kicker {
  margin-bottom: 3px;
}

.export-dialog-heading .card-title {
  margin: 0;
}

.export-target-label {
  margin: 4px 0 0;
  color: var(--warna-redup);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.export-close-btn,
.export-secondary-btn,
.export-primary-btn {
  min-height: 40px;
  padding: 7px 13px;
  border-radius: 9px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.export-close-btn,
.export-secondary-btn {
  border: 1px solid var(--warna-garis);
  color: #375875;
  background: #fff;
  font-weight: 600;
}

.export-close-btn {
  min-height: 36px;
  padding: 6px 11px;
}

.export-primary-btn {
  border: 1px solid var(--warna-utama);
  color: #fff;
  background: var(--warna-utama);
  font-weight: 700;
}

.export-primary-btn:hover:not(:disabled) {
  filter: brightness(0.95);
}

.export-primary-btn:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.export-message {
  margin: 0;
  color: var(--warna-redup);
  font-size: 13px;
}

.export-error-box {
  display: grid;
  gap: 8px;
  justify-items: start;
  padding: 12px;
  border: 1px solid #e6bcb8;
  border-radius: 10px;
  color: #8a352e;
  background: #f9eceb;
  font-size: 13px;
}

.export-error-box p {
  margin: 0;
}

.export-warning-box {
  padding: 10px 12px;
  border: 1px solid #e5d29c;
  border-radius: 9px;
  color: #6b5214;
  background: #fdf8e7;
  font-size: 13px;
}

.export-form,
.export-section,
.export-option-box {
  display: grid;
  gap: 10px;
}

.export-option-box {
  padding: 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  background: #f8fbfe;
}

.export-option-box h3 {
  margin: 0;
  color: #263a4e;
  font-size: 14px;
}

.export-label {
  color: #263a4e;
  font-size: 13px;
  font-weight: 650;
}

.export-format-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.export-format-btn {
  min-height: 38px;
  padding: 6px 14px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: #375875;
  background: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}

.export-format-btn--active {
  border-color: var(--warna-utama);
  color: #fff;
  background: var(--warna-utama);
}

.export-two-cols {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.export-field {
  display: grid;
  gap: 4px;
  min-width: 0;
  align-content: start;
}

.export-field span {
  color: #40566d;
  font-size: 12px;
  font-weight: 650;
}

.export-field input,
.export-field select {
  width: 100%;
  min-width: 0;
  min-height: 38px;
  padding: 7px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
  font-size: 13px;
}

.export-hint {
  color: var(--warna-redup);
  font-size: 11px;
}

.export-null-note {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid #d5e2ee;
  border-radius: 8px;
  color: #375875;
  background: #fff;
  font-size: 12px;
}

.export-checks {
  display: grid;
  gap: 6px;
}

.export-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #374a5d;
  font-size: 13px;
  cursor: pointer;
}

.export-check input {
  margin: 3px 0 0;
}

.export-columns-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.export-columns-tools {
  display: flex;
  gap: 10px;
}

.export-link-btn {
  padding: 0;
  border: 0;
  color: var(--warna-utama);
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.export-columns-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(195px, 1fr));
  gap: 6px;
  max-height: 185px;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  background: #f8fbfe;
}

.export-col-check {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: start;
  gap: 2px 7px;
  padding: 5px 7px;
  border: 1px solid #e3ecf4;
  border-radius: 7px;
  background: #fff;
  cursor: pointer;
}

.export-col-check input {
  grid-row: span 2;
  margin: 3px 0 0;
}

.export-col-name {
  overflow: hidden;
  color: #263a4e;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-col-check small {
  overflow: hidden;
  color: var(--warna-redup);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.export-error-text {
  margin: 0;
  color: #9c3e36;
  font-size: 13px;
  font-weight: 600;
}

.export-success-note {
  margin: 0;
  padding: 9px 11px;
  border: 1px solid #d5e5c4;
  border-radius: 8px;
  color: #365228;
  background: #f1f7e9;
  font-size: 13px;
}

.export-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 720px) {
  .export-dialog {
    width: calc(100vw - 24px);
    padding: 16px;
  }

  .export-two-cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
