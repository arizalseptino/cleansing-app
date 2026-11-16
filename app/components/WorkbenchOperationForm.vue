<template>
  <form class="operation-form" @submit.prevent="submit">
    <p class="operation-description">{{ operation.description }}</p>
    <div v-for="parameter in operation.params" v-show="isParameterVisible(parameter)" :key="parameter.key" class="operation-field">
      <label :for="`workbench-${parameter.key}`">
        {{ parameter.label }}<span v-if="parameter.required"> *</span>
      </label>
      <p v-if="parameter.description" class="operation-hint">{{ parameter.description }}</p>

      <select
        v-if="parameter.type === 'column' && parameter.allowNew"
        :id="`workbench-${parameter.key}`"
        :value="targetSelection()"
        :required="parameter.required"
        @change="handleTargetChange(parameter, $event)"
      >
        <option value="">Pilih kolom</option>
        <option v-for="column in columnsFor(parameter)" :key="column.name" :value="column.name">
          {{ column.name }} ({{ column.type }})
        </option>
        <option :value="newColumnOption()">Tambah kolom baru...</option>
      </select>

      <input
        v-else-if="parameter.key === 'newTargetName' && draft.createTarget === true"
        :id="`workbench-${parameter.key}`"
        v-model="draft[parameter.key]"
        type="text"
        :required="draft.createTarget === true"
      />

      <select
        v-else-if="parameter.type === 'column'"
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

      <div v-else-if="parameter.type === 'string-list'" class="pair-list">
        <div v-for="(value, index) in stringListValues(parameter.key)" :key="index" class="pair-row">
          <label class="sr-only" :for="`list-${parameter.key}-${index}`">{{ parameter.label }} {{ index + 1 }}</label>
          <input :id="`list-${parameter.key}-${index}`" v-model="stringListValues(parameter.key)[index]" type="text" />
          <button type="button" class="quiet-button" :aria-label="`Hapus nilai ${index + 1}`" @click="removeStringValue(parameter.key, index)">
            Hapus
          </button>
        </div>
        <button type="button" class="quiet-button" @click="addStringValue(parameter.key)">Tambah nilai</button>
      </div>

      <div v-else-if="parameter.type === 'rules'" class="rule-list">
        <fieldset v-for="(rule, ruleIndex) in ruleValues(parameter.key)" :key="ruleIndex" class="rule-card">
          <legend>Aturan {{ ruleIndex + 1 }}</legend>
          <div class="rule-heading">
            <strong>Jika semua kondisi berikut cocok</strong>
            <button type="button" class="quiet-button" @click="removeRule(parameter.key, ruleIndex)">Hapus aturan</button>
          </div>
          <div v-for="(condition, conditionIndex) in rule.conditions" :key="conditionIndex" class="rule-condition">
            <label :for="`rule-${ruleIndex}-column-${conditionIndex}`">Kolom kondisi</label>
            <select :id="`rule-${ruleIndex}-column-${conditionIndex}`" v-model="condition.column">
              <option value="">Pilih kolom</option>
              <option v-for="column in schema" :key="column.name" :value="column.name">{{ column.name }}</option>
            </select>
            <label :for="`rule-${ruleIndex}-operator-${conditionIndex}`">Operator</label>
            <select :id="`rule-${ruleIndex}-operator-${conditionIndex}`" v-model="condition.operator">
              <option value="equals">Sama dengan</option>
              <option value="not_equals">Tidak sama dengan</option>
              <option value="contains">Mengandung</option>
              <option value="starts_with">Diawali dengan</option>
              <option value="empty">Kosong</option>
              <option value="not_empty">Tidak kosong</option>
              <option value="in">Termasuk dalam daftar nilai</option>
            </select>
            <template v-if="condition.operator === 'in'">
              <div v-for="(value, valueIndex) in condition.values" :key="valueIndex" class="rule-value-row">
                <input v-model="condition.values[valueIndex]" :aria-label="`Nilai ${valueIndex + 1} pada kondisi ${conditionIndex + 1}`" type="text" />
                <button type="button" class="quiet-button" @click="removeConditionValue(condition, valueIndex)">Hapus nilai</button>
              </div>
              <button type="button" class="quiet-button" @click="addConditionValue(condition)">Tambah nilai daftar</button>
            </template>
            <input
              v-else-if="condition.operator !== 'empty' && condition.operator !== 'not_empty'"
              v-model="condition.value"
              :aria-label="`Nilai kondisi ${conditionIndex + 1}`"
              type="text"
            />
            <label class="operation-check">
              <input v-model="condition.ignoreCase" type="checkbox" />
              <span>Abaikan kapitalisasi</span>
            </label>
            <label class="operation-check">
              <input v-model="condition.ignoreTrim" type="checkbox" />
              <span>Abaikan spasi di tepi</span>
            </label>
            <button
              v-if="rule.conditions.length > 1"
              type="button"
              class="quiet-button"
              @click="removeCondition(rule, conditionIndex)"
            >Hapus kondisi</button>
          </div>
          <button
            v-if="rule.conditions.length < 3"
            type="button"
            class="quiet-button"
            @click="addCondition(rule)"
          >Tambah kondisi (DAN)</button>
          <label :for="`rule-${ruleIndex}-target`">Kolom target</label>
          <select :id="`rule-${ruleIndex}-target`" v-model="rule.targetColumn">
            <option value="">Pilih kolom</option>
            <option v-for="column in schema" :key="column.name" :value="column.name">{{ column.name }} ({{ column.type }})</option>
          </select>
          <label :for="`rule-${ruleIndex}-action`">Tindakan</label>
          <select :id="`rule-${ruleIndex}-action`" v-model="rule.action">
            <option value="set_value">Atur nilai</option>
            <option value="set_null">Atur NULL</option>
            <option value="copy_column">Salin dari kolom lain</option>
          </select>
          <input
            v-if="rule.action === 'set_value'"
            v-model="rule.value"
            :aria-label="`Nilai aturan ${ruleIndex + 1}`"
            type="text"
            placeholder="Nilai teks atau angka"
          />
          <select
            v-else-if="rule.action === 'copy_column'"
            v-model="rule.sourceColumn"
            :aria-label="`Kolom sumber salinan aturan ${ruleIndex + 1}`"
          >
            <option value="">Pilih kolom sumber</option>
            <option v-for="column in schema" :key="column.name" :value="column.name">{{ column.name }} ({{ column.type }})</option>
          </select>
        </fieldset>
        <button type="button" class="quiet-button" :disabled="ruleValues(parameter.key).length >= 20" @click="addRule(parameter.key)">
          Tambah aturan
        </button>
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
        :maxlength="parameter.maxLength"
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
  allowNew?: boolean
  defaultValue?: unknown
  maxLength?: number
}
type Operation = {
  id: string
  name: string
  description: string
  params: Parameter[]
}
type Pair = { old: string; new: string }
type RuleCondition = {
  column: string
  operator: string
  value: string
  values: string[]
  ignoreCase: boolean
  ignoreTrim: boolean
}
type ConditionalRule = {
  conditions: RuleCondition[]
  targetColumn: string
  action: string
  value: string
  sourceColumn: string
}
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
  most_complete: 'Paling lengkap',
  first: 'Pertama',
  last: 'Terakhir',
  starts_with: 'Diawali dengan',
  contains: 'Mengandung',
  regex: 'Regex (RE2 ClickHouse)',
  copy: 'Salin nilai sumber',
  move: 'Pindahkan nilai sumber',
  extract: 'Ekstrak bagian teks',
  after: 'Bagian setelah pola',
  before: 'Bagian sebelum pola',
  set_value: 'Atur nilai',
  set_null: 'Atur NULL',
  copy_column: 'Salin dari kolom lain',
  constant_text: 'Teks tetap',
  constant_number: 'Angka tetap',
  sequence: 'Nomor urut',
  combine: 'Gabungkan kolom',
}

function optionLabel(value: string): string {
  return optionLabels[value] ?? value.replace(/_/g, ' ')
}

function isParameterVisible(parameter: Parameter): boolean {
  if (parameter.key === 'newTargetName') return draft.createTarget === true
  if (props.operation.id !== 'extract_and_route' || draft.action !== 'extract') return parameter.key !== 'extractPart' && parameter.key !== 'captureGroup'
  if (parameter.key === 'extractPart') return draft.patternType !== 'regex'
  if (parameter.key === 'captureGroup') return draft.patternType === 'regex'
  return true
}

const titleModeSelected = computed(() => {
  const selected = draft.operations
  return Array.isArray(selected) && selected.some((option) => option === 'title')
})

watch(
  () => [props.operation.id, props.initialParams, props.prefilledColumn] as const,
  () => {
    for (const key of Object.keys(draft)) delete draft[key]
    draft.createTarget = props.initialParams?.createTarget === true
    for (const parameter of props.operation.params) {
      const value = props.initialParams?.[parameter.key]
      if (parameter.type === 'multiselect' || parameter.type === 'columns') draft[parameter.key] = Array.isArray(value) ? [...value] : []
      else if (parameter.type === 'string-list') {
        draft[parameter.key] = Array.isArray(value) ? [...value] : Array.isArray(parameter.defaultValue) ? [...parameter.defaultValue] : []
      }
      else if (parameter.type === 'rules') {
        draft[parameter.key] = Array.isArray(value) && value.length
          ? value.map(normalizeRule)
          : [blankRule()]
      }
      else if (parameter.type === 'pairs') {
        draft[parameter.key] = Array.isArray(value) && value.length
          ? value.map((item) => ({
              old: String((item as Pair)?.old ?? ''),
              new: String((item as Pair)?.new ?? ''),
            }))
          : [{ old: '', new: '' }]
      } else if (parameter.type === 'boolean') draft[parameter.key] = Boolean(value ?? parameter.defaultValue ?? false)
      else draft[parameter.key] = value ?? parameter.defaultValue ?? (parameter.type === 'number' ? '' : '')
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
    || (props.operation.id === 'extract_and_route' && parameter.key === 'targetColumn')
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

function stringListValues(key: string): string[] {
  const value = draft[key]
  return Array.isArray(value) ? value as string[] : []
}

function addStringValue(key: string): void {
  draft[key] = [...stringListValues(key), '']
}

function removeStringValue(key: string, index: number): void {
  draft[key] = stringListValues(key).filter((_, itemIndex) => itemIndex !== index)
}

function blankCondition(): RuleCondition {
  return { column: '', operator: 'equals', value: '', values: [''], ignoreCase: false, ignoreTrim: false }
}

function blankRule(): ConditionalRule {
  return { conditions: [blankCondition()], targetColumn: '', action: 'set_value', value: '', sourceColumn: '' }
}

function normalizeRule(value: unknown): ConditionalRule {
  if (!value || typeof value !== 'object') return blankRule()
  const rule = value as Partial<ConditionalRule>
  const conditions = Array.isArray(rule.conditions) ? rule.conditions.map((condition) => {
    const item = condition as Partial<RuleCondition>
    return {
      ...blankCondition(),
      ...item,
      values: Array.isArray(item.values) ? item.values.map(String) : [''],
    }
  }) : [blankCondition()]
  return { ...blankRule(), ...rule, conditions }
}

function ruleValues(key: string): ConditionalRule[] {
  const value = draft[key]
  return Array.isArray(value) ? value as ConditionalRule[] : []
}

function addRule(key: string): void {
  draft[key] = [...ruleValues(key), blankRule()]
}

function removeRule(key: string, index: number): void {
  draft[key] = ruleValues(key).filter((_, ruleIndex) => ruleIndex !== index)
}

function addCondition(rule: ConditionalRule): void {
  if (rule.conditions.length < 3) rule.conditions.push(blankCondition())
}

function removeCondition(rule: ConditionalRule, index: number): void {
  if (rule.conditions.length > 1) rule.conditions.splice(index, 1)
}

function addConditionValue(condition: RuleCondition): void {
  condition.values.push('')
}

function removeConditionValue(condition: RuleCondition, index: number): void {
  condition.values.splice(index, 1)
}

function newColumnOption(): string {
  const base = '__workbench_new_column__'
  let value = base
  let suffix = 1
  while (props.schema.some((column) => column.name === value)) {
    value = `${base}${suffix}`
    suffix += 1
  }
  return value
}

function targetSelection(): string {
  return draft.createTarget === true ? newColumnOption() : String(draft.targetColumn ?? '')
}

function handleTargetChange(parameter: Parameter, event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  const createTarget = value === newColumnOption()
  draft.createTarget = createTarget
  draft[parameter.key] = createTarget ? '' : value
  if (!createTarget) draft.newTargetName = ''
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
  if (props.operation.id === 'extract_and_route') params.createTarget = draft.createTarget === true
  for (const parameter of props.operation.params) {
    const value = draft[parameter.key]
    const missing = parameter.key === 'targetColumn' && parameter.allowNew && draft.createTarget === true
      ? !String(draft.newTargetName ?? '').trim()
      : value === '' || value === undefined || value === null || (Array.isArray(value) && value.length === 0)
    if (parameter.required && missing) {
      formError.value = `${parameter.label} wajib diisi.`
      return
    }
    if (parameter.type === 'number' && value !== '') params[parameter.key] = Number(value)
    else if (parameter.type === 'pairs' && Array.isArray(value)) {
      params[parameter.key] = value.filter((pair) => pair.old !== '' || pair.new !== '')
    } else if (parameter.type === 'string-list' && Array.isArray(value)) params[parameter.key] = [...value]
    else if (parameter.type === 'rules' && Array.isArray(value)) params[parameter.key] = value
    else params[parameter.key] = value
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

.rule-list,
.rule-card,
.rule-condition {
  display: grid;
  min-width: 0;
  gap: 8px;
}

.rule-card {
  padding: 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 9px;
}

.rule-card legend {
  padding: 0 4px;
  color: #40566d;
  font-size: 13px;
  font-weight: 650;
}

.rule-heading,
.rule-value-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.rule-condition {
  padding: 8px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
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
