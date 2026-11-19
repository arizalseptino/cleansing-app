import type { OperationDefinition } from '../types'
import { buildFillFromMasterWorkbenchSql } from '../../features/fill-empty-from-master-query'
import {
  requiredParameter,
  validateDatabase,
  validateTable,
  validateTextColumn,
} from '../../features/metadata'
import { ensureTextColumn, safeString } from '../utils'

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
    const sourceColumn = ensureTextColumn(context.schema, safeString(context.params.sourceColumn), 'Kolom sumber teks')
    const targetColumn = ensureTextColumn(context.schema, safeString(context.params.targetColumn), 'Kolom target')
    if (sourceColumn === targetColumn) {
      throw createError({ statusCode: 400, statusMessage: 'Kolom sumber dan target harus berbeda', message: 'Kolom sumber dan target untuk operasi ini tidak boleh sama.' })
    }

    const masterDatabase = requiredParameter(context.params, 'masterDatabase', 'Database master')
    const masterTable = requiredParameter(context.params, 'masterTable', 'Tabel master')
    const masterKeyColumn = requiredParameter(context.params, 'masterKeyColumn', 'Kolom kunci master')
    const rawMasterValue = context.params.masterValueColumn
    if (rawMasterValue !== undefined && rawMasterValue !== null && typeof rawMasterValue !== 'string') {
      throw createError({ statusCode: 400, statusMessage: 'Kolom nilai master tidak valid', message: 'Kolom nilai master harus berupa pilihan kolom teks.' })
    }
    const masterValueColumn = typeof rawMasterValue === 'string' && rawMasterValue.trim()
      ? rawMasterValue.trim()
      : masterKeyColumn

    await validateDatabase(context.client, masterDatabase)
    await validateTable(context.client, masterDatabase, masterTable)
    await Promise.all([
      validateTextColumn(context.client, masterDatabase, masterTable, masterKeyColumn, 'kunci master'),
      ...(masterValueColumn === masterKeyColumn
        ? []
        : [validateTextColumn(context.client, masterDatabase, masterTable, masterValueColumn, 'nilai master')]),
    ])
  },
  async compile(context) {
    const sourceColumn = ensureTextColumn(context.schema, safeString(context.params.sourceColumn), 'Kolom sumber teks')
    const targetColumn = ensureTextColumn(context.schema, safeString(context.params.targetColumn), 'Kolom target')
    const masterDatabase = requiredParameter(context.params, 'masterDatabase', 'Database master')
    const masterTable = requiredParameter(context.params, 'masterTable', 'Tabel master')
    const masterKeyColumn = requiredParameter(context.params, 'masterKeyColumn', 'Kolom kunci master')
    const rawMasterValue = typeof context.params.masterValueColumn === 'string'
      ? context.params.masterValueColumn.trim()
      : ''
    const masterValueColumn = rawMasterValue || masterKeyColumn

    const masterMetadata = await validateTable(context.client, masterDatabase, masterTable)
    const columnSource = context.getColumnSourceSql?.(sourceColumn)
    const sql = buildFillFromMasterWorkbenchSql({
      sourceColumn,
      targetColumn,
      masterDatabase,
      masterTable,
      masterMetadata,
      masterKeyColumn,
      masterValueColumn,
      schemaColumns: context.schema.map((column) => column.name),
      uniqueSourceSql: columnSource ? `(${columnSource.sql})` : undefined,
    })

    return {
      sql,
      params: {},
      touchedColumns: [targetColumn],
      addedColumns: [],
      beforeColumns: [targetColumn],
    }
  },
}

export default fillFromMaster

