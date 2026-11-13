<template>
  <div class="app-shell">
    <aside class="sidebar">
      <NuxtLink class="brand" to="/" aria-label="BersihData, ke ringkasan">
        <img class="brand-mark" src="~/assets/logo-cleaningdata.png" alt="" width="38" height="38" />
        <span class="brand-name">Bersih<span>Data</span></span>
      </NuxtLink>

      <p class="sidebar-label">Ruang kerja</p>
      <nav class="side-nav" aria-label="Navigasi utama">
        <NuxtLink to="/">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7" />
            <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7" />
            <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7" />
          </svg>
          Ringkasan
        </NuxtLink>
        <NuxtLink to="/sumber-data">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="15" stroke="currentColor" stroke-width="1.7" />
            <path d="M3.5 9.5h17M9 9.5v10M15 9.5v10M3.5 14.5h17" stroke="currentColor" stroke-width="1.7" />
          </svg>
          Sumber data
        </NuxtLink>
        <NuxtLink to="/cleansing">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 5h16M7 5v5l4 4v5l2 1v-6l4-4V5M9 9h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Cleansing
        </NuxtLink>
        <NuxtLink to="/riwayat">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4.5v4h4M12 7v5l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          Riwayat
        </NuxtLink>
      </nav>

      <div class="sidebar-spacer" />
      <div class="profile">
        <div class="profile-avatar" aria-hidden="true">U</div>
        <p class="profile-name">User</p>
      </div>
    </aside>

    <div class="app-main">
      <header class="topbar">
        <div class="breadcrumb">Ruang kerja <span>/</span> <strong>{{ breadcrumbTitle }}</strong></div>
        <div class="connection-pill">
          <span class="connection-dot" :class="`connection-dot--${status}`" aria-hidden="true" />
          <span aria-live="polite">
            <template v-if="status === 'terhubung'">ClickHouse lokal · Terhubung (v{{ version }})</template>
            <template v-else-if="status === 'memeriksa'">ClickHouse lokal · Memeriksa...</template>
            <template v-else>ClickHouse lokal · Belum terhubung</template>
          </span>
        </div>
      </header>

      <main class="wadah">
        <slot />
        <footer class="footer">BersihData · proyek belajar dan riset cleansing data</footer>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const breadcrumbTitle = computed(() => {
  if (route.path === '/sumber-data') return 'Sumber data'
  if (route.path === '/cleansing') return 'Cleansing'
  if (route.path === '/riwayat') return 'Riwayat'
  return 'Ringkasan'
})
const { status, version } = useClickHouseStatus()
</script>

<style scoped>
.connection-dot--terhubung {
  background-color: #5e8f3e;
}

.connection-dot--gagal {
  background-color: #a64b42;
}
</style>
