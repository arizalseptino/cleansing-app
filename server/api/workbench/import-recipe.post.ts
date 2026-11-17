import { randomUUID } from 'node:crypto'
import { compilePipeline } from '../../workbench/compiler'
import { operations } from '../../workbench/ops'
import type { OperationParamDefinition, PipelineStep, SourceReference } from '../../workbench/types'
import { getTableMetadata } from '../../workbench/utils'

const MAX_RECIPE_BYTES = 1024 * 1024 // 1 MB
const MAX_STEPS = 50
const ALLOWED_ENGINES = new Set(['MergeTree', 'ReplacingMergeTree'])
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function reject(statusCode: number, statusMessage: string, message: string): never {
  throw createError({ statusCode, statusMessage, message })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (isPlainObject(value)) {
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(k)) continue
      clean[k] = sanitizeValue(v)
    }
    return clean
  }
  return value
}

function validateParamValue(
  stepLabel: string,
  def: OperationParamDefinition,
  value: unknown,
  rawParams: Record<string, unknown>,
  opId: string,
): unknown {
  const label = `${stepLabel}: Parameter "${def.label}" (${def.key})`
  if (value === undefined || value === null) {
    if (def.key === 'targetColumn' && def.allowNew && rawParams.createTarget === true) {
      return ''
    }
    if (opId === 'extract_and_route' && (def.key === 'extractPart' || def.key === 'captureGroup')) {
      return def.defaultValue ?? (def.type === 'number' ? 1 : '')
    }
    if (def.required) {
      reject(400, 'Parameter wajib kosong', `${label} wajib diisi.`)
    }
    return def.defaultValue !== undefined ? sanitizeValue(def.defaultValue) : undefined
  }

  switch (def.type) {
    case 'column':
    case 'table-ref': {
      if (typeof value !== 'string' || value.length > 256) {
        reject(400, 'Parameter kolom tidak valid', `${label} harus berupa teks nama yang valid (maksimal 256 karakter).`)
      }
      return value
    }
    case 'text': {
      const maxLen = def.maxLength ?? 2000
      if (typeof value !== 'string' || value.length > maxLen) {
        reject(400, 'Parameter teks tidak valid', `${label} harus berupa teks maksimal ${maxLen} karakter.`)
      }
      return value
    }
    case 'number': {
      if (value === '') return ''
      const num = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(num)) {
        reject(400, 'Parameter angka tidak valid', `${label} harus berupa angka yang valid.`)
      }
      if (def.min !== undefined && num < def.min) {
        reject(400, 'Parameter angka terlalu kecil', `${label} minimal bernilai ${def.min}.`)
      }
      if (def.max !== undefined && num > def.max) {
        reject(400, 'Parameter angka terlalu besar', `${label} maksimal bernilai ${def.max}.`)
      }
      return num
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        reject(400, 'Parameter boolean tidak valid', `${label} harus berupa pilihan ya/tidak (boolean).`)
      }
      return value
    }
    case 'select': {
      if (typeof value !== 'string') {
        reject(400, 'Pilihan tidak valid', `${label} harus berupa teks pilihan.`)
      }
      if (value !== '' && def.options && !def.options.includes(value)) {
        reject(400, 'Pilihan tidak dikenal', `${label} berisi pilihan "${value}" yang tidak didukung.`)
      }
      return value
    }
    case 'multiselect': {
      if (!Array.isArray(value) || value.length > 30 || value.some((item) => typeof item !== 'string')) {
        reject(400, 'Daftar pilihan tidak valid', `${label} harus berupa daftar teks pilihan.`)
      }
      if (def.required && value.length === 0) {
        reject(400, 'Pilihan wajib diisi', `${label} minimal harus memilih 1 opsi.`)
      }
      if (def.options) {
        for (const item of value) {
          if (!def.options.includes(item)) {
            reject(400, 'Pilihan tidak dikenal', `${label} berisi opsi "${item}" yang tidak dikenal.`)
          }
        }
      }
      return [...value]
    }
    case 'columns': {
      if (!Array.isArray(value) || value.length > 50 || value.some((item) => typeof item !== 'string' || item.length > 256)) {
        reject(400, 'Daftar kolom tidak valid', `${label} harus berupa daftar nama kolom (maksimal 50 kolom).`)
      }
      if (def.required && value.length === 0) {
        reject(400, 'Daftar kolom wajib diisi', `${label} minimal harus memilih 1 kolom.`)
      }
      return [...value]
    }
    case 'string-list': {
      if (!Array.isArray(value) || value.length > 50 || value.some((item) => typeof item !== 'string' || item.length > 200)) {
        reject(400, 'Daftar teks tidak valid', `${label} maksimal berisi 50 nilai teks (maksimal 200 karakter per nilai).`)
      }
      return [...value]
    }
    case 'pairs': {
      if (!Array.isArray(value) || value.length > 500) {
        reject(400, 'Pasangan nilai melebihi batas', `${label} harus berupa daftar pasangan maksimal 500 entri.`)
      }
      if (def.required && value.length === 0) {
        reject(400, 'Pasangan nilai kosong', `${label} minimal harus berisi 1 pasangan nilai.`)
      }
      return value.map((pair, idx) => {
        if (!isPlainObject(pair)) {
          reject(400, 'Format pasangan tidak valid', `${label}: pasangan ke-${idx + 1} harus berupa objek { old, new }.`)
        }
        const oldVal = typeof pair.old === 'string' ? pair.old : ''
        const newVal = typeof pair.new === 'string' ? pair.new : ''
        if (typeof pair.old !== 'string' || (pair.new !== undefined && typeof pair.new !== 'string')) {
          reject(400, 'Nilai pasangan tidak valid', `${label}: pasangan ke-${idx + 1} harus memiliki teks old dan new.`)
        }
        if (oldVal.length > 200 || newVal.length > 200) {
          reject(400, 'Pasangan terlalu panjang', `${label}: nilai pada pasangan ke-${idx + 1} maksimal 200 karakter.`)
        }
        return { old: oldVal, new: newVal }
      })
    }
    case 'rules': {
      if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
        reject(400, 'Daftar aturan tidak valid', `${label} harus berisi 1 sampai 20 aturan bersyarat.`)
      }
      const allowedOps = new Set(['equals', 'not_equals', 'contains', 'starts_with', 'empty', 'not_empty', 'in'])
      const allowedActions = new Set(['set_value', 'set_null', 'copy_column'])
      return value.map((rule, rIdx) => {
        if (!isPlainObject(rule)) {
          reject(400, 'Format aturan tidak valid', `${label}: aturan ke-${rIdx + 1} tidak valid.`)
        }
        if (!Array.isArray(rule.conditions) || rule.conditions.length < 1 || rule.conditions.length > 3) {
          reject(400, 'Kondisi aturan tidak valid', `${label}: aturan ke-${rIdx + 1} harus memiliki 1 sampai 3 kondisi.`)
        }
        const conditions = rule.conditions.map((cond, cIdx) => {
          if (!isPlainObject(cond)) {
            reject(400, 'Format kondisi tidak valid', `${label}: kondisi ${cIdx + 1} aturan ${rIdx + 1} tidak valid.`)
          }
          const operator = String(cond.operator ?? '')
          if (!allowedOps.has(operator)) {
            reject(400, 'Operator tidak dikenal', `${label}: operator "${operator}" pada aturan ${rIdx + 1} tidak dikenal.`)
          }
          if (typeof cond.column !== 'string' || cond.column.length > 256) {
            reject(400, 'Kolom kondisi tidak valid', `${label}: kolom pada kondisi ${cIdx + 1} aturan ${rIdx + 1} harus berupa teks.`)
          }
          if (cond.ignoreCase !== undefined && typeof cond.ignoreCase !== 'boolean') {
            reject(400, 'Opsi kapitalisasi tidak valid', `${label}: opsi ignoreCase harus berupa boolean.`)
          }
          if (cond.ignoreTrim !== undefined && typeof cond.ignoreTrim !== 'boolean') {
            reject(400, 'Opsi spasi tidak valid', `${label}: opsi ignoreTrim harus berupa boolean.`)
          }
          if (operator === 'in') {
            if (!Array.isArray(cond.values) || cond.values.length < 1 || cond.values.length > 100
              || cond.values.some((v) => typeof v !== 'string' || v.length > 200)) {
              reject(400, 'Daftar nilai kondisi tidak valid', `${label}: operator daftar pada aturan ${rIdx + 1} memerlukan 1..100 teks (maksimal 200 karakter).`)
            }
          } else if (operator !== 'empty' && operator !== 'not_empty') {
            if ((typeof cond.value !== 'string' && typeof cond.value !== 'number') || String(cond.value).length > 200) {
              reject(400, 'Nilai kondisi tidak valid', `${label}: nilai pembanding pada aturan ${rIdx + 1} maksimal 200 karakter.`)
            }
          }
          return {
            column: cond.column,
            operator,
            value: cond.value !== undefined ? String(cond.value) : '',
            values: Array.isArray(cond.values) ? cond.values.map(String) : [''],
            ignoreCase: Boolean(cond.ignoreCase),
            ignoreTrim: Boolean(cond.ignoreTrim),
          }
        })

        const action = String(rule.action ?? '')
        if (!allowedActions.has(action)) {
          reject(400, 'Tindakan aturan tidak dikenal', `${label}: tindakan "${action}" pada aturan ${rIdx + 1} tidak dikenal.`)
        }
        if (typeof rule.targetColumn !== 'string' || rule.targetColumn.length > 256) {
          reject(400, 'Kolom target tidak valid', `${label}: kolom target pada aturan ${rIdx + 1} tidak valid.`)
        }
        if (action === 'set_value') {
          if ((typeof rule.value !== 'string' && typeof rule.value !== 'number') || String(rule.value).length > 2000) {
            reject(400, 'Nilai aturan tidak valid', `${label}: nilai aturan ${rIdx + 1} harus berupa teks/angka maksimal 2.000 karakter.`)
          }
        }
        if (action === 'copy_column' && (typeof rule.sourceColumn !== 'string' || rule.sourceColumn.length > 256)) {
          reject(400, 'Kolom salinan tidak valid', `${label}: kolom salinan pada aturan ${rIdx + 1} tidak valid.`)
        }
        return {
          conditions,
          targetColumn: rule.targetColumn,
          action,
          value: rule.value !== undefined ? String(rule.value) : '',
          sourceColumn: typeof rule.sourceColumn === 'string' ? rule.sourceColumn : '',
        }
      })
    }
  }
}

export default defineEventHandler(async (event) => {
  const contentLength = Number(getHeader(event, 'content-length') ?? 0)
  if (contentLength > MAX_RECIPE_BYTES + 262_144) {
    reject(413, 'Ukuran file terlalu besar', 'Ukuran file resep melebihi batas maksimal 1 MB.')
  }

  let rawBody: unknown
  try {
    rawBody = await readBody(event)
  } catch {
    reject(400, 'Payload tidak valid', 'Permintaan impor resep tidak dapat dibaca.')
  }

  let rawJson = ''
  if (typeof rawBody === 'string') {
    rawJson = rawBody
  } else if (isPlainObject(rawBody) && typeof rawBody.rawJson === 'string') {
    rawJson = rawBody.rawJson
  } else {
    reject(400, 'Payload tidak valid', 'Kirim isi file resep dalam format teks JSON (rawJson).')
  }

  const byteSize = Buffer.byteLength(rawJson, 'utf8')
  if (byteSize === 0) {
    reject(400, 'File resep kosong', 'File resep kosong dan tidak memiliki data JSON.')
  }
  if (byteSize > MAX_RECIPE_BYTES) {
    reject(400, 'Ukuran file melebihi batas', 'Ukuran file resep melebihi batas maksimal 1 MB.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    reject(400, 'JSON tidak valid', 'Isi file bukan JSON yang valid atau struktur JSON rusak.')
  }

  if (!isPlainObject(parsed)) {
    reject(400, 'Struktur resep tidak valid', 'Isi file resep harus berupa objek JSON.')
  }

  if (parsed.version !== 1) {
    reject(
      400,
      'Versi format tidak didukung',
      `Versi format resep "${String(parsed.version ?? 'tidak ada')}" tidak didukung. Hanya versi 1 yang didukung.`,
    )
  }

  const recipeName = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  if (!recipeName || recipeName.length > 120) {
    reject(400, 'Nama resep tidak valid', 'Nama resep wajib berupa teks (1 sampai 120 karakter).')
  }

  const createdAt = typeof parsed.createdAt === 'string' ? parsed.createdAt.slice(0, 64) : ''

  let suggestedSource: { database: string; table: string } | null = null
  if (parsed.suggestedSource !== undefined && parsed.suggestedSource !== null) {
    if (!isPlainObject(parsed.suggestedSource)) {
      reject(400, 'Saran sumber tidak valid', 'Bagian suggestedSource harus berupa objek { database, table }.')
    }
    const db = typeof parsed.suggestedSource.database === 'string' ? parsed.suggestedSource.database.slice(0, 128) : ''
    const tbl = typeof parsed.suggestedSource.table === 'string' ? parsed.suggestedSource.table.slice(0, 128) : ''
    if (db || tbl) suggestedSource = { database: db, table: tbl }
  }

  let saveOptions = {
    engine: 'MergeTree' as 'MergeTree' | 'ReplacingMergeTree',
    orderBy: [] as string[],
    saveOriginal: false,
  }
  if (parsed.saveOptions !== undefined && parsed.saveOptions !== null) {
    if (!isPlainObject(parsed.saveOptions)) {
      reject(400, 'Opsi simpan tidak valid', 'Bagian saveOptions harus berupa objek.')
    }
    const engine = parsed.saveOptions.engine === undefined ? 'MergeTree' : String(parsed.saveOptions.engine)
    if (!ALLOWED_ENGINES.has(engine)) {
      reject(400, 'Engine simpan tidak valid', 'Engine pada opsi simpan hanya mendukung MergeTree atau ReplacingMergeTree.')
    }
    const orderByRaw = parsed.saveOptions.orderBy === undefined ? [] : parsed.saveOptions.orderBy
    if (!Array.isArray(orderByRaw) || orderByRaw.length > 1 || orderByRaw.some((c) => typeof c !== 'string' || c.length > 128)) {
      reject(400, 'ORDER BY tidak valid', 'Opsi orderBy maksimal berisi satu nama kolom teks.')
    }
    const saveOriginalRaw = parsed.saveOptions.saveOriginal === undefined ? false : parsed.saveOptions.saveOriginal
    if (typeof saveOriginalRaw !== 'boolean') {
      reject(400, 'Opsi simpan nilai asli tidak valid', 'Opsi saveOriginal harus berupa boolean.')
    }
    saveOptions = {
      engine: engine as 'MergeTree' | 'ReplacingMergeTree',
      orderBy: [...orderByRaw],
      saveOriginal: saveOriginalRaw,
    }
  }

  if (!Array.isArray(parsed.steps)) {
    reject(400, 'Daftar langkah tidak valid', 'Resep wajib memiliki daftar langkah (steps) berupa array.')
  }
  if (parsed.steps.length > MAX_STEPS) {
    reject(400, 'Terlalu banyak langkah', `Jumlah langkah dalam resep (${parsed.steps.length}) melebihi batas maksimal ${MAX_STEPS} langkah.`)
  }

  const sanitizedSteps: Array<PipelineStep & { id: string }> = parsed.steps.map((rawStep, index) => {
    const stepLabel = `Langkah ${index + 1}`
    if (!isPlainObject(rawStep)) {
      reject(400, 'Format langkah tidak valid', `${stepLabel} harus berupa objek dengan op dan params.`)
    }
    const op = typeof rawStep.op === 'string' ? rawStep.op : ''
    if (!op || !Object.prototype.hasOwnProperty.call(operations, op)) {
      reject(400, 'Operasi tidak dikenal', `${stepLabel}: Operasi "${String(rawStep.op ?? '')}" tidak dikenal.`)
    }
    const opDef = operations[op]
    const rawParams = rawStep.params === undefined ? {} : rawStep.params
    if (!isPlainObject(rawParams)) {
      reject(400, 'Parameter langkah tidak valid', `${stepLabel}: Parameter langkah harus berupa objek.`)
    }

    const allowedKeys = new Set(opDef.params.map((p) => p.key))
    const supportsCreateTarget = opDef.params.some((p) => p.allowNew)
    if (supportsCreateTarget) allowedKeys.add('createTarget')

    for (const key of Object.keys(rawParams)) {
      if (DANGEROUS_KEYS.has(key)) continue
      if (!allowedKeys.has(key)) {
        reject(400, 'Parameter tidak dikenal', `${stepLabel}: Parameter "${key}" tidak dikenal pada operasi "${opDef.name}".`)
      }
    }

    const cleanParams: Record<string, unknown> = {}
    if (supportsCreateTarget && rawParams.createTarget !== undefined) {
      if (typeof rawParams.createTarget !== 'boolean') {
        reject(400, 'Parameter createTarget tidak valid', `${stepLabel}: Parameter createTarget harus berupa boolean.`)
      }
      cleanParams.createTarget = rawParams.createTarget
    }

    for (const paramDef of opDef.params) {
      const validated = validateParamValue(stepLabel, paramDef, rawParams[paramDef.key], rawParams, op)
      if (validated !== undefined) {
        cleanParams[paramDef.key] = validated
      }
    }

    return {
      id: `step-${Date.now()}-${index}-${randomUUID().slice(0, 8)}`,
      op,
      params: cleanParams,
    }
  })

  const stepStatuses: Array<{ index: number; valid: boolean; error?: string; warnings?: string[] }> = []
  let validCount = 0
  let invalidCount = 0

  const bodySource = isPlainObject(rawBody) && isPlainObject(rawBody.source)
    ? rawBody.source as Partial<SourceReference>
    : null

  if (bodySource?.database && bodySource?.table) {
    const source: SourceReference = { database: String(bodySource.database), table: String(bodySource.table) }
    const client = useClickHouse()
    await getTableMetadata(client, source)

    const validPrefix: PipelineStep[] = []
    for (let i = 0; i < sanitizedSteps.length; i += 1) {
      const step = sanitizedSteps[i]
      try {
        const compiled = await compilePipeline(client, {
          source,
          steps: [...validPrefix, step],
        })
        validPrefix.push(step)
        validCount += 1
        stepStatuses.push({
          index: i,
          valid: true,
          warnings: compiled.stepSchemas[compiled.stepSchemas.length - 1]?.warnings ?? [],
        })
      } catch (error) {
        invalidCount += 1
        const rawMsg = error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: string }).message)
          : 'Langkah tidak valid terhadap skema tabel sumber saat ini.'
        const stepPrefix = `Langkah ${validPrefix.length + 1}: `
        const cleanedMsg = rawMsg.startsWith(stepPrefix) ? rawMsg.slice(stepPrefix.length) : rawMsg
        stepStatuses.push({
          index: i,
          valid: false,
          error: `Langkah ${i + 1}: ${cleanedMsg}`,
        })
      }
    }
  } else {
    for (let i = 0; i < sanitizedSteps.length; i += 1) {
      invalidCount += 1
      stepStatuses.push({
        index: i,
        valid: false,
        error: 'Pilih database dan tabel sumber untuk memvalidasi langkah resep.',
      })
    }
  }

  return {
    recipe: {
      version: 1,
      name: recipeName,
      createdAt,
      suggestedSource,
      saveOptions,
    },
    steps: sanitizedSteps,
    stepStatuses,
    summary: {
      total: sanitizedSteps.length,
      valid: validCount,
      invalid: invalidCount,
    },
  }
})
