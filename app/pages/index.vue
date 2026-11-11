<script setup lang="ts">
const tahapan = [
  { nama: 'Instalasi Node.js dan Nuxt', selesai: true },
  { nama: 'Tampilan awal (layout dan navigasi)', selesai: true },
  { nama: 'Koneksi ke ClickHouse lokal', selesai: false },
  { nama: 'Pilih database dan tabel', selesai: false },
  { nama: 'Tampilkan isi tabel', selesai: false },
  { nama: 'Fitur cleansing sederhana', selesai: false },
]
</script>

<template>
  <div>
    <h1>Aplikasi Cleansing Data</h1>
    <p class="redup">
      Alat bantu cleansing data dengan memilih fitur lewat klik, tanpa perlu menyimpan banyak query SQL.
    </p>

    <section class="kartu">
      <h2>Tahapan pengembangan</h2>
      <ul class="tahapan">
        <li v-for="t in tahapan" :key="t.nama">
          <span>{{ t.selesai ? '✅' : '⬜' }}</span> {{ t.nama }}
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.redup {
  color: var(--warna-redup);
}
.tahapan {
  list-style: none;
  padding: 0;
  margin: 0;
}
.tahapan li {
  padding: 4px 0;
}
</style>