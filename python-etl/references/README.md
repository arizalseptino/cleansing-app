# Referensi Pipeline ETL Python

Simpan file referensi CSV statis di direktori ini agar terbaca otomatis oleh modul pipeline:

1. **Peserta VPL (`peserta_vpl`)**:
   - `master_instansi_bkn_202609221425.csv` (kolom wajib: `nama`)
   - `master_jf_202609221427.csv` (kolom wajib: `nama`)
   - `manual_override_instansi.csv` (kolom: `dari,ke`)
   - `manual_override_jabatan.csv` (kolom: `dari,ke`)
   - `ref_webinar_2025.csv` (kolom: `series_name,tanggal_webinar,judul_webinar`)

2. **Course Elasticsearch (`course_es`)**:
   - `course_reference_nip.csv` (kolom wajib: `nip`) untuk anti-join deduplikasi NIP peserta yang sudah tercatat.

Catatan: Jika file master/override belum diisi (masih template header kosong), pipeline tetap berjalan menggunakan aturan normalisasi, regex ekspansi singkatan, dan daftar jabatan pelaksana baku bawaan.
