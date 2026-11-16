<template>
  <form class="operation-form" @submit.prevent="submit">
    <p class="operation-description">{{ operation.description }}</p>
    <div v-for="parameter in operation.params" :key="parameter.key" class="operation-field">
      <label :for="`workbench-${parameter.key}`">
        {{ parameter.label }}<span v-if="parameter.required"> *</span>
      </label>
      <p v-if="parameter.description" class="operation-hint">{{ parameter.description }}</p>

      <select
        v-if="parameter.type === 'column'"
        :id="`workbench-${parameter.key}`"
        v-model="draft[parameter.key]"
        :required="parameter.required"
      >
        <option v-if="!parameter.required" value="">Tidak dipilih</option>
        <option v-else value="">Pilih kolom</option>
        <option
          v-for="column in columnsFor(parameter)"
          :key="column.name"
          :value="column.name"
        >
          {{ column.name }} ({{ column.type }})
        </option>
      </select>

      <select
        v-else-if="parameter.type === 'columns'"
        :id="`workbench-${parameter.key}`"
        v-model="draft[parameter.key]"
        multiple
        :required="parameter.required"
      >
        <option v-for="column in schema" :key="column.name" :value="column.name">
          {{ column.name }} ({{ column.type }})
        </option>
      </select>

      <select
        v-else-if="parameter.type === 'select'"
        :id="`workbench-${parameter.key}`"
        v-model="draft[parameter.key]"
        :required="parameter.required"
      >
        <option value="">Pilih {{ parameter.label.toLowerCase() }}</option>
        <option v-for="option in parameter.options ?? []" :key="option" :value="option">
          {{ optionLabel(option) }}
        </option>
      </select>

      <fieldset v-else-if="parameter.type === 'multiselect'" class="operation-options">
        <legend class="sr-only">{{ parameter.label }}</legend>
        <label v-for="option in parameter.options ?? []" :key="option" class="operation-check">
          <input
            v-model="draft[parameter.key]"
            type="checkbox"
            :value="option"
          />
          <span>{{ optionLabel(option) }}</span>
        </label>
        <p v-if="parameter.key === 'operations' && titleModeSelected" class="operation-hint" role="status">
          Backend saat ini menjalankan mode kapitalisasi judul sebagai huruf kecil.
        </p>
      </fieldset>

      <div v-else-if="parameter.type === 'pairs'" class="pair-list">
        <div v-for="(pair, index) in pairValues(parameter.key)" :key="index" class="pair-row">
          <label class="sr-only" :for="`pair-old-${parameter.key}-${index}`">Nilai lama</label>
          <input
            :id="`pair-old-${parameter.key}-${index}`"
            v-model="pair.old"
            type="text"
            placeholder="Nilai lama"
          />
          <label class="sr-only" :for="`pair-new-${parameter.key}-${index}`">Nilai baru</label>
          <input
            :id="`pair-new-${parameter.key}-${index}`"
            v-model="pair.new"
            type="text"
            placeholder="Nilai baru"
          />
          <button type="button" class="quiet-button" :aria-label="`Hapus pasangan ${index + 1}`" @click="removePair(parameter.key, index)">
            Hapus
          </button>
        </div>
        <button type="button" class="quiet-button" @click="addPair(parameter.key)">Tambah pasangan</button>
      </div>

      <select
        v-else-if="parameter.type === 'table-ref' && parameter.key.toLowerCase().includes('database')"
        :id="`workbench-${parameter.key}`"
        v-model="draft[parameter.key]"
        :required="parameter.required"
        @change="handleDatabaseChange(parameter.key)"
      >
        <option value="">Pilih database</option>
        <option v-for="database in databases" :key="database.name" :value="database.name">
          {{ database.name }}
        </option>
      </select>

      <select
        v-else-if="parameter.type === 'table-ref'"
        :id="`workbench-${parameter.key}`"
        v-model="draft[parameter.key]"
        :required="parameter.required"
        :disabled="!tableDatabase(parameter.key)"
        @change="handleTableChange(parameter.key)"
      >
        <option value="">Pilih tabel</option>
        <option v-for="table in tablesFor(parameter.key)" :key="table.name" :value="table.name">
          {{ table.name }}
        </option>
      </select>

      <select
        v-else-if="parameter.type === 'boolean'"
        :id="`workbench-${parameter.key}`"
        v-model="draft[parameter.key]"
      >
        <option :value="false">Tidak</option>
        <option :value="true">Ya</option>
      </select>

      <input
        v-else
        :id="`workbench-${parameter.key}`"
        v-model="draft[parameter.key]"
        :type="parameter.type === 'number' ? 'number' : 'text'"
        :required="parameter.required"
      />
    </div>
    <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
    <button class="primary-button" type="submit">
      {{ editing ? 'Perbarui langkah' : 'Tambahkan langkah' }}
    </button>
  </form>
</template>

<script setup lang="ts">
type Column = { name: string; type: string }
type Parameter = {
  key: string
  label: string
  description: string
  type: string
  required?: boolean
  options?: string[]
}
type Operation = {
  id: string
  name: string
  description: string
  params: Parameter[]
}
type Pair = { old: string; new: string }
type Database = { name: string }
type Table = { name: string }

const props = defineProps<{
  operation: Operation
  schema: Column[]
  masterColumns: Column[]
  databases: Database[]
  tablesByDatabase: Record<string, Table[]>
  initialParams?: Record<string, unknown>
  editing: boolean
  prefilledColumn?: string
}>()
const emit = defineEmits<{
  submit: [params: Record<string, unknown>]
  databaseChange: [database: string]
  tableChange: [database: string, table: string]
}>()

const draft = reactive<Record<string, unknown>>({})
const formError = ref('')
const optionLabels: Record<string, string> = {
  trim: 'Rapikan spasi di tepi',
  collapse_spaces: 'Rapatkan spasi berulang',
  empty_to_null: 'Ubah teks kosong menjadi NULL',
  upper: 'Ubah menjadi huruf kapital',
  lower: 'Ubah menjadi huruf kecil',
  title: 'Huruf kecil (mode kapitalisasi judul)',
  constant_text: 'Teks tetap',
  constant_number: 'Angka tetap',
  sequence: 'Nomor urut',
  combine: 'Gabungkan kolom',
}

function optionLabel(value: string): string {
  return optionLabels[value] ?? value.replace(/_/g, ' ')
}

const titleModeSelected = computed(() => {
  const selected = draft.operations
  return Array.isArray(selected) && selected.some((option) => option === 'title')
})

watch(
  () => [props.operation.id, props.initialParams, props.prefilledColumn] as const,
  () => {
    for (const key of Object.keys(draft)) delete draft[key]
    for (const parameter of props.operation.params) {
      const value = props.initialParams?.[parameter.key]
      if (parameter.type === 'multiselect') draft[parameter.key] = Array.isArray(value) ? [...value] : []
      else if (parameter.type === 'pairs') {
        draft[parameter.key] = Array.isArray(value) && value.length
          ? value.map((item) => ({
              old: String((item as Pair)?.old ?? ''),
              new: String((item as Pair)?.new ?? ''),
            }))
          : [{ old: '', new: '' }]
      } else if (parameter.type === 'boolean') draft[parameter.key] = Boolean(value)
      else draft[parameter.key] = value ?? (parameter.type === 'number' ? '' : '')
    }
    if (props.prefilledColumn) {
      const columnParam = props.operation.params.find((parameter) => parameter.type === 'column')
      if (columnParam) draft[columnParam.key] = props.prefilledColumn
    }
    formError.value = ''
  },
  { immediate: true },
)

function isTextColumn(column: Column): boolean {
  const type = column.type.replace(/Nullable\s*\(/g, '').replace(/LowCardinality\s*\(/g, '')
  return /^\s*String\s*\)*\s*$/.test(type)
}

function columnsFor(parameter: Parameter): Column[] {
  if (parameter.key.toLowerCase().includes('master')) return props.masterColumns
  const textOnly = `${parameter.label} ${parameter.description}`.toLowerCase().includes('teks')
    || props.operation.id === 'trim_text'
    || props.operation.id === 'replace_values'
    || (props.operation.id === 'fill_from_master' && /Column$/.test(parameter.key))
  return textOnly ? props.schema.filter(isTextColumn) : props.schema
}

function pairValues(key: string): Pair[] {
  const value = draft[key]
  return Array.isArray(value) ? value as Pair[] : []
}

function addPair(key: string): void {
  draft[key] = [...pairValues(key), { old: '', new: '' }]
}

function removePair(key: string, index: number): void {
  draft[key] = pairValues(key).filter((_, itemIndex) => itemIndex !== index)
}

function tablesFor(key: string): Table[] {
  const database = tableDatabase(key)
  return props.tablesByDatabase[database] ?? []
}

function tableDatabase(key: string): string {
  const databaseKey = key.toLowerCase().includes('master')
    ? 'masterDatabase'
    : `${key.replace(/Table$/i, 'Database')}`
  return String(draft[databaseKey] ?? '')
}

function handleDatabaseChange(key: string): void {
  const database = String(draft[key] ?? '')
  const tableKey = key.replace(/Database$/i, 'Table')
  draft[tableKey] = ''
  emit('databaseChange', database)
}

function handleTableChange(key: string): void {
  const databaseKey = key.toLowerCase().includes('master')
    ? 'masterDatabase'
    : key.replace(/Table$/i, 'Database')
  emit('tableChange', String(draft[databaseKey] ?? ''), String(draft[key] ?? ''))
}

function submit(): void {
  formError.value = ''
  const params: Record<string, unknown> = {}
  for (const parameter of props.operation.params) {
    const value = draft[parameter.key]
    if (parameter.required && (value === '' || value === undefined || value === null
      || (Array.isArray(value) && value.length === 0))) {
      formError.value = `${parameter.label} wajib diisi.`
      return
    }
    if (parameter.type === 'number' && value !== '') params[parameter.key] = Number(value)
    else if (parameter.type === 'pairs' && Array.isArray(value)) {
      params[parameter.key] = value.filter((pair) => pair.old !== '' || pair.new !== '')
    } else params[parameter.key] = value
  }
  emit('submit', params)
}
</script>

<style scoped>
.operation-form {
  display: grid;
  gap: 14px;
}

.operation-description,
.operation-hint {
  margin: 0;
  color: var(--warna-redup);
  font-size: 13px;
}

.operation-field {
  display: grid;
  min-width: 0;
  gap: 6px;
}

.operation-field > label {
  color: #40566d;
  font-size: 13px;
  font-weight: 650;
}

.operation-field select,
.operation-field input,
.operation-form input {
  width: 100%;
  min-width: 0;
  min-height: 40px;
  padding: 8px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
}

.operation-field select[multiple] {
  min-height: 110px;
}

.operation-options {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 9px;
}

.operation-check {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #526479;
  font-size: 13px;
}

.operation-check input,
.operation-form input[type="checkbox"] {
  width: 16px;
  min-height: 16px;
  margin: 0;
}

.pair-list {
  display: grid;
  gap: 8px;
}

.pair-row {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 6px;
}

.quiet-button,
.primary-button {
  min-height: 38px;
  padding: 7px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: #375875;
  background: #fff;
  font: inherit;
  cursor: pointer;
}

.primary-button {
  border-color: var(--warna-utama);
  color: #fff;
  background: var(--warna-utama);
  font-weight: 700;
}

.form-error {
  margin: 0;
  color: #963c35;
  font-size: 13px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@media (max-width: 420px) {
  .pair-row {
    grid-template-columns: 1fr;
  }
}
</style>
