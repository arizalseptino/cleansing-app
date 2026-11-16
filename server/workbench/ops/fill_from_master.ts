import type { OperationDefinition } from '../types'
import { buildFillEmptyPlan } from '../../features/fill-empty-from-master-query'
import { ensureTextColumn, quoteIdentifier } from '../utils'

const fillFromMaster: OperationDefinition = {
  id: 'fill_from_master',
  name: 'Isi kolom kosong dari teks lain berdasarkan tabel master',
  description: 'Mengisi kolom target yang kosong menggunakan kata kunci dari tabel master.',
  params: [
    { key: 'sourceColumn', label: 'Kolom sumber teks', description: 'Kolom sumber yang akan dicari nilainya di master.', type: 'column', required: true },
    { key: 'targetColumn', label: 'Kolom target', description: 'Kolom yang akan diisi jika kosong.', type: 'column', required: true },
    { key: 'masterDatabase', label: 'Database master', description: 'Database yang berisi tabel master.', type: 'table-ref', required: true },
    { key: 'masterTable', label: 'Tabel master', description: 'Tabel master yang digunakan untuk mencari nilai.', type: 'table-ref', required: true },
    { key: 'masterKeyColumn', label: 'Kolom kunci master', description: 'Kolom di tabel master yang digunakan sebagai kunci pencarian.', type: 'column', required: true },
    { key: 'masterValueColumn', label: 'Kolom nilai master', description: 'Kolom master yang dipakai sebagai nilai pengisi. Jika kosong, akan dipakai kunci master.', type: 'column', required: false },
  ],
  async validate(context) {
    const sourceColumn = ensureTextColumn(context.schema, String(context.params.sourceColumn ?? ''), 'Kolom sumber teks')
    const targetColumn = ensureTextColumn(context.schema, String(context.params.targetColumn ?? ''), 'Kolom target')
    if (sourceColumn === targetColumn) {
      throw createError({ statusCode: 400, statusMessage: 'Kolom sumber dan target harus berbeda', message: 'Kolom sumber dan target untuk operasi ini tidak boleh sama.' })
    }
  },
  async compile(context) {
    const sourceColumn = String(context.params.sourceColumn ?? '')
    const targetColumn = String(context.params.targetColumn ?? '')
    const masterDatabase = String(context.params.masterDatabase ?? '')
    const masterTable = String(context.params.masterTable ?? '')
    const masterKeyColumn = String(context.params.masterKeyColumn ?? '')
    const masterValueColumn = String(context.params.masterValueColumn ?? masterKeyColumn)

    const plan = await buildFillEmptyPlan(context.client, {
      sourceDatabase: context.source.database,
      sourceTable: context.source.table,
      sourceColumn,
      targetColumn,
      masterDatabase,
      masterTable,
      masterColumn: masterKeyColumn,
      masterFillColumn: masterValueColumn,
    })

    const targetQuoted = quoteIdentifier(targetColumn)
    const replacement = `if(${quoteIdentifier(plan.aliases.targetEmpty)} AND ${quoteIdentifier(plan.aliases.category)} = 'fillable', ${quoteIdentifier(plan.aliases.suggestion)}, ${targetQuoted})`

    return {
      sql: `SELECT * REPLACE (${replacement} AS ${targetQuoted}) FROM __INPUT__`,
      params: {},
      touchedColumns: [targetColumn],
      addedColumns: [],
      beforeColumns: [targetColumn],
    }
  },
}

export default fillFromMaster
