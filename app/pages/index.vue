<script setup lang="ts">
const tahapan = [
  { nomor: '01', nama: 'Siapkan koneksi ClickHouse', detail: 'Hubungkan aplikasi ke database lokal.', status: 'Selesai', kelas: 'done' },
  { nomor: '02', nama: 'Pilih database dan tabel', detail: 'Tentukan sumber data yang akan dibersihkan.', status: 'Selesai', kelas: 'done' },
  { nomor: '03', nama: 'Tinjau isi tabel', detail: 'Periksa kolom dan data sebelum diproses.', status: 'Berikutnya', kelas: 'active' },
  { nomor: '04', nama: 'Terapkan cleansing', detail: 'Pilih aturan dan tinjau hasil perubahan.', status: 'Akan datang', kelas: '' },
]
</script>

<template>
  <div>
    <p class="page-kicker">Ruang kerja · SIPKA</p>
    <h1 class="page-title">Selamat datang, Arizal</h1>
    <p class="page-description">
      Siapkan data untuk dianalisis dan dibersihkan dalam satu alur kerja yang terarah—tanpa perlu mengelola banyak query secara manual.
    </p>

    <section class="dashboard-grid" aria-label="Ringkasan proyek">
      <div class="kartu progress-card">
        <div class="progress-top">
          <p class="eyebrow">Progres pengembangan</p>
          <span class="soft-badge">Fase awal</span>
        </div>
        <div class="progress-number">
          <strong>2/6</strong>
          <span>tahapan selesai</span>
        </div>
        <p class="progress-copy">Fondasi aplikasi sudah siap. Berikutnya, hubungkan sumber data.</p>
        <div
          class="progress-track"
          role="progressbar"
          aria-label="Progres pengembangan"
          aria-valuemin="0"
          aria-valuemax="6"
          aria-valuenow="2"
        >
          <span />
        </div>
        <div class="progress-foot">
          <span><strong>2</strong> selesai</span>
          <span><strong>4</strong> tersisa</span>
        </div>
      </div>

      <article class="kartu connection-card">
        <div>
          <div class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <ellipse cx="12" cy="5.5" rx="7.5" ry="3" stroke="currentColor" stroke-width="1.7" />
              <path d="M4.5 5.5v13c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-13M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" stroke="currentColor" stroke-width="1.7" />
            </svg>
          </div>
          <h2>Sumber data</h2>
          <p>ClickHouse lokal belum terhubung. Pengaturan koneksi menjadi langkah awal sebelum memilih tabel.</p>
        </div>
        <NuxtLink class="text-link" to="/tentang">
          Lihat detail proyek
          <span aria-hidden="true">→</span>
        </NuxtLink>
      </article>
    </section>

    <div class="section-heading">
      <div>
        <h2>Alur kerja</h2>
        <p>Gambaran langkah dari sumber data hingga proses cleansing.</p>
      </div>
      <span class="section-caption">4 tahap utama</span>
    </div>

    <section class="dashboard-grid" style="margin-top: 0" aria-label="Tahapan alur kerja dan contoh cleansing">
      <div class="kartu stage-card">
        <div class="stage-card-header">
          <h3 class="card-title">Tahapan proyek</h3>
          <span class="soft-badge">2 dari 6 selesai</span>
        </div>
        <div class="stage-list">
          <div v-for="t in tahapan" :key="t.nomor" class="stage-row" :class="t.kelas">
            <span class="stage-marker" aria-hidden="true">{{ t.kelas === 'done' ? '✓' : t.nomor }}</span>
            <div>
              <p class="stage-name">{{ t.nama }}</p>
              <p class="stage-detail">{{ t.detail }}</p>
            </div>
            <span class="stage-status">{{ t.status }}</span>
          </div>
        </div>
      </div>

      <article class="kartu experiment-card">
        <p class="eyebrow">Contoh use case</p>
        <h3 class="card-title">Lengkapi provinsi instansi</h3>
        <p class="experiment-description">
          Isi nilai <code>provinsi_instansi</code> yang kosong dengan menelusuri informasi pada <code>alamat_kantor</code>.
        </p>
        <div class="transform-flow" aria-label="Contoh data yang akan dibersihkan">
          <div class="transform-field">
            <span>Kolom sumber</span>
            <code>alamat_kantor</code>
          </div>
          <div class="transform-arrow" aria-hidden="true">↓ digunakan untuk melengkapi</div>
          <div class="transform-field">
            <span>Kolom target</span>
            <code>provinsi_instansi</code>
          </div>
        </div>
        <span class="soft-badge" style="margin-top: 13px">Rencana cleansing</span>
      </article>
    </section>
  </div>
</template>
