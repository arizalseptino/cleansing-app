import type { ColumnMetadata, OperationContext, OperationDefinition } from '../types'
import { ensureColumnExists, normalizeColumnName, quoteIdentifier } from '../utils'

type ManageColumnsMode = 'drop' | 'rename'

type ParsedManageColumns =
  | {
      mode: 'drop'
      columns: string[]
    }
  | {
      mode: 'rename'
      sourceColumn: string
      newName: string
    }

function fail(message: string, statusCode = 400): never {
  throw createError({
    statusCode,
    statusMessage: 'Parameter kelola kolom tidak valid',
    message,
  })
}

function getActiveSchema(schema: ColumnMetadata[]): ColumnMetadata[] {
  return schema.filter((col) => !col.name.startsWith('__sumber_') && !col.name.startsWith('__sebelum_'))
}

export function parseManageColumnsParams(
  context: Pick<OperationContext, 'schema' | 'params'>,
): ParsedManageColumns {
  const mode = typeof context.params.mode === 'string' ? context.params.mode.trim() : ''
  if (mode !== 'drop' && mode !== 'rename') {
    fail('Pilih tindakan pengelolaan kolom: Hapus kolom (drop) atau Ubah nama kolom (rename).')
  }

  const activeSchema = getActiveSchema(context.schema)

  if (mode === 'drop') {
    const rawColumns = context.params.columns
    if (!Array.isArray(rawColumns) || rawColumns.some((item) => typeof item !== 'string')) {
      fail('Daftar kolom yang dihapus harus berupa daftar nama kolom yang valid.')
    }
    const columns = rawColumns.map((col) => col.trim())
    if (columns.length === 0) {
      fail('Pilih minimal satu kolom untuk dihapus.')
    }
    if (columns.some((col) => !col)) {
      fail('Nama kolom yang akan dihapus tidak boleh kosong.')
    }
    if (new Set(columns).size !== columns.length) {
      fail('Kolom yang dihapus tidak boleh dipilih lebih dari sekali.')
    }
    for (const column of columns) {
      ensureColumnExists(activeSchema, column, 'yang akan dihapus')
    }
    const remainingCount = activeSchema.filter((col) => !columns.includes(col.name)).length
    if (remainingCount === 0) {
      fail('Tidak dapat menghapus seluruh kolom hingga tersisa 0 kolom. Minimal satu kolom harus dipertahankan.')
    }
    return {
      mode: 'drop',
      columns,
    }
  }

  const rawSource = typeof context.params.sourceColumn === 'string' ? context.params.sourceColumn.trim() : ''
  if (!rawSource) {
    fail('Pilih kolom sumber yang namanya akan diubah.')
  }
  const sourceColumn = ensureColumnExists(activeSchema, rawSource, 'sumber')
  const newName = normalizeColumnName(context.params.newName)

  if (newName.startsWith('__sumber_') || newName.startsWith('__sebelum_')) {
    fail('Nama kolom tujuan tidak boleh menggunakan awalan cadangan pipeline.')
  }
  if (newName === sourceColumn) {
    fail('Nama kolom baru harus berbeda dari nama kolom sumber.')
  }
  if (activeSchema.some((col) => col.name === newName)) {
    fail(`Nama kolom tujuan "${newName}" sudah dipakai oleh kolom lain yang masih aktif pada langkah ini.`, 409)
  }

  return {
    mode: 'rename',
    sourceColumn,
    newName,
  }
}

const manageColumns: OperationDefinition = {
  id: 'manage_columns',
  name: 'Kelola kolom (Hapus / Ubah nama)',
  description: 'Menghapus satu atau beberapa kolom bantu, atau mengubah nama satu kolom ke nama baru yang valid.',
  params: [
    {
      key: 'mode',
      label: 'Tindakan kolom',
      description: 'Pilih untuk menghapus kolom yang dipilih atau mengubah nama satu kolom.',
      type: 'select',
      required: true,
      defaultValue: 'drop',
      options: ['drop', 'rename'],
    },
    {
      key: 'columns',
      label: 'Kolom yang dihapus',
      description: 'Pilih satu atau beberapa kolom yang akan dihapus dari skema langkah berikutnya.',
      type: 'columns',
      required: false,
    },
    {
      key: 'sourceColumn',
      label: 'Kolom sumber',
      description: 'Pilih kolom yang namanya akan diubah.',
      type: 'column',
      required: false,
    },
    {
      key: 'newName',
      label: 'Nama kolom baru',
      description: 'Nama kolom baru harus diawali huruf atau garis bawah, maksimal 64 karakter, dan hanya memuat huruf, angka, dan garis bawah.',
      type: 'text',
      required: false,
      maxLength: 64,
    },
  ],
  validate(context) {
    parseManageColumnsParams(context)
  },
  async compile(context) {
    const parsed = parseManageColumnsParams(context)

    if (parsed.mode === 'drop') {
      const exceptList = parsed.columns.map(quoteIdentifier).join(', ')
      return {
        sql: `SELECT * EXCEPT (${exceptList}) FROM __INPUT__`,
        params: {},
        touchedColumns: [],
        addedColumns: [],
        beforeColumns: [],
      }
    }

    const projections = context.schema.map((col) => (
      col.name === parsed.sourceColumn
        ? `${quoteIdentifier(parsed.sourceColumn)} AS ${quoteIdentifier(parsed.newName)}`
        : quoteIdentifier(col.name)
    ))

    return {
      sql: `SELECT ${projections.join(', ')} FROM __INPUT__`,
      params: {},
      touchedColumns: [],
      addedColumns: [parsed.newName],
      beforeColumns: [],
    }
  },
}

export default manageColumns
export type { ManageColumnsMode, ParsedManageColumns }
