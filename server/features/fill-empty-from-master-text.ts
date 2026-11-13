import { applyFillEmptyFromMasterText } from './fill-empty-from-master-apply'
import { previewFillEmptyFromMasterText } from './fill-empty-from-master-query'
import type { CleansingFeature } from './types'

const feature: CleansingFeature = {
  id: 'fill-empty-from-master-text',
  name: 'Isi kolom kosong dari teks kolom lain berdasarkan tabel master',
  description: 'Mencari nilai master di dalam kolom teks sumber dan menyarankannya untuk target yang kosong.',
  parameters: [
    { key: 'sourceDatabase', label: 'Database sumber', description: 'Database yang dipilih pada sumber data.', kind: 'source-database' },
    { key: 'sourceTable', label: 'Tabel sumber', description: 'Tabel yang dipilih pada sumber data.', kind: 'source-table' },
    { key: 'sourceColumn', label: 'Kolom sumber teks', description: 'Kolom teks tempat pencarian nilai master dilakukan.', kind: 'source-column' },
    { key: 'targetColumn', label: 'Kolom target kosong', description: 'Kolom teks yang akan diperiksa apakah masih kosong.', kind: 'source-column' },
    { key: 'masterDatabase', label: 'Database master', description: 'Database yang berisi tabel nilai master.', kind: 'master-database' },
    { key: 'masterTable', label: 'Tabel master', description: 'Tabel yang menyediakan nilai untuk dicari.', kind: 'master-table' },
    { key: 'masterColumn', label: 'Kolom kunci pencarian', description: 'Kolom teks yang nilainya dicari di dalam teks sumber.', kind: 'master-column' },
    { key: 'masterFillColumn', label: 'Kolom nilai pengisi', description: 'Kolom teks opsional yang nilainya akan disarankan untuk target.', kind: 'master-column', optional: true },
  ],
  preview: previewFillEmptyFromMasterText,
  apply: applyFillEmptyFromMasterText,
}

export default feature
