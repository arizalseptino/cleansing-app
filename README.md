# BersihData — Ruang Kerja Data Cleansing & ETL untuk ClickHouse

**BersihData** (`cleansing-app`) adalah aplikasi web interaktif berbasis **Nuxt.js**, **ClickHouse**, dan **Python ETL** untuk membersihkan, menormalisasi, dan memvalidasi data tabel berskala ratusan ribu baris secara visual tanpa perlu menulis ulang kueri SQL secara manual.

Aplikasi ini bekerja secara **non-destruktif**: tabel sumber asli tidak pernah diubah, seluruh pratinjau berjalan dalam mode baca saja (*readonly*), dan hasil pembersihan disimpan sebagai tabel baru lengkap dengan kolom cadangan nilai asli (`_asli`), riwayat proses, serta ringkasan perbandingan kualitas data sebelum dan sesudah.

---

## Fitur Utama

* **Mode Cleansing Visual Berbasis Database:** Rangkai langkah transformasi (*Rapikan teks*, *Ganti nilai*, *Hapus duplikat*, *Tambah kolom*, *Aturan bersyarat lintas kolom*, *Ekstrak & pindah kolom*, *Pencocokan tabel master / fuzzy match*, serta *Kelola kolom*) dengan pratinjau SQL otomatis.
* **Preset Cepat (Quick Preset Chips):** Template resep siap pakai (*SIPKA Peserta*, *SIPKA 2015*, *Smartbangkom Peserta*, dan *Standardisasi Umum*) beserta fitur Ekspor/Impor Resep berformat `.json`.
* **Mode Pipeline Python ETL:** Eksekusi pipeline pembersihan dan ingest terintegrasi (`pandas`, `rapidfuzz`, `openpyxl`, `clickhouse-connect`) untuk data *Publikasi Media Humas*, *Realisasi Anggaran SP2D*, *Course Elasticsearch*, dan *Peserta VPL*.
* **Deteksi Nilai Langka / Anomali & Ringkasan Kualitas:** Memeriksa nilai dengan frekuensi terendah di seluruh tabel sumber serta menampilkan perbandingan jumlah baris dan nilai kosong (`NULL` / string kosong) sebelum vs. sesudah penyimpanan.

---

## Prasyarat Sebelum Menjalankan

Pastikan di komputer/server Anda sudah aktif:

1. **ClickHouse Server** lokal maupun jaringan internal (port HTTP `8123`) dengan akun pengguna yang memiliki izin membuat database dan tabel (`CREATE DATABASE`, `CREATE TABLE`, `INSERT`, `RENAME TABLE`, `DROP TABLE`).
2. **Docker Desktop** (Windows x64 / macOS Intel & Apple Silicon) jika menjalankan via Docker, **atau** **Node.js 20.x** (`node -v`) + **Python 3.10+** jika menjalankan mode development lokal.

---

## Cara Menjalankan (Windows & MacBook)

### Opsi A — Via Docker Compose (Rekomendasi Lintas OS)

Cara ini menjalankan Nuxt 3 dan seluruh pipeline Python ETL (`pandas`, `rapidfuzz`, `openpyxl`, `clickhouse-connect`, dll.) dalam satu container yang kompatibel dengan **Windows x64**, **macOS Intel**, maupun **MacBook Apple Silicon (M1/M2/M3/M4)**, serta otomatis terhubung ke ClickHouse lokal Anda.

1. **Clone repositori & salin berkas `.env`:**
   ```bash
   git clone [https://github.com/arizalseptino/cleansing-app.git](https://github.com/arizalseptino/cleansing-app.git)
   cd cleansing-app
   cp .env.example .env
   ```
   *(Di Windows PowerShell dapat menggunakan `Copy-Item .env.example .env`)*

2. **Pastikan `CLICKHOUSE_URL` di `.env` mengarah ke host lokal dari dalam Docker:**
   ```env
   CLICKHOUSE_URL=[http://host.docker.internal:8123](http://host.docker.internal:8123)
   CLICKHOUSE_USER=default
   CLICKHOUSE_PASSWORD=
   ```

3. **Bangun dan jalankan container:**
   ```bash
   docker compose up -d --build
   ```

4. **Buka aplikasi:**
   Akses **`http://localhost:3000`** di peramban. Periksa indikator status di pojok kanan atas layar: jika sudah berwarna hijau (**ClickHouse lokal · Terhubung**), aplikasi siap digunakan.

5. **Memperbarui aplikasi setelah `git pull`:**
   ```bash
   git pull --rebase origin main
   docker compose up -d --build
   ```

---

### Opsi B — Via Development Lokal (`npm run dev`)

1. **Clone repositori & pasang dependensi Node.js:**
   ```bash
   git clone [https://github.com/arizalseptino/cleansing-app.git](https://github.com/arizalseptino/cleansing-app.git)
   cd cleansing-app
   npm install
   ```

2. **(Opsional untuk Pipeline Python ETL) Siapkan virtual environment Python:**
   * **macOS / Linux:**
     ```bash
     python3 -m venv python-etl/.venv
     python-etl/.venv/bin/pip install -r python-etl/requirements.txt
     ```
   * **Windows (PowerShell):**
     ```powershell
     python -m venv python-etl/.venv
     python-etl\.venv\Scripts\python.exe -m pip install -r python-etl\requirements.txt
     ```
   *(Server Nuxt akan otomatis mendeteksi `python-etl/.venv` sesuai OS Anda, atau Anda dapat mengisi `PYTHON_PATH` di `.env`.)*

3. **Atur `.env` untuk koneksi lokal:**
   Salin `.env.example` menjadi `.env` dan gunakan `localhost`:
   ```env
   CLICKHOUSE_URL=http://localhost:8123
   CLICKHOUSE_USER=default
   CLICKHOUSE_PASSWORD=
   ```

4. **Jalankan server development:**
   ```bash
   npm run dev
   ```
   Buka **`http://localhost:3000`** di peramban.

---

## Panduan Singkat Mencoba Fitur (Walkthrough Uji Coba)

### Langkah 1 — Siapkan Data Uji (Menu Sumber Data)
1. Buka menu **Sumber Data** di navigasi kiri.
2. Anda bisa langsung memilih **Database** dan **Tabel** yang sudah ada di ClickHouse untuk melihat struktur kolom serta sampel isinya, atau
3. **Unggah CSV Baru:** Pilih tab muat data dari berkas CSV (mendukung berkas besar secara *streaming*, teruji pada `>800.000` baris). Sistem akan otomatis mendeteksi tipe data setiap kolom (`Int64`, `Float64`, `Date`, `String`, `Nullable`) dan Anda dapat menyesuaikan tipe kolomnya sebelum tabel dibuat.

### Langkah 2 — Susun & Pratinjau Cleansing (Menu Cleansing)
1. Buka menu **Cleansing**, lalu pilih **Database** dan **Tabel sumber** di panel atas (atau gunakan **Preset Cepat** di bawah bagian Resep).
2. Pada panel kanan (**Buat Perubahan → Operasi**), tambahkan langkah pembersihan sesuai kebutuhan:
   * **Rapikan teks:** Menghapus spasi tepi/ganda, menyeragamkan kapitalisasi, dan mengubah teks kosong menjadi `NULL`.
   * **Ganti nilai:** Mengganti nilai teks tertentu dengan nilai baru (mendukung *case-insensitive* dan *trim*).
   * **Hapus duplikat:** Menghapus baris duplikat berdasarkan kolom kunci pilihan.
   * **Tambah kolom:** Menambah kolom konstanta, nomor urut, atau gabungan kolom lain.
   * **Aturan bersyarat lintas kolom:** Mengisi/mengubah nilai kolom jika kolom lain memenuhi kondisi tertentu.
   * **Ekstrak dan pindah kolom:** Mengekstrak pola teks (misalnya nama instansi atau wilayah) dan memindahkannya ke kolom tujuan.
   * **Isi kolom kosong / Samakan nilai dengan tabel master:** Mengisi nilai kosong atau menyeragamkan penulisan teks merujuk pada tabel master (pencocokan kata kunci maupun kemiripan teks).
   * **Kelola kolom:** Menghapus kolom bantu sementara atau mengubah nama kolom.
3. Pantau hasilnya secara langsung di panel tengah (**Pratinjau**, menampilkan sampel 5.000 baris pertama agar responsif) serta periksa tab **SQL** jika ingin melihat kueri hasil kompilasi.
4. Gunakan panel **Cek Sisa Anomali / Typo** untuk mengecek nilai dengan frekuensi terendah di keseluruhan tabel sumber guna mendeteksi sisa typo.

### Langkah 3 — Simpan Tabel Baru & Cek Ringkasan Kualitas
1. Klik tombol **Simpan sebagai tabel baru**, tentukan **Database tujuan** dan **Nama tabel hasil**, lalu mulai penyimpanan.
2. Setelah selesai, aplikasi akan memverifikasi kelengkapan skema & jumlah baris secara otomatis, lalu menampilkan kartu **Ringkasan Kualitas Data (Sebelum vs. Sesudah)** yang membandingkan total baris serta jumlah nilai kosong (`NULL`/string kosong) di setiap kolom.
3. Anda juga dapat mengklik **Ekspor Resep (JSON)** untuk menyimpan rangkaian langkah tersebut agar bisa dipakai ulang lewat **Impor Resep (JSON)** pada tabel lain.

### Langkah 4 — Lihat Riwayat & Ekspor Hasil (Menu Riwayat & Sumber Data)
* Buka menu **Riwayat** untuk melihat catatan setiap proses penyimpanan, mengklik tombol **Parameter** guna meninjau ulang daftar langkah dan kartu **Ringkasan Kualitas Data**, atau mengunduh tabel hasil dalam format **CSV / SQL**.

---

## Pemecahan Masalah Singkat (Troubleshooting)

* **Status di pojok kanan atas `"Tidak terhubung"`:**
  * Pastikan layanan ClickHouse aktif dan port HTTP (`8123`) dapat diakses sesuai alamat `CLICKHOUSE_URL` di berkas `.env`.
  * Jika menjalankan ClickHouse di dalam **WSL2** sementara aplikasi berjalan di **Docker Desktop**, pastikan konfigurasi ClickHouse menyertakan `<listen_host>0.0.0.0</listen_host>` dan `.env` menggunakan `CLICKHOUSE_URL=http://host.docker.internal:8123`.
* **Gagal saat membuat database/tabel hasil:**
  * Pastikan akun `CLICKHOUSE_USER` yang digunakan memiliki izin `CREATE`, `INSERT`, `RENAME`, dan `DROP` pada database tujuan.
* **Performa lambat saat menyimpan ratusan ribu baris di Windows (WSL):**
  * Disarankan menyimpan direktori data ClickHouse pada filesystem Linux asli (`ext4`) agar operasi tulis dan *merge* berjalan optimal.