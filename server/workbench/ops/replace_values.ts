import type { OperationDefinition } from '../types'
import { ensureTextColumn, quoteIdentifier } from '../utils'

const replaceValues: OperationDefinition = {
  id: 'replace_values',
  name: 'Ganti nilai',
  description: 'Mengganti satu atau beberapa nilai teks dengan nilai baru, dengan opsi case-insensitive dan trim.',
  params: [
    { key: 'column', label: 'Kolom teks', description: 'Kolom teks yang nilai-nya akan diganti.', type: 'column', required: true },
    { key: 'pairs', label: 'Pasangan nilai', description: 'Daftar pasangan lama-baru.', type: 'pairs', required: true },
    { key: 'ignoreCase', label: 'Abaikan huruf besar/kecil', description: 'Jika aktif, pencocokan tidak membedakan huruf besar dan kecil.', type: 'boolean', required: false },
    { key: 'ignoreTrim', label: 'Abaikan spasi di tepi', description: 'Jika aktif, spasi di tepi diabaikan saat membandingkan.', type: 'boolean', required: false },
  ],
  async validate(context) {
    ensureTextColumn(context.schema, String(context.params.column ?? ''), 'Kolom teks')
    const pairs = Array.isArray(context.params.pairs) ? context.params.pairs as Record<string, unknown>[] : []
    if (pairs.length === 0) {
      throw createError({ statusCode: 400, statusMessage: 'Pasangan nilai wajib diisi', message: 'Minimal satu pasangan lama-baru harus diisi untuk operasi ini.' })
    }
    if (pairs.length > 500) {
      throw createError({ statusCode: 400, statusMessage: 'Terlalu banyak pasangan', message: 'Maksimal 500 pasangan nilai per operasi.' })
    }
    for (const [index, pair] of pairs.entries()) {
      const oldValue = typeof pair?.old === 'string' ? pair.old : String(pair?.old ?? '')
      const newValue = typeof pair?.new === 'string' ? pair.new : String(pair?.new ?? '')
      if (oldValue.length > 200 || newValue.length > 200) {
        throw createError({ statusCode: 400, statusMessage: `Pasangan ke-${index + 1} terlalu panjang`, message: 'Setiap nilai lama dan baru maksimal 200 karakter.' })
      }
    }
  },
  async compile(context) {
    const columnName = String(context.params.column ?? '')
    const column = ensureTextColumn(context.schema, columnName, 'Kolom teks')
    const quotedSource = quoteIdentifier(column)
    const pairs = Array.isArray(context.params.pairs) ? context.params.pairs as Record<string, unknown>[] : []
    const ignoreCase = Boolean(context.params.ignoreCase)
    const ignoreTrim = Boolean(context.params.ignoreTrim)

    let expression = quotedSource
    const params: Record<string, unknown> = {}
    const clauses: string[] = []

    for (let index = 0; index < pairs.length; index += 1) {
      const pair = pairs[index] as Record<string, unknown>
      const oldValue = typeof pair.old === 'string' ? pair.old : String(pair.old ?? '')
      const newValue = typeof pair.new === 'string' ? pair.new : String(pair.new ?? '')
      const oldKey = `p${index * 2}`
      const newKey = `p${index * 2 + 1}`
      params[oldKey] = oldValue
      params[newKey] = newValue

      const normalizedCurrent = ignoreTrim ? `trimBoth(ifNull(${quotedSource}, ''))` : `ifNull(${quotedSource}, '')`
      const normalizedOld = ignoreTrim ? `trimBoth({${oldKey}:String})` : `{${oldKey}:String}`
      const compare = ignoreCase ? `lowerUTF8(${normalizedCurrent}) = lowerUTF8(${normalizedOld})` : `${normalizedCurrent} = ${normalizedOld}`
      const replacement = newValue === '' ? 'NULL' : `{${newKey}:String}`
      clauses.push(`WHEN ${compare} THEN ${replacement}`)
    }

    expression = `CASE\n  ${clauses.join('\n  ')}\n  ELSE ${quotedSource}\nEND`

    return {
      sql: `SELECT * REPLACE (${expression} AS ${quotedSource}) FROM __INPUT__`,
      params,
      touchedColumns: [column],
      addedColumns: [],
      beforeColumns: [column],
    }
  },
}

export default replaceValues
