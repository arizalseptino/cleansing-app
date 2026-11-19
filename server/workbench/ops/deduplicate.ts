import { quoteSortingKey } from '../../features/metadata'
import type { OperationDefinition } from '../types'
import { ensureColumnExists, quoteIdentifier } from '../utils'

function fail(message: string): never {
  throw createError({ statusCode: 400, statusMessage: 'Parameter deduplikasi tidak valid', message })
}

function stringList(value: unknown, label: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(`${label} harus berupa daftar teks.`)
  }
  return value as string[]
}

function emptyValuesFrom(value: unknown): string[] {
  return value === undefined ? ['NULL', '', '-'] : stringList(value, 'Nilai kosong')
}

const deduplicate: OperationDefinition = {
  id: 'deduplicate',
  name: 'Hapus duplikat',
  description: 'Menyisakan satu baris per kombinasi kunci dan mempertahankan baris sesuai kelengkapan atau urutan.',
  changesRowCount: true,
  params: [
    { key: 'keyColumns', label: 'Kolom kunci', description: 'Pilih 1 sampai 5 kolom untuk menentukan baris duplikat.', type: 'columns', required: true },
    { key: 'strategy', label: 'Baris yang dipertahankan', description: 'Paling lengkap memakai jumlah kolom terisi terbanyak; pertama dan terakhir memakai kolom pengurut.', type: 'select', required: true, options: ['most_complete', 'first', 'last'] },
    { key: 'orderColumn', label: 'Kolom pengurut', description: 'Wajib untuk pertama/terakhir; untuk paling lengkap digunakan saat skor kelengkapan sama.', type: 'column', required: false },
    { key: 'emptyValues', label: 'Nilai yang dianggap kosong', description: 'Nilai bawaan: NULL, teks kosong setelah trim, dan tanda -. Isi daftar ini dapat diubah.', type: 'string-list', required: false, defaultValue: ['NULL', '', '-'] },
    { key: 'completenessColumns', label: 'Kolom untuk menghitung kelengkapan', description: 'Jika tidak dipilih, semua kolom selain kolom kunci dihitung.', type: 'columns', required: false },
  ],
  validate(context) {
    const keys = stringList(context.params.keyColumns, 'Kolom kunci')
    if (keys.length < 1 || keys.length > 5) fail('Pilih antara 1 dan 5 kolom kunci.')
    if (new Set(keys).size !== keys.length) fail('Kolom kunci tidak boleh dipilih lebih dari sekali.')
    for (const column of keys) ensureColumnExists(context.schema, column, 'kolom kunci')

    const strategy = String(context.params.strategy ?? '')
    if (!['most_complete', 'first', 'last'].includes(strategy)) fail('Pilih strategi baris yang dipertahankan.')
    const orderColumn = typeof context.params.orderColumn === 'string' ? context.params.orderColumn : ''
    if ((strategy === 'first' || strategy === 'last') && !orderColumn) {
      fail('Kolom pengurut wajib dipilih untuk strategi pertama atau terakhir.')
    }
    if (orderColumn) ensureColumnExists(context.schema, orderColumn, 'kolom pengurut')

    const completeness = stringList(context.params.completenessColumns, 'Kolom kelengkapan')
    if (new Set(completeness).size !== completeness.length) fail('Kolom kelengkapan tidak boleh dipilih lebih dari sekali.')
    for (const column of completeness) ensureColumnExists(context.schema, column, 'kolom kelengkapan')

    const emptyValues = emptyValuesFrom(context.params.emptyValues)
    if (emptyValues.length > 50 || emptyValues.some((value) => value.length > 200)) {
      fail('Daftar nilai kosong maksimal 50 nilai dengan panjang maksimal 200 karakter per nilai.')
    }
  },
  async compile(context) {
    const keyColumns = stringList(context.params.keyColumns, 'Kolom kunci')
    const strategy = String(context.params.strategy)
    const orderColumn = typeof context.params.orderColumn === 'string' ? context.params.orderColumn : ''
    const selectedCompleteness = stringList(context.params.completenessColumns, 'Kolom kelengkapan')
    const completenessColumns = selectedCompleteness.length
      ? selectedCompleteness
      : context.schema.map(({ name }) => name).filter((name) => !keyColumns.includes(name) && !name.startsWith('__sumber_'))
    const emptyValues = emptyValuesFrom(context.params.emptyValues)
    const scoreAliasBase = '__wb_dedup_score'
    let scoreAlias = scoreAliasBase
    let suffix = 1
    while (context.schema.some(({ name }) => name === scoreAlias)) {
      scoreAlias = `${scoreAliasBase}_${suffix}`
      suffix += 1
    }

    const emptyParams: Record<string, unknown> = {
      emptyValues: emptyValues.filter((value) => value !== 'NULL'),
    }
    const emptyColumn = (column: string): string => {
      const quoted = quoteIdentifier(column)
      const emptyChecks: string[] = []
      if (emptyValues.includes('NULL')) emptyChecks.push(`isNull(${quoted})`)
      const textValues = emptyValues.filter((value) => value !== 'NULL')
      if (textValues.length) {
        emptyChecks.push(`(NOT isNull(${quoted}) AND trimBoth(ifNull(toString(${quoted}), '')) IN ({emptyValues:Array(String)}))`)
      }
      return emptyChecks.length ? `(${emptyChecks.join(' OR ')})` : '0'
    }
    const score = completenessColumns.length
      ? completenessColumns.map((column) => `if(${emptyColumn(column)}, 0, 1)`).join(' + ')
      : '0'
    const allKeysNull = keyColumns.map((column) => `isNull(${quoteIdentifier(column)})`).join(' AND ')
    const sortingKey = quoteSortingKey(context.metadata.sorting_key, context.schema)
    const sortParts: string[] = []
    if (orderColumn) {
      sortParts.push(`${quoteIdentifier(orderColumn)} ${strategy === 'last' ? 'DESC' : 'ASC'}`)
    }
    if (sortingKey.expression && !/^tuple\(\)$/i.test(sortingKey.expression.trim())) {
      sortParts.push(sortingKey.expression)
    }
    const orderParts = strategy === 'most_complete'
      ? [`${quoteIdentifier(scoreAlias)} DESC`, ...sortParts]
      : sortParts
    const warnings = sortingKey.expression && !/^tuple\(\)$/i.test(sortingKey.expression.trim())
      ? []
      : ['Urutan seri tidak dijamin karena tabel sumber tidak memiliki sorting key.']

    return {
      sql: `SELECT * EXCEPT (${quoteIdentifier(scoreAlias)}) FROM (
  SELECT *, (${score}) AS ${quoteIdentifier(scoreAlias)}
  FROM __INPUT__
  WHERE NOT (${allKeysNull})
  ORDER BY ${orderParts.join(', ')}
  LIMIT 1 BY ${keyColumns.map(quoteIdentifier).join(', ')}
)
UNION ALL
SELECT * FROM __INPUT__ WHERE ${allKeysNull}`,
      params: emptyParams,
      touchedColumns: [],
      addedColumns: [],
      beforeColumns: [],
      warnings,
    }
  },
}

export default deduplicate
