# BersihData

Aplikasi web berbasis Nuxt dan ClickHouse untuk eksplorasi, pembersihan (*data cleansing*), standardisasi, dan ekspor data tabular skala besar secara interaktif.

## Konteks Lingkungan Eksekusi

- **Mesin Basis Data**: ClickHouse LTS `v26.8.40.8` (lokal).
- **Sistem Berkas (*Filesystem*)**: Filesystem Linux asli (`ext4`), bukan lagi pada mount NTFS.
- **Implikasi Kapasitas & Performa**:
  - Operasi *cross-join* perbandingan string pendek skala menengah pada fitur `fuzzy_match_master` mode `similarity` (misalnya dataset SIPKA dengan ~53.000 nilai unik sumber × 654 nilai unik master ≈ 34,6 juta kombinasi) dapat dieksekusi dengan aman dan cepat di ClickHouse tanpa kendala memori maupun hambatan I/O mount NTFS.
  - Batas maksimum kombinasi perbandingan nilai unik (`MAX_FUZZY_PAIR_COMPARISONS` di `server/workbench/ops/fuzzy_match_master.ts`) ditetapkan sebesar **`100_000_000`** (`100.000.000` kombinasi).

## Konfigurasi Lingkungan

Salin `.env.example` dan isi kredensial koneksi ClickHouse sesuai kebutuhan:

```env
NUXT_CLICKHOUSE_URL=http://localhost:8123
NUXT_CLICKHOUSE_USER=default
NUXT_CLICKHOUSE_PASSWORD=
```

> Jika `NUXT_CLICKHOUSE_URL` tidak diatur, server otomatis menggunakan simulasi ClickHouse *in-memory* untuk keperluan pengembangan/pratinjau.

## Menjalankan Proyek

```bash
# Instal dependensi
npm install

# Jalankan server pengembangan (port 3000)
npm run dev

# Bangun untuk produksi
npm run build
```
