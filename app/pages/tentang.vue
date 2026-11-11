<template>
  <div>
    <p class="page-kicker">Ruang kerja · informasi</p>
    <h1 class="page-title">Tentang BersihData</h1>
    <p class="page-description">
      Aplikasi web untuk membantu proses cleansing data melalui antarmuka yang lebih terarah dan mudah digunakan.
    </p>

    <section class="kartu about-card">
      <h2>Tujuan proyek</h2>
      <p>
        BersihData dibuat sebagai portofolio dan riset untuk menyederhanakan proses cleansing. Pengguna nantinya dapat memilih database dan tabel, meninjau isi data, lalu menerapkan fitur cleansing tanpa harus berpindah-pindah query SQL.
      </p>
      <ul class="about-list">
        <li>Framework aplikasi: Nuxt.js dan Node.js</li>
        <li>Sumber data yang direncanakan: ClickHouse lokal</li>
        <li>Contoh kasus: mengisi <code>provinsi_instansi</code> yang kosong dari <code>alamat_kantor</code></li>
      </ul>
    </section>
  </div>
</template>
