<template>
  <div>
    <header class="header">
      <div class="wadah header-isi">
        <strong>Cleansing Data</strong>
        <nav>
          <NuxtLink to="/">Beranda</NuxtLink>
          <NuxtLink to="/tentang">Tentang</NuxtLink>
        </nav>
      </div>
    </header>

    <main class="wadah">
      <slot />
    </main>

    <footer class="wadah footer">Aplikasi Cleansing Data · proyek belajar Nuxt.js</footer>
  </div>
</template>

<style scoped>
.header {
  background: var(--warna-kartu);
  border-bottom: 1px solid var(--warna-garis);
}
.header-isi {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  padding-bottom: 12px;
}
nav {
  display: flex;
  gap: 8px;
}
nav a {
  text-decoration: none;
  color: var(--warna-teks);
  padding: 4px 12px;
  border-radius: 6px;
}
nav a.router-link-exact-active {
  background: var(--warna-latar);
  color: var(--warna-utama);
  font-weight: 600;
}
.footer {
  color: var(--warna-redup);
  font-size: 14px;
}
</style>