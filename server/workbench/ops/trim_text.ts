import type { OperationDefinition } from '../types'
import { ensureTextColumn, quoteIdentifier } from '../utils'

const trimText: OperationDefinition = {
  id: 'trim_text',
  name: 'Rapikan teks',
  description: 'Menghapus spasi, merapikan kapitalisasi, dan mengubah string kosong menjadi NULL.',
  params: [
    {
      key: 'column',
      label: 'Kolom teks',
      description: 'Kolom teks yang akan dirapikan.',
      type: 'column',
      required: true,
    },
    {
      key: 'operations',
      label: 'Operasi',
      description: 'Urutan operasi yang berlaku pada kolom.',
      type: 'multiselect',
      required: true,
      options: ['trim', 'collapse_spaces', 'empty_to_null', 'upper', 'lower', 'title'],
    },
  ],
  async validate(context) {
    ensureTextColumn(context.schema, String(context.params.column ?? ''), 'Kolom teks')
  },
  async compile(context) {
    const sourceColumn = String(context.params.column ?? '')
    const column = ensureTextColumn(context.schema, sourceColumn, 'Kolom teks')
    const quoted = quoteIdentifier(column)
    const operationsList = Array.isArray(context.params.operations) ? context.params.operations as string[] : []
    const operationSet = new Set(operationsList.map((value) => String(value)))

    let expr = quoted
    if (operationSet.has('trim')) expr = `trimBoth(${expr})`
    if (operationSet.has('collapse_spaces')) expr = `replaceRegexpAll(${expr}, '\\s+', ' ')`
    if (operationSet.has('empty_to_null')) expr = `if(trimBoth(ifNull(${expr}, '')) = '', NULL, ${expr})`
    if (operationSet.has('upper')) expr = `upperUTF8(${expr})`
    if (operationSet.has('lower')) expr = `lowerUTF8(${expr})`
    if (operationSet.has('title')) expr = `initcap(${expr})`

    return {
      sql: `SELECT * REPLACE (${expr} AS ${quoted}) FROM __INPUT__`,
      params: {},
      touchedColumns: [column],
      addedColumns: [],
      beforeColumns: [column],
    }
  },
}

export default trimText
