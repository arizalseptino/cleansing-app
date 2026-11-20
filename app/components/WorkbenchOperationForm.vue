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
        <option value="">{{ parameter.required ? 'Pilih kolom' : 'Sama dengan kolom sumber (bawaan)' }}</option>
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
        <option v-for="column in activeSchema" :key="column.name" :value="column.name">
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
            @change="handleMultiselectChange(parameter.key, option, $event)"
          />
          <span>{{ optionLabel(option) }}</span>
        </label>
      </fieldset>

      <div v-else-if="parameter.type === 'pairs'" class="pair-container">
        <div class="pair-mode-header">
          <div class="pair-mode-toggle" role="tablist" aria-label="Mode input pasangan nilai">
            <button
              type="button"
              role="tab"
              class="pair-mode-btn"
              :class="{ 'pair-mode-btn--active': getPairMode(parameter.key) === 'list' }"
              :aria-selected="getPairMode(parameter.key) === 'list'"
              @click="switchPairMode(parameter.key, 'list')"
            >
              Daftar baris
            </button>
            <button
              type="button"
              role="tab"
              class="pair-mode-btn"
              :class="{ 'pair-mode-btn--active': getPairMode(parameter.key) === 'bulk' }"
              :aria-selected="getPairMode(parameter.key) === 'bulk'"
              @click="switchPairMode(parameter.key, 'bulk')"
            >
              Tempel teks (Bulk)
            </button>
          </div>
          <span v-if="activePairCount(parameter.key) > 0" class="pair-count-pill">
            {{ activePairCount(parameter.key) }} pasangan
          </span>
        </div>

        <!-- Mode Daftar Baris -->
        <div v-show="getPairMode(parameter.key) === 'list'" class="pair-list">
          <div v-for="(pair, index) in pairValues(parameter.key)" :key="index" class="pair-row">
            <label class="sr-only" :for="`pair-old-${parameter.key}-${index}`">Nilai lama</label>
            <input
              :id="`pair-old-${parameter.key}-${index}`"
              v-model="pair.old"
              type="text"
              placeholder="Nilai lama"
              maxlength="200"
              @input="markListDirty(parameter.key)"
            />
            <label class="sr-only" :for="`pair-new-${parameter.key}-${index}`">Nilai baru</label>
            <input
              :id="`pair-new-${parameter.key}-${index}`"
              v-model="pair.new"
              type="text"
              placeholder="Nilai baru (kosong = NULL / '')"
              maxlength="200"
              @input="markListDirty(parameter.key)"
            />
            <button type="button" class="quiet-button" :aria-label="`Hapus pasangan ${index + 1}`" @click="removePair(parameter.key, index)">
              Hapus
            </button>
          </div>
          <button type="button" class="quiet-button" :disabled="pairValues(parameter.key).length >= 500" @click="addPair(parameter.key)">
            Tambah pasangan
          </button>
        </div>

        <!-- Mode Tempel Teks (Bulk) -->
        <div v-show="getPairMode(parameter.key) === 'bulk'" class="bulk-pair-wrapper">
          <p class="bulk-instructions">
            Format per baris: <code>NILAI_LAMA = NILAI_BARU</code>.<br />
            Pemisah yang didukung: <code>=</code>, <code>-&gt;</code>, <code>=&gt;</code>, atau <strong>Tab</strong> (bisa langsung copy-paste 2 kolom dari Excel / Google Sheets). Bagian setelah pemisah yang kosong akan dianggap string kosong / NULL.
          </p>
          <textarea
            :id="`workbench-${parameter.key}-bulk`"
            :value="bulkTexts[parameter.key] ?? ''"
            class="bulk-textarea"
            rows="8"
            spellcheck="false"
            :placeholder="bulkPlaceholder"
            @input="handleBulkInput(parameter.key, ($event.target as HTMLTextAreaElement).value)"
          ></textarea>

          <div class="bulk-feedback">
            <div v-if="bulkPairCounts[parameter.key] > 0" class="bulk-badge-success">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
              </svg>
              <span>{{ bulkPairCounts[parameter.key] }} pasangan nilai siap diterapkan</span>
            </div>
            <div v-else-if="!bulkTexts[parameter.key]?.trim()" class="bulk-badge-empty">
              <span>Tempel teks atau ketik aturan di atas untuk memulai</span>
            </div>
            <div v-else class="bulk-badge-empty">
              <span>0 pasangan nilai terbaca</span>
            </div>

            <div v-if="bulkErrors[parameter.key]?.length" class="bulk-error-box" role="alert">
              <strong>Peringatan format ({{ bulkErrors[parameter.key].length }} baris tidak valid):</strong>
              <ul>
                <li v-for="(err, errIdx) in bulkErrors[parameter.key].slice(0, 5)" :key="errIdx">{{ err }}</li>
                <li v-if="bulkErrors[parameter.key].length > 5">
                  ...dan {{ bulkErrors[parameter.key].length - 5 }} baris lainnya
                </li>
              </ul>
            </div>

            <div v-if="bulkWarnings[parameter.key]?.length" class="bulk-warning-box" role="alert">
              <ul>
                <li v-for="(warn, warnIdx) in bulkWarnings[parameter.key]" :key="warnIdx">{{ warn }}</li>
              </ul>
            </div>
          </div>
        </div>
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
        :min="parameter.min"
        :max="parameter.max"
        :step="parameter.step"
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
  min?: number
  max?: number
  step?: number
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

const pairModes = reactive<Record<string, 'list' | 'bulk'>>({})
const bulkTexts = reactive<Record<string, string>>({})
const bulkErrors = reactive<Record<string, string[]>>({})
const bulkWarnings = reactive<Record<string, string[]>>({})
const bulkPairCounts = reactive<Record<string, number>>({})
const listDirty = reactive<Record<string, boolean>>({})

const bulkPlaceholder = `KEMENDAGRI = KEMENTERIAN DALAM NEGERI\nKEMENKES = KEMENTERIAN KESEHATAN\n- =\n0 =`

function getPairMode(key: string): 'list' | 'bulk' {
  return pairModes[key] ?? 'list'
}

function activePairCount(key: string): number {
  if (getPairMode(key) === 'bulk') return bulkPairCounts[key] ?? 0
  return pairValues(key).filter((p) => p.old.trim() !== '' || p.new.trim() !== '').length
}

function markListDirty(key: string): void {
  listDirty[key] = true
}

function formatPairsToBulkText(pairs: Pair[]): string {
  if (!pairs || pairs.length === 0) return ''
  return pairs
    .filter((p) => p.old.trim() !== '' || p.new.trim() !== '')
    .map((p) => (p.new.trim() === '' ? `${p.old} =` : `${p.old} = ${p.new}`))
    .join('\n')
}

function findFirstSeparator(line: string): { index: number; length: number; sep: string } | null {
  const separators = ['\t', '=>', '->', '=']
  let earliestIndex = -1
  let matchedSep = ''
  for (const sep of separators) {
    const idx = line.indexOf(sep)
    if (idx !== -1) {
      if (earliestIndex === -1 || idx < earliestIndex) {
        earliestIndex = idx
        matchedSep = sep
      } else if (idx === earliestIndex && sep.length > matchedSep.length) {
        matchedSep = sep
      }
    }
  }
  if (earliestIndex === -1) return null
  return { index: earliestIndex, length: matchedSep.length, sep: matchedSep }
}

function parseBulkText(key: string, text: string, updateDraft: boolean): void {
  const lines = text.split(/\r?\n/)
  const validPairs: Pair[] = []
  const errors: string[] = []
  const warnings: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    if (rawLine.trim() === '') continue
    const lineNum = i + 1

    const sepMatch = findFirstSeparator(rawLine)
    if (!sepMatch) {
      const preview = rawLine.length > 30 ? `${rawLine.slice(0, 30)}...` : rawLine
      errors.push(`Baris ${lineNum} ("${preview}"): format tidak valid (tidak ada pemisah '=', '->', '=>', atau Tab).`)
      continue
    }

    const oldVal = rawLine.slice(0, sepMatch.index).trim()
    const newVal = rawLine.slice(sepMatch.index + sepMatch.length).trim()

    if (oldVal === '') {
      errors.push(`Baris ${lineNum}: nilai lama sebelum pemisah tidak boleh kosong.`)
      continue
    }

    if (oldVal.length > 200) {
      warnings.push(`Baris ${lineNum}: nilai lama "${oldVal.slice(0, 20)}..." melebihi 200 karakter (${oldVal.length} karakter).`)
    }
    if (newVal.length > 200) {
      warnings.push(`Baris ${lineNum}: nilai baru "${newVal.slice(0, 20)}..." melebihi 200 karakter (${newVal.length} karakter).`)
    }

    validPairs.push({ old: oldVal, new: newVal })
  }

  if (validPairs.length > 500) {
    warnings.push(`Jumlah pasangan melebihi batas maksimal 500 (${validPairs.length} pasangan ditemukan). Hanya 500 pasangan pertama yang akan diproses.`)
  }

  bulkPairCounts[key] = validPairs.length
  bulkErrors[key] = errors
  bulkWarnings[key] = warnings

  if (updateDraft) {
    const capped = validPairs.slice(0, 500)
    draft[key] = capped.length > 0 ? capped : [{ old: '', new: '' }]
  }
}

function handleBulkInput(key: string, text: string): void {
  bulkTexts[key] = text
  parseBulkText(key, text, true)
}

function switchPairMode(key: string, mode: 'list' | 'bulk'): void {
  if (mode === 'bulk') {
    if (listDirty[key] || !bulkTexts[key]) {
      const list = pairValues(key).filter((p) => p.old.trim() !== '' || p.new.trim() !== '')
      bulkTexts[key] = formatPairsToBulkText(list)
      parseBulkText(key, bulkTexts[key], false)
      listDirty[key] = false
    }
  }
  pairModes[key] = mode
}
const optionLabels: Record<string, string> = {
  trim: 'Rapikan spasi di tepi',
  collapse_spaces: 'Rapatkan spasi berulang',
  empty_to_null: 'Ubah teks kosong menjadi NULL',
  upper: 'Ubah menjadi huruf kapital',
  lower: 'Ubah menjadi huruf kecil',
  title: 'Ubah menjadi kapital awal kata (Title Case)',
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
  similarity: 'Kemiripan teks',
  keyword: 'Kata kunci',
  jaro_winkler: 'Jaro-Winkler',
  edit_distance: 'Jarak edit ternormalisasi',
  lowercase: 'Huruf kecil',
  remove_punctuation: 'Hapus tanda baca',
  drop: 'Hapus kolom',
  rename: 'Ubah nama kolom',
}

function optionLabel(value: string): string {
  return optionLabels[value] ?? value.replace(/_/g, ' ')
}

function isParameterVisible(parameter: Parameter): boolean {
  if (parameter.key === 'newTargetName') return draft.createTarget === true
  if (props.operation.id === 'manage_columns') {
    if (parameter.key === 'columns') return draft.mode === 'drop'
    if (parameter.key === 'sourceColumn' || parameter.key === 'newName') return draft.mode === 'rename'
    return true
  }
  if (props.operation.id === 'fuzzy_match_master') {
    if (parameter.key === 'algorithm' || parameter.key === 'threshold' || parameter.key === 'normalization') {
      return draft.mode === 'similarity'
    }
    if (parameter.key === 'unmatchedColumn') {
      return draft.routeUnmatched === true
    }
    return true
  }
  if (props.operation.id !== 'extract_and_route' || draft.action !== 'extract') return parameter.key !== 'extractPart' && parameter.key !== 'captureGroup'
  if (parameter.key === 'extractPart') return draft.patternType !== 'regex'
  if (parameter.key === 'captureGroup') return draft.patternType === 'regex'
  return true
}

const CASE_OPERATION_OPTIONS = new Set(['upper', 'lower', 'title'])

function handleMultiselectChange(parameterKey: string, option: string, event: Event): void {
  if (parameterKey !== 'operations' || !CASE_OPERATION_OPTIONS.has(option)) return
  const checked = (event.target as HTMLInputElement).checked
  if (!checked) return
  const current = Array.isArray(draft[parameterKey]) ? draft[parameterKey] as string[] : []
  draft[parameterKey] = [
    ...current.filter((item) => !CASE_OPERATION_OPTIONS.has(item)),
    option,
  ]
}

watch(
  () => [props.operation.id, props.initialParams, props.prefilledColumn] as const,
  () => {
    for (const key of Object.keys(draft)) delete draft[key]
    draft.createTarget = props.initialParams?.createTarget === true
    for (const parameter of props.operation.params) {
      const value = props.initialParams?.[parameter.key]
      if (parameter.type === 'multiselect' || parameter.type === 'columns') {
        draft[parameter.key] = Array.isArray(value)
          ? [...value]
          : Array.isArray(parameter.defaultValue)
            ? [...parameter.defaultValue]
            : []
      } else if (parameter.type === 'string-list') {
        draft[parameter.key] = Array.isArray(value) ? [...value] : Array.isArray(parameter.defaultValue) ? [...parameter.defaultValue] : []
      }
      else if (parameter.type === 'rules') {
        draft[parameter.key] = Array.isArray(value) && value.length
          ? value.map(normalizeRule)
          : [blankRule()]
      }
      else if (parameter.type === 'pairs') {
        const rawList = Array.isArray(value) ? value : []
        const normalized = rawList.length
          ? rawList.map((item: any) => ({
              old: String(item?.old ?? item?.oldValue ?? ''),
              new: String(item?.new ?? item?.newValue ?? ''),
            }))
          : [{ old: '', new: '' }]
        draft[parameter.key] = normalized
        bulkTexts[parameter.key] = formatPairsToBulkText(normalized)
        parseBulkText(parameter.key, bulkTexts[parameter.key], false)
        listDirty[parameter.key] = false
      } else if (parameter.type === 'boolean') draft[parameter.key] = Boolean(value ?? parameter.defaultValue ?? false)
      else draft[parameter.key] = value ?? parameter.defaultValue ?? (parameter.type === 'number' ? '' : '')
    }
    if (props.prefilledColumn) {
      const columnParam = props.operation.params.find((parameter) => parameter.type === 'column')
      if (columnParam) draft[columnParam.key] = props.prefilledColumn
      if (props.operation.id === 'manage_columns') {
        draft.columns = [props.prefilledColumn]
      }
    }
    formError.value = ''
  },
  { immediate: true },
)

const activeSchema = computed(() =>
  props.schema.filter((column) => !column.name.startsWith('__sumber_') && !column.name.startsWith('__sebelum_')),
)

function isTextColumn(column: Column): boolean {
  const type = column.type.replace(/Nullable\s*\(/g, '').replace(/LowCardinality\s*\(/g, '')
  return /^\s*String\s*\)*\s*$/.test(type)
}

function columnsFor(parameter: Parameter): Column[] {
  if (parameter.key.toLowerCase().includes('master')) {
    return props.operation.id === 'fuzzy_match_master'
      ? props.masterColumns.filter(isTextColumn)
      : props.masterColumns
  }
  const textOnly = `${parameter.label} ${parameter.description}`.toLowerCase().includes('teks')
    || props.operation.id === 'trim_text'
    || props.operation.id === 'replace_values'
    || (props.operation.id === 'extract_and_route' && parameter.key === 'targetColumn')
    || ((props.operation.id === 'fill_from_master' || props.operation.id === 'fuzzy_match_master') && /Column$/.test(parameter.key))
  return textOnly ? activeSchema.value.filter(isTextColumn) : activeSchema.value
}

function pairValues(key: string): Pair[] {
  const value = draft[key]
  return Array.isArray(value) ? value as Pair[] : []
}

function addPair(key: string): void {
  if (pairValues(key).length >= 500) return
  draft[key] = [...pairValues(key), { old: '', new: '' }]
  markListDirty(key)
}

function removePair(key: string, index: number): void {
  const next = pairValues(key).filter((_, itemIndex) => itemIndex !== index)
  draft[key] = next.length > 0 ? next : [{ old: '', new: '' }]
  markListDirty(key)
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
  if (props.operation.params.some((p) => p.allowNew)) params.createTarget = draft.createTarget === true
  if (props.operation.id === 'manage_columns') {
    const mode = String(draft.mode ?? '')
    if (mode !== 'drop' && mode !== 'rename') {
      formError.value = 'Tindakan kolom wajib dipilih.'
      return
    }
    params.mode = mode
    if (mode === 'drop') {
      const selectedCols = Array.isArray(draft.columns)
        ? draft.columns.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
        : []
      if (selectedCols.length === 0) {
        formError.value = 'Pilih minimal satu kolom untuk dihapus.'
        return
      }
      if (activeSchema.value.length > 0 && selectedCols.length >= activeSchema.value.length) {
        formError.value = 'Tidak dapat menghapus seluruh kolom hingga tersisa 0 kolom.'
        return
      }
      params.columns = [...selectedCols]
    } else {
      const sourceColumn = String(draft.sourceColumn ?? '').trim()
      const newName = String(draft.newName ?? '').trim()
      if (!sourceColumn) {
        formError.value = 'Kolom sumber wajib dipilih.'
        return
      }
      if (!newName) {
        formError.value = 'Nama kolom baru wajib diisi.'
        return
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(newName)) {
        formError.value = 'Nama kolom baru harus diawali huruf atau garis bawah, maksimal 64 karakter, dan hanya memuat huruf, angka, atau garis bawah.'
        return
      }
      if (newName === sourceColumn) {
        formError.value = 'Nama kolom baru harus berbeda dari nama kolom sumber.'
        return
      }
      if (activeSchema.value.some((col) => col.name === newName)) {
        formError.value = `Nama kolom tujuan "${newName}" sudah dipakai oleh kolom lain yang masih aktif.`
        return
      }
      params.sourceColumn = sourceColumn
      params.newName = newName
    }
    emit('submit', params)
    return
  }
  if (props.operation.id === 'fuzzy_match_master' && draft.routeUnmatched === true && !String(draft.unmatchedColumn ?? '').trim()) {
    formError.value = 'Kolom tujuan nilai tidak cocok wajib dipilih.'
    return
  }
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
    else if (parameter.type === 'pairs') {
      const mode = getPairMode(parameter.key)
      if (mode === 'bulk' && bulkErrors[parameter.key]?.length) {
        formError.value = `Terdapat ${bulkErrors[parameter.key].length} baris tidak valid pada input Tempel teks. Silakan perbaiki atau hapus baris tersebut sebelum melanjutkan.`
        return
      }
      const rawList = pairValues(parameter.key)
      const filtered = rawList.filter((pair) => pair.old.trim() !== '' || pair.new.trim() !== '')
      if (parameter.required && filtered.length === 0) {
        formError.value = `${parameter.label} wajib diisi (minimal satu pasangan lama-baru).`
        return
      }
      if (filtered.length > 500) {
        formError.value = 'Maksimal 500 pasangan nilai per operasi.'
        return
      }
      for (const [index, pair] of filtered.entries()) {
        if (pair.old.length > 200 || pair.new.length > 200) {
          formError.value = `Pasangan ke-${index + 1} terlalu panjang (maksimal 200 karakter).`
          return
        }
      }
      params[parameter.key] = filtered.map((pair) => ({
        old: pair.old,
        new: pair.new,
      }))
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

.pair-container {
  display: grid;
  gap: 8px;
}

.pair-mode-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}

.pair-mode-toggle {
  display: inline-flex;
  padding: 3px;
  background: #edf3f8;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  gap: 3px;
}

.pair-mode-btn {
  padding: 5px 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #526479;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pair-mode-btn:hover {
  color: var(--warna-utama);
}

.pair-mode-btn--active {
  background: #fff;
  color: var(--warna-utama);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  font-weight: 700;
}

.pair-count-pill {
  font-size: 11px;
  font-weight: 650;
  padding: 3px 8px;
  border-radius: 12px;
  background: var(--warna-biru-muda);
  color: var(--warna-utama);
}

.bulk-pair-wrapper {
  display: grid;
  gap: 8px;
}

.bulk-instructions {
  margin: 0;
  font-size: 12px;
  color: var(--warna-redup);
  line-height: 1.5;
}

.bulk-instructions code {
  padding: 1px 5px;
  border-radius: 4px;
  background: #edf3f8;
  color: #2c4257;
  font-size: 11.5px;
}

.bulk-textarea {
  width: 100%;
  min-height: 160px;
  padding: 10px 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12.5px;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
}

.bulk-textarea:focus {
  outline: none;
  border-color: var(--warna-utama);
  box-shadow: 0 0 0 3px rgba(87, 152, 215, 0.15);
}

.bulk-feedback {
  display: grid;
  gap: 6px;
}

.bulk-badge-success {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #1b6d34;
  background: #edf8f0;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid #c2e9cb;
  width: fit-content;
}

.bulk-badge-empty {
  font-size: 12px;
  color: var(--warna-redup);
  padding: 2px 0;
}

.bulk-error-box {
  padding: 8px 10px;
  border: 1px solid #f8b4b4;
  border-radius: 6px;
  background: #fdf2f2;
  color: #9b1c1c;
  font-size: 12px;
  line-height: 1.45;
}

.bulk-error-box strong {
  display: block;
  font-weight: 650;
}

.bulk-error-box ul,
.bulk-warning-box ul {
  margin: 4px 0 0 16px;
  padding: 0;
}

.bulk-warning-box {
  padding: 8px 10px;
  border: 1px solid #f6d289;
  border-radius: 6px;
  background: #fdf8e8;
  color: #8f5c00;
  font-size: 12px;
  line-height: 1.45;
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
