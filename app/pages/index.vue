<template>
  <div>
    <p class="page-kicker">Ruang kerja</p>
    <h1 class="page-title">Cleansing data, lebih sederhana</h1>
    <p class="page-description">Pilih tabel, tinjau data, lalu terapkan aturan cleansing.</p>

    <section class="dashboard-grid" aria-label="Sumber data dan contoh cleansing">
      <article class="kartu connection-card">
        <div>
          <div class="card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <ellipse cx="12" cy="5.5" rx="7.5" ry="3" stroke="currentColor" stroke-width="1.7" />
              <path d="M4.5 5.5v13c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-13M4.5 12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3" stroke="currentColor" stroke-width="1.7" />
            </svg>
          </div>
          <h2>Sumber data</h2>
          <p>ClickHouse lokal belum terhubung.</p>
        </div>
      </article>

      <article class="kartu experiment-card">
        <p class="eyebrow">Contoh cleansing</p>
        <h2 class="card-title">Lengkapi provinsi instansi</h2>
        <div class="transform-flow" aria-label="Contoh data cleansing">
          <div class="transform-field">
            <span>Kolom sumber</span>
            <code>alamat_kantor</code>
          </div>
          <div class="transform-arrow" aria-hidden="true">↓</div>
          <div class="transform-field">
            <span>Kolom target</span>
            <code>provinsi_instansi</code>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>
