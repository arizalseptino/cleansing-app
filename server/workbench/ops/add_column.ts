import type { OperationDefinition } from '../types'
import { ensureColumnExists, normalizeColumnName, quoteIdentifier } from '../utils'

const addColumn: OperationDefinition = {
  id: 'add_column',
  name: 'Tambah kolom',
  description: 'Menambahkan kolom baru berdasarkan konstanta, urutan, atau gabungan kolom lain.',
  params: [
    { key: 'name', label: 'Nama kolom baru', description: 'Nama kolom yang akan dibuat.', type: 'text', required: true },
    { key: 'kind', label: 'Jenis isi', description: 'Jenis nilai yang akan diisi pada kolom baru.', type: 'select', required: true, options: ['constant_text', 'constant_number', 'sequence', 'combine'] },
    { key: 'value', label: 'Nilai tetap', description: 'Nilai tetap untuk jenis konstanta.', type: 'text', required: false },
    { key: 'orderColumn', label: 'Kolom pengurut', description: 'Kolom yang dipakai untuk urutan sementara pada mode nomor urut.', type: 'column', required: false },
    { key: 'columns', label: 'Kolom gabungan', description: 'Kolom yang digabungkan untuk mode gabungan.', type: 'columns', required: false },
    { key: 'separator', label: 'Pemisah', description: 'Pemisah untuk gabungan kolom.', type: 'text', required: false },
  ],
  async validate(context) {
    const rawName = String(context.params.name ?? '').trim()
    const name = normalizeColumnName(rawName)
    if (context.schema.some((column) => column.name === name)) {
      throw createError({ statusCode: 409, statusMessage: 'Kolom sudah ada', message: `Kolom ${name} sudah ada pada tabel sumber; pilih nama yang unik.` })
    }

    const kind = String(context.params.kind ?? '')
    if (kind === 'sequence' && !context.params.orderColumn) {
      throw createError({ statusCode: 400, statusMessage: 'Kolom pengurut wajib dipilih', message: 'Mode nomor urut memerlukan kolom pengurut yang valid.' })
    }
    if (kind === 'sequence') {
      ensureColumnExists(context.schema, String(context.params.orderColumn ?? ''), 'Kolom pengurut')
    }
    if (kind === 'combine') {
      const columns = Array.isArray(context.params.columns) ? context.params.columns as string[] : []
      if (!columns.length) {
        throw createError({ statusCode: 400, statusMessage: 'Kolom gabungan wajib dipilih', message: 'Mode gabungan memerlukan setidaknya satu kolom sumber.' })
      }
      for (const column of columns) {
        ensureColumnExists(context.schema, String(column), 'Kolom gabungan')
      }
    }
  },
  async compile(context) {
    const name = normalizeColumnName(String(context.params.name ?? ''))
    const kind = String(context.params.kind ?? '')
    const quotedName = quoteIdentifier(name)
    const params: Record<string, unknown> = {}

    let expression = 'NULL'
    if (kind === 'constant_text') {
      const value = String(context.params.value ?? '')
      params.p0 = value
      expression = '{p0:String}'
    }
    if (kind === 'constant_number') {
      const value = Number(context.params.value ?? 0)
      params.p0 = value
      expression = '{p0:Float64}'
    }
    if (kind === 'sequence') {
      const orderColumn = ensureColumnExists(context.schema, String(context.params.orderColumn ?? ''), 'Kolom pengurut')
      const quotedOrderColumn = quoteIdentifier(orderColumn)
      expression = `rowNumberInAllBlocks() OVER (ORDER BY ${quotedOrderColumn})`
    }
    if (kind === 'combine') {
      const columns = Array.isArray(context.params.columns) ? context.params.columns as string[] : []
      const separator = String(context.params.separator ?? ' ')
      const parts = columns.map((column) => {
        const quotedColumn = quoteIdentifier(String(column))
        return `ifNull(${quotedColumn}, '')`
      })
      params.p0 = separator
      expression = `arrayStringConcat(arrayMap(x -> x, [${parts.join(', ')}]), {p0:String})`
    }

    return {
      sql: `SELECT *, ${expression} AS ${quotedName} FROM __INPUT__`,
      params,
      touchedColumns: [],
      addedColumns: [name],
      beforeColumns: [],
    }
  },
}

export default addColumn
