# BersihData — Ruang Kerja Data Cleansing untuk ClickHouse

**BersihData** adalah aplikasi web interaktif berbasis **Nuxt.js** dan **ClickHouse** untuk membersihkan, menormalisasi, dan memvalidasi data tabel berskala ratusan ribu baris secara visual tanpa perlu menulis ulang kueri SQL secara manual.

Aplikasi ini bekerja secara **non-destruktif**: tabel sumber asli tidak pernah diubah, seluruh pratinjau berjalan dalam mode baca saja (`readonly`), dan hasil pembersihan disimpan sebagai tabel baru lengkap dengan kolom cadangan nilai asli (`_asli`), riwayat proses, serta ringkasan perbandingan kualitas data sebelum dan sesudah.

---

## Prasyarat Sebelum Menjalankan

Pastikan di komputer/server pengujian sudah terpasang dan berjalan:
1. **Node.js** versi `18.x` atau `20.x` ke atas (`node -v`).
2. **ClickHouse Server** aktif (lokal maupun jaringan internal) dengan akun pengguna yang memiliki izin membuat database dan tabel (`CREATE DATABASE`, `CREATE TABLE`, `INSERT`, `RENAME TABLE`, `DROP TABLE`).

---

## Cara Menjalankan (Quick Start)

### 1. Clone Repositori & Pasang Dependensi
```bash
git clone [https://github.com/arizalseptino/cleansing-app.git](https://github.com/arizalseptino/cleansing-app.git)
cd cleansing-app
npm install
```

### 2. Atur Koneksi ClickHouse (`.env`)
Buat berkas `.env` di folder utama proyek (atau salin dari `.env.example` jika tersedia), lalu isi sesuai konfigurasi ClickHouse lokal Anda:

```env
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=default
```
*(Catatan: Jika nama variabel environment di `nuxt.config.ts` memakai prefiks `NUXT_`, sesuaikan dengan konfigurasi pada `nuxt.config.ts`.)*

### 3. Jalankan Aplikasi
```bash
npm run dev
```
Buka peramban dan akses **`http://localhost:3000`**.  
Periksa indikator status di **pojok kanan atas** layar: jika sudah berwarna hijau (**ClickHouse lokal · Terhubung** beserta versi servernya), aplikasi siap digunakan.

---

## Panduan Singkat Mencoba Fitur (Walkthrough Uji Coba)

### Langkah 1 — Siapkan Data Uji (Menu *Sumber Data*)
1. Buka menu **Sumber Data** di navigasi kiri.
2. Anda bisa langsung memilih **Database** dan **Tabel** yang sudah ada di ClickHouse untuk melihat struktur kolom serta sampel isinya, **atau**
3. **Unggah CSV Baru:** Pilih tab muat data dari berkas CSV (mendukung berkas besar secara *streaming*, teruji pada >800.000 baris). Sistem akan otomatis mendeteksi tipe data setiap kolom (`Int64`, `Float64`, `Date`, `String`, `Nullable`) dan Anda dapat menyesuaikan tipe kolomnya sebelum tabel dibuat.

### Langkah 2 — Susun & Pratinjau Cleansing (Menu *Cleansing*)
1. Buka menu **Cleansing**, lalu pilih **Database** dan **Tabel sumber** di panel atas.
2. Pada panel kanan (**Buat Perubahan → Operasi**), tambahkan langkah pembersihan sesuai kebutuhan:
   - **Rapikan teks:** Menghapus spasi tepi/ganda, menyeragamkan kapitalisasi, dan mengubah teks kosong menjadi `NULL`.
   - **Ganti nilai:** Mengganti nilai teks tertentu dengan nilai baru (mendukung *case-insensitive* dan *trim*).
   - **Hapus duplikat:** Menghapus baris duplikat berdasarkan kolom kunci pilihan.
   - **Tambah kolom:** Menambah kolom konstanta, nomor urut, atau gabungan kolom lain.
   - **Aturan bersyarat lintas kolom:** Mengisi/mengubah nilai kolom jika kolom lain memenuhi kondisi tertentu.
   - **Ekstrak dan pindah kolom:** Mengekstrak pola teks (misalnya nama instansi atau wilayah) dan memindahkannya ke kolom tujuan.
   - **Isi kolom kosong / Samakan nilai dengan tabel master:** Mengisi nilai kosong atau menyeragamkan penulisan teks merujuk pada tabel master (pencocokan kata kunci maupun kemiripan teks).
   - **Kelola kolom:** Menghapus kolom bantu sementara atau mengubah nama kolom.
3. Pantau hasilnya secara langsung di panel tengah (**Pratinjau**, menampilkan sampel 5.000 baris pertama agar responsif) serta periksa tab **SQL** jika ingin melihat kueri hasil kompilasi.
4. Gunakan panel **Nilai Langka / Anomali** untuk mengecek nilai dengan frekuensi terendah di keseluruhan tabel sumber guna mendeteksi sisa *typo*.

### Langkah 3 — Simpan Tabel Baru & Cek Ringkasan Kualitas
1. Klik tombol **Simpan sebagai tabel baru**, tentukan **Database tujuan** dan **Nama tabel hasil**, lalu mulai penyimpanan.
2. Setelah selesai, aplikasi akan memverifikasi kelengkapan skema & jumlah baris secara otomatis, lalu menampilkan kartu **Ringkasan Kualitas Data (Sebelum vs. Sesudah)** yang membandingkan total baris serta jumlah nilai kosong (`NULL`/string kosong) di setiap kolom.
3. Anda juga dapat mengklik **Ekspor Resep (JSON)** untuk menyimpan rangkaian langkah tersebut agar bisa dipakai ulang lewat **Impor Resep (JSON)** pada tabel lain.

### Langkah 4 — Lihat Riwayat & Ekspor Hasil (Menu *Riwayat* & *Sumber Data*)
- Buka menu **Riwayat** untuk melihat catatan setiap proses penyimpanan, mengklik tombol **Parameter** guna meninjau ulang daftar langkah dan kartu Ringkasan Kualitas Data, atau mengunduh tabel hasil dalam format **CSV** / **SQL**.

---

## Pemecahan Masalah Singkat (Troubleshooting)

- **Status di pojok kanan atas "Tidak terhubung":** Pastikan layanan ClickHouse aktif dan port HTTP (`8123`) dapat diakses sesuai alamat `CLICKHOUSE_URL` di berkas `.env`.
- **Gagal saat membuat database/tabel hasil:** Pastikan akun `CLICKHOUSE_USER` yang digunakan memiliki izin `CREATE`, `INSERT`, `RENAME`, dan `DROP` pada database tujuan.
- **Performa lambat saat menyimpan ratusan ribu baris di Windows (WSL):** Disarankan menyimpan direktori data ClickHouse pada *filesystem* Linux asli (`ext4`) agar operasi tulis dan *merge* berjalan optimal.
