<template>
  <div class="app-shell">
    <aside class="sidebar">
      <NuxtLink class="brand" to="/" aria-label="BersihData, ke ringkasan">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M5 6.5h14M5 12h14M5 17.5h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <path d="m16.5 16.5 1.5 1.5 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="brand-name">Bersih<span>Data</span></span>
      </NuxtLink>

      <p class="sidebar-label">Workspace</p>
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
      </nav>

      <div class="sidebar-spacer" />
      <div class="profile">
        <div class="profile-avatar" aria-hidden="true">AS</div>
        <div>
          <p class="profile-name">Arizal Septino</p>
          <p class="profile-role">Data Engineer Intern</p>
        </div>
      </div>
    </aside>

    <div class="app-main">
      <header class="topbar">
        <div class="breadcrumb">Workspace <span>/</span> <strong>Ringkasan</strong></div>
        <div class="connection-pill" aria-label="ClickHouse lokal belum terhubung">
          <span class="connection-dot" aria-hidden="true" />
          ClickHouse lokal · Belum terhubung
        </div>
      </header>

      <main class="wadah">
        <slot />
        <footer class="footer">BersihData · proyek belajar dan riset cleansing data</footer>
      </main>
    </div>
  </div>
</template>
