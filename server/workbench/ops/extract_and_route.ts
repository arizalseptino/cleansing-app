import type { OperationDefinition } from '../types'
import { ensureTextColumn, normalizeColumnName, quoteIdentifier } from '../utils'

function fail(message: string): never {
  throw createError({ statusCode: 400, statusMessage: 'Parameter ekstraksi tidak valid', message })
}

function baseType(type: string): string {
  let value = type.trim()
  while (/^(Nullable|LowCardinality)\(/.test(value)) value = value.slice(value.indexOf('(') + 1, -1)
  return value
}

function typeLiteral(type: string): string {
  return `'${type.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

const extractAndRoute: OperationDefinition = {
  id: 'extract_and_route',
  name: 'Ekstrak pola dan pindahkan kolom',
  description: 'Menyalin atau mengekstrak teks yang cocok ke kolom tujuan; baris yang tidak cocok tetap seperti semula.',
  params: [
    { key: 'sourceColumn', label: 'Kolom sumber teks', description: 'Kolom teks yang diperiksa polanya.', type: 'column', required: true },
    { key: 'patternType', label: 'Jenis pola', description: 'Awalan, teks yang terkandung, atau ekspresi reguler RE2.', type: 'select', required: true, options: ['starts_with', 'contains', 'regex'] },
    { key: 'pattern', label: 'Pola', description: 'Pola teks maksimal 200 karakter. Untuk regex digunakan sintaks RE2 ClickHouse.', type: 'text', required: true, maxLength: 200 },
    { key: 'ignoreCase', label: 'Abaikan huruf besar/kecil', description: 'Pencocokan tidak membedakan kapitalisasi.', type: 'boolean', required: false },
    { key: 'action', label: 'Tindakan', description: 'Salin atau pindahkan seluruh nilai, atau ekstrak bagian tertentu.', type: 'select', required: true, options: ['copy', 'move', 'extract'] },
    { key: 'extractPart', label: 'Bagian yang diekstrak', description: 'Untuk pola awalan/teks, pilih sisi pola; untuk regex pilih grup tangkapan.', type: 'select', required: false, defaultValue: 'after', options: ['after', 'before'] },
    { key: 'captureGroup', label: 'Nomor grup tangkapan', description: 'Untuk regex, pilih nomor grup 1 sampai 9.', type: 'number', required: false, defaultValue: 1 },
    { key: 'targetColumn', label: 'Kolom target', description: 'Pilih kolom yang ada atau pilih kolom baru.', type: 'column', required: true, allowNew: true },
    { key: 'newTargetName', label: 'Nama kolom baru', description: 'Nama kolom tujuan jika memilih kolom baru.', type: 'text', required: false },
    { key: 'onlyIfTargetEmpty', label: 'Hanya jika target kosong', description: 'Jika aktif, target yang sudah berisi tidak ditimpa.', type: 'boolean', required: false, defaultValue: true },
    { key: 'clearSourceAfterExtract', label: 'Kosongkan sumber setelah ekstrak', description: 'Hanya berlaku untuk tindakan ekstrak.', type: 'boolean', required: false },
  ],
  async validate(context) {
    if (typeof context.params.sourceColumn !== 'string') fail('Pilih kolom sumber teks.')
    const source = ensureTextColumn(context.schema, String(context.params.sourceColumn ?? ''), 'kolom sumber teks')
    const patternType = String(context.params.patternType ?? '')
    const pattern = typeof context.params.pattern === 'string' ? context.params.pattern : ''
    if (!['starts_with', 'contains', 'regex'].includes(patternType)) fail('Pilih jenis pola yang tersedia.')
    if (!pattern || pattern.length > 200) fail('Pola wajib diisi dan maksimal 200 karakter.')

    const action = String(context.params.action ?? '')
    if (!['copy', 'move', 'extract'].includes(action)) fail('Pilih tindakan yang tersedia.')
    const booleanLabels: Record<string, string> = {
      ignoreCase: 'abaikan kapitalisasi',
      onlyIfTargetEmpty: 'hanya jika target kosong',
      clearSourceAfterExtract: 'kosongkan sumber setelah ekstrak',
    }
    for (const key of Object.keys(booleanLabels)) {
      if (context.params[key] !== undefined && typeof context.params[key] !== 'boolean') {
        fail(`Opsi ${booleanLabels[key]} harus berupa ya atau tidak.`)
      }
    }
    if (action === 'extract') {
      if (patternType === 'regex') {
        const group = Number(context.params.captureGroup)
        if (!Number.isInteger(group) || group < 1 || group > 9) fail('Regex memerlukan nomor grup tangkapan dari 1 sampai 9.')
      } else if (!['after', 'before'].includes(String(context.params.extractPart ?? ''))) {
        fail('Pilih bagian sebelum atau sesudah pola untuk ekstraksi.')
      }
    }

    const createTargetRequested = context.params.createTarget === true
    if (context.params.createTarget !== undefined && typeof context.params.createTarget !== 'boolean') {
      fail('Pilihan membuat kolom baru tidak valid.')
    }
    if (!createTargetRequested && typeof context.params.targetColumn !== 'string') fail('Pilih kolom target.')
    const target = createTargetRequested
      ? normalizeColumnName(String(context.params.newTargetName ?? ''))
      : String(context.params.targetColumn ?? '')
    const metadata = context.schema.find(({ name }) => name === target)
    const reusedFromPreviousExtract = createTargetRequested
      && Boolean(metadata)
      && Boolean(context.extractCreatedColumns?.has(target))
    const createTarget = createTargetRequested && !reusedFromPreviousExtract
    if (createTarget) {
      if (metadata) fail('Nama kolom target baru sudah digunakan.')
    } else {
      if (!metadata) fail('Kolom target tidak ditemukan pada skema pipeline.')
      if (!/String/.test(metadata.type)) fail('Kolom target yang sudah ada harus bertipe teks.')
    }
    if (source === target) fail('Kolom sumber dan target harus berbeda.')

    if (patternType === 'regex') {
      try {
        const result = await context.client.query({
          query: 'SELECT match({sample:String}, {pattern:String}) AS valid',
          query_params: { sample: '', pattern },
          format: 'JSONEachRow',
          clickhouse_settings: { readonly: 1, max_execution_time: 15 },
        })
        await result.json()
      } catch (error) {
        const detail = error && typeof error === 'object' && 'message' in error ? String(error.message) : ''
        if (/regex|regular expression|re2|pattern|parse/i.test(detail)) {
          fail('Pola regex tidak valid menurut sintaks RE2 ClickHouse.')
        }
        throw error
      }
    }
  },
  async compile(context) {
    const sourceColumn = ensureTextColumn(context.schema, String(context.params.sourceColumn ?? ''), 'kolom sumber teks')
    const patternType = String(context.params.patternType)
    const pattern = String(context.params.pattern ?? '')
    const action = String(context.params.action)
    const source = quoteIdentifier(sourceColumn)
    const createTargetRequested = context.params.createTarget === true
    const targetName = createTargetRequested
      ? normalizeColumnName(String(context.params.newTargetName ?? ''))
      : String(context.params.targetColumn ?? '')
    const reusedFromPreviousExtract = createTargetRequested
      && context.schema.some(({ name }) => name === targetName)
      && Boolean(context.extractCreatedColumns?.has(targetName))
    const createTarget = createTargetRequested && !reusedFromPreviousExtract
    const target = quoteIdentifier(targetName)
    const clearSource = action === 'move'
      || (action === 'extract' && context.params.clearSourceAfterExtract === true)
    let sourceValue = source
    let sourceSnapshot = ''
    if (clearSource) {
      sourceSnapshot = '__wb_route_source'
      let suffix = 1
      while (context.schema.some(({ name }) => name === sourceSnapshot) || sourceSnapshot === targetName) {
        sourceSnapshot = `__wb_route_source_${suffix}`
        suffix += 1
      }
      sourceValue = quoteIdentifier(sourceSnapshot)
    }

    const params: Record<string, unknown> = { pattern }
    const ignoreCase = context.params.ignoreCase === true
    let matches: string
    if (patternType === 'regex') {
      const expression = ignoreCase ? `concat('(?i)', {pattern:String})` : '{pattern:String}'
      matches = `match(ifNull(toString(${sourceValue}), ''), ${expression})`
    } else {
      const expression = ignoreCase ? `lowerUTF8({pattern:String})` : '{pattern:String}'
      const sourceExpression = ignoreCase ? `lowerUTF8(ifNull(toString(${sourceValue}), ''))` : `ifNull(toString(${sourceValue}), '')`
      matches = patternType === 'starts_with'
        ? `startsWith(${sourceExpression}, ${expression})`
        : `position(${sourceExpression}, ${expression}) > 0`
    }

    let extracted = sourceValue
    if (action === 'extract') {
      if (patternType === 'regex') {
        extracted = `arrayElement(arrayElement(extractAllGroupsVertical(ifNull(toString(${sourceValue}), ''), ${ignoreCase ? `concat('(?i)', {pattern:String})` : '{pattern:String}'}), 1), ${Number(context.params.captureGroup)})`
      } else {
        const sourceExpression = `ifNull(toString(${sourceValue}), '')`
        const position = patternType === 'starts_with'
          ? '1'
          : ignoreCase
            ? `positionCaseInsensitiveUTF8(${sourceExpression}, {pattern:String})`
            : `position(${sourceExpression}, {pattern:String})`
        const length = `lengthUTF8({pattern:String})`
        if (context.params.extractPart === 'after') {
          extracted = `substring(${sourceExpression}, ${position} + ${length})`
        } else {
          extracted = `substring(${sourceExpression}, 1, ${position} - 1)`
        }
      }
      extracted = `if(${extracted} = '', NULL, ${extracted})`
    }

    const onlyIfEmpty = context.params.onlyIfTargetEmpty !== false
    const targetEmpty = createTarget
      ? '1'
      : `(isNull(${target}) OR trimBoth(ifNull(toString(${target}), '')) = '')`
    const routeCondition = onlyIfEmpty && !createTarget
      ? `(${matches} AND ${targetEmpty})`
      : matches
    const targetValue = `if(${routeCondition}, ${extracted}, ${createTarget ? 'NULL' : target})`

    const replacements: string[] = []
    if (!createTarget) replacements.push(`${targetValue} AS ${target}`)
    if (clearSource) {
      const sourceType = context.schema.find(({ name }) => name === sourceColumn)?.type ?? 'String'
      replacements.push(`if(${routeCondition}, CAST(NULL, ${typeLiteral(`Nullable(${baseType(sourceType)})`)}), ${sourceValue}) AS ${source}`)
    }
    const inputSql = clearSource
      ? `SELECT *, ${source} AS ${quoteIdentifier(sourceSnapshot)} FROM __INPUT__`
      : '__INPUT__'
    const query = clearSource
      ? createTarget
        ? `SELECT * EXCEPT (${quoteIdentifier(sourceSnapshot)}) REPLACE (${replacements.join(', ')}), ${targetValue} AS ${target} FROM (${inputSql})`
        : `SELECT * EXCEPT (${quoteIdentifier(sourceSnapshot)}) REPLACE (${replacements.join(', ')}) FROM (${inputSql})`
      : createTarget
        ? `SELECT *, ${targetValue} AS ${target} FROM ${inputSql}`
        : `SELECT * REPLACE (${replacements.join(', ')}) FROM ${inputSql}`

    return {
      sql: query,
      params,
      touchedColumns: [...new Set([...(createTarget ? [] : [targetName]), ...(clearSource ? [sourceColumn] : [])])],
      addedColumns: createTarget ? [targetName] : [],
      beforeColumns: createTarget ? (clearSource ? [sourceColumn] : []) : [...new Set([targetName, ...(clearSource ? [sourceColumn] : [])])],
    }
  },
}

export default extractAndRoute
