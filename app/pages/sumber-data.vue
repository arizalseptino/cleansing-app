<template>
  <div class="bento">
      <section class="kartu source-ingest-bar span-12" aria-label="Pemuat data baru">
        <div class="source-ingest-copy">
          <p class="page-kicker">Pemuat data staging</p>
          <p class="source-ingest-desc">Buat tabel baru di ClickHouse dari file CSV/TSV/TXT atau teks yang ditempel untuk langsung dibersihkan.</p>
        </div>
        <button
          type="button"
          class="source-primary-btn"
          :disabled="databasesPending || databases.length === 0"
          @click="openIngestModal"
        >
          Muat data baru
        </button>
      </section>

      <article class="kartu source-card span-4" aria-label="Pilih sumber">
        <h2 class="card-title">Pilih sumber</h2>

        <label class="source-field" for="database-select">Database</label>
        <select
          id="database-select"
          :value="selectedDatabase ?? ''"
          :disabled="databasesPending || databases.length === 0 || Boolean(databasesError)"
          @change="handleDatabaseChange"
        >
          <option value="" disabled>Pilih database</option>
          <option v-for="database in databases" :key="database.name" :value="database.name">
            {{ database.name }}
          </option>
        </select>

        <p v-if="databasesPending" class="source-message" role="status">Memuat daftar database...</p>
        <p v-else-if="databasesError" class="source-message source-error" role="alert">
          Gagal memuat database: {{ databasesError }}
        </p>
        <template v-else-if="databases.length === 0">
          <p class="source-message" role="status">Tidak ada database yang dapat dipilih.</p>
        </template>
        <button
          v-if="databasesError"
          class="source-retry"
          type="button"
          @click="loadDatabases"
        >
          Coba lagi
        </button>

        <label class="source-field" for="table-select">Tabel</label>
        <select
          id="table-select"
          :value="selectedTable ?? ''"
          :disabled="!selectedDatabase || tablesPending || tables.length === 0 || Boolean(tablesError)"
          @change="handleTableChange"
        >
          <option value="" disabled>
            {{ selectedDatabase ? 'Pilih tabel' : 'Pilih database terlebih dahulu' }}
          </option>
          <option v-for="table in tables" :key="table.name" :value="table.name">
            {{ table.name }}
          </option>
        </select>

        <p v-if="tablesPending" class="source-message" role="status">Memuat daftar tabel...</p>
        <p v-else-if="tablesError" class="source-message source-error" role="alert">
          Gagal memuat tabel: {{ tablesError }}
        </p>
        <p v-else-if="selectedDatabase && tables.length === 0" class="source-message" role="status">
          Database ini belum memiliki tabel.
        </p>
        <button
          v-if="tablesError && selectedDatabase"
          class="source-retry"
          type="button"
          @click="loadTables(selectedDatabase, true)"
        >
          Coba lagi
        </button>
      </article>

      <article class="kartu source-card span-4" aria-live="polite">
        <h2 class="card-title">Ringkasan tabel</h2>
        <template v-if="selectedTable">
          <dl class="table-summary">
            <div>
              <dt>Tabel</dt>
              <dd><code>{{ selectedTable }}</code></dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>{{ selectedEngine }}</dd>
            </div>
          </dl>
        </template>
        <p v-else class="source-message">Pilih tabel untuk melihat ringkasannya.</p>
      </article>

      <article class="kartu source-card columns-card span-4" aria-live="polite">
        <h2 class="card-title">Daftar kolom</h2>
        <p v-if="!selectedTable" class="source-message">Pilih tabel untuk melihat daftar kolomnya.</p>
        <template v-else>
          <p v-if="columnsPending" class="source-message" role="status">Memuat daftar kolom...</p>
          <p v-else-if="columnsError" class="source-message source-error" role="alert">
            Gagal memuat kolom: {{ columnsError }}
          </p>
          <p v-else-if="columns.length === 0" class="source-message" role="status">
            Tabel ini belum memiliki kolom.
          </p>
          <ul v-else class="column-list">
            <li v-for="column in columns" :key="column.name">
              <code>{{ column.name }}</code>
              <span>{{ column.type }}</span>
            </li>
          </ul>
          <button
            v-if="columnsError && selectedDatabase"
            class="source-retry"
            type="button"
            @click="loadColumns(selectedDatabase, selectedTable)"
          >
            Coba lagi
          </button>
        </template>
      </article>

    <section class="kartu rows-card span-12" aria-label="Isi tabel">
      <div class="rows-heading">
        <div>
          <p class="page-kicker">Pratinjau data</p>
          <h2 class="card-title">Isi tabel</h2>
        </div>
        <div class="rows-heading-actions">
          <code v-if="selectedTable">{{ selectedTable }}</code>
          <button
            type="button"
            class="ingest-secondary-btn rows-export-btn"
            :disabled="!selectedDatabase || !selectedTable"
            @click="openTableExportDialog"
          >
            Ekspor
          </button>
        </div>
      </div>

      <p v-if="!selectedDatabase || !selectedTable" class="source-message">
        Pilih database dan tabel untuk melihat isinya.
      </p>
      <p v-else-if="rowsPending" class="source-message" role="status">Memuat isi tabel...</p>
      <p v-else-if="rowsError" class="source-message source-error" role="alert">
        Gagal memuat isi tabel: {{ rowsError }}
      </p>
      <template v-else>
        <p v-if="!orderGuaranteed" class="source-message rows-order-note" role="status">
          Tabel ini tidak memiliki sorting key; urutan baris tidak dijamin.
        </p>

        <div class="rows-toolbar">
          <p class="rows-range">{{ rowsRange }}</p>
          <label class="rows-limit-field" for="rows-limit">
            Baris per halaman
            <select id="rows-limit" :value="pageSize" @change="handlePageSizeChange">
              <option :value="25">25</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </label>
        </div>

        <p v-if="rowCount === 0" class="source-message" role="status">
          Tabel ini belum memiliki data.
        </p>
        <div v-else class="rows-table-viewport">
          <table class="rows-table">
            <thead>
              <tr>
                <th v-for="column in rowColumns" :key="column.name" scope="col">
                  <span :title="`${column.name} (${column.type})`">{{ column.name }}</span>
                  <small>{{ column.type }}</small>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in tableRows" :key="rowIndex">
                <td v-for="column in rowColumns" :key="column.name">
                  <span
                    class="rows-cell-value"
                    :class="{
                      'rows-cell-value--null': row[column.name] === null,
                      'rows-cell-value--empty': row[column.name] === '',
                    }"
                    :title="displayCellValue(row[column.name])"
                  >
                    {{ displayCellValue(row[column.name]) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <nav v-if="rowCount > 0" class="rows-pagination" aria-label="Navigasi halaman tabel">
          <button
            type="button"
            :disabled="pageNumber <= 1 || rowsPending"
            @click="changePage(pageNumber - 1)"
          >
            Sebelumnya
          </button>
          <span>Halaman {{ pageNumber }} dari {{ totalPages }}</span>
          <button
            type="button"
            :disabled="pageNumber >= totalPages || rowsPending"
            @click="changePage(pageNumber + 1)"
          >
            Berikutnya
          </button>
        </nav>
      </template>
    </section>

    <div
      v-if="showIngestModal"
      class="ingest-backdrop"
      @click.self="closeIngestModal"
    />
    <section
      v-if="showIngestModal"
      class="kartu ingest-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ingest-dialog-title"
      tabindex="-1"
      @keydown="handleIngestKeydown"
    >
      <div class="ingest-dialog-heading">
        <div>
          <p class="page-kicker">Tabel staging baru</p>
          <h2 id="ingest-dialog-title" class="card-title">
            {{ ingestCommitResult ? 'Tabel baru berhasil dibuat' : 'Muat data baru' }}
          </h2>
        </div>
        <button
          v-if="!ingestCommitPending"
          type="button"
          class="ingest-close-btn"
          @click="closeIngestModal"
        >
          Tutup
        </button>
      </div>

      <template v-if="ingestCommitResult">
        <p class="ingest-safety-note" role="status">
          {{ ingestCommitResult.verification }}
        </p>
        <dl class="ingest-summary-list">
          <div>
            <dt>Tabel baru</dt>
            <dd><code>{{ ingestCommitResult.database }}.{{ ingestCommitResult.table }}</code></dd>
          </div>
          <div>
            <dt>Sumber</dt>
            <dd>{{ ingestCommitResult.sourceLabel }}</dd>
          </div>
          <div>
            <dt>Baris dimuat</dt>
            <dd>{{ formatIdNumber(ingestCommitResult.rows) }}</dd>
          </div>
          <div>
            <dt>Jumlah kolom</dt>
            <dd>{{ formatIdNumber(ingestCommitResult.columns.length) }} (semua bertipe <code>Nullable(String)</code>)</dd>
          </div>
          <div>
            <dt>Durasi</dt>
            <dd>{{ formatIdNumber(ingestCommitResult.durationMs) }} ms</dd>
          </div>
        </dl>
        <p v-if="ingestCommitResult.historyWarning" class="source-message source-error" role="status">
          {{ ingestCommitResult.historyWarning }}
        </p>
        <div class="ingest-actions">
          <button type="button" class="source-primary-btn" @click="viewIngestedTable">
            Lihat isi tabel
          </button>
          <button type="button" class="ingest-secondary-btn" @click="openIngestedInWorkbench">
            Buka di ruang kerja
          </button>
        </div>
      </template>

      <template v-else>
        <div class="ingest-tabs" role="tablist" aria-label="Cara memasukkan data">
          <button
            type="button"
            role="tab"
            class="ingest-tab"
            :class="{ 'ingest-tab--active': ingestMode === 'file' }"
            :aria-selected="ingestMode === 'file'"
            :disabled="ingestCommitPending"
            @click="switchIngestMode('file')"
          >
            Unggah file
          </button>
          <button
            type="button"
            role="tab"
            class="ingest-tab"
            :class="{ 'ingest-tab--active': ingestMode === 'text' }"
            :aria-selected="ingestMode === 'text'"
            :disabled="ingestCommitPending"
            @click="switchIngestMode('text')"
          >
            Tempel teks
          </button>
          <button
            type="button"
            class="ingest-tab ingest-tab--disabled"
            disabled
            title="gunakan ekspor CSV UTF-8 dari Excel"
          >
            Excel (.xlsx) — gunakan ekspor CSV UTF-8 dari Excel
          </button>
        </div>

        <div v-if="ingestMode === 'file'" class="ingest-input-panel">
          <input
            id="ingest-file-input"
            ref="fileInputRef"
            type="file"
            class="sr-only-file-input"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            :disabled="ingestInspectPending || ingestCommitPending"
            @change="handleIngestFileChange"
          />

          <!-- Dropzone modern saat belum ada file dipilih -->
          <div
            v-if="!ingestFile"
            class="modern-dropzone"
            :class="{
              'modern-dropzone--active': isDragging,
              'modern-dropzone--disabled': ingestInspectPending || ingestCommitPending
            }"
            role="button"
            tabindex="0"
            aria-label="Area unggah file. Klik atau seret file CSV, TSV, atau TXT ke sini"
            @click="triggerFileInput"
            @keydown.enter.prevent="triggerFileInput"
            @keydown.space.prevent="triggerFileInput"
            @dragover.prevent="handleDragOver"
            @dragleave.prevent="handleDragLeave"
            @drop.prevent="handleFileDrop"
          >
            <div class="dropzone-icon-circle">
              <svg viewBox="0 0 24 24" fill="none" class="dropzone-svg" aria-hidden="true">
                <path d="M7 16a4 4 0 0 1-.88-7.903A5 5 0 1 1 15.9 6L16 6a5 5 0 0 1 1 9.9M15 13l-3-3m0 0l-3 3m3-3v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <div class="dropzone-text">
              <p class="dropzone-title">
                <strong>Klik untuk memilih</strong> atau tarik &amp; lepas file ke sini
              </p>
              <p class="dropzone-subtitle">
                Mendukung format <strong>CSV, TSV, atau TXT</strong> (UTF-8, streaming tanpa batas ukuran)
              </p>
            </div>
            <div class="dropzone-badge-pill">
              <svg viewBox="0 0 24 24" fill="none" class="badge-icon" aria-hidden="true">
                <path d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              Pilih dari Komputer
            </div>
          </div>

          <!-- Card preview file modern saat file terpilih -->
          <div v-else class="selected-file-card">
            <div class="selected-file-main">
              <div class="selected-file-badge">
                <svg viewBox="0 0 24 24" fill="none" class="file-card-svg" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                  <polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
                  <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
                <span class="file-ext-tag">{{ getFileExtension(ingestFile.name) }}</span>
              </div>
              <div class="selected-file-info">
                <div class="selected-file-title-row">
                  <span class="selected-file-name" :title="ingestFile.name">{{ ingestFile.name }}</span>
                  <span class="file-status-pill" :class="{ 'file-status-pill--pending': ingestInspectPending }">
                    <span class="file-status-dot"></span>
                    {{ ingestInspectPending ? 'Memeriksa...' : 'Siap diimpor' }}
                  </span>
                </div>
                <div class="selected-file-meta">
                  <span>{{ formatFileSize(ingestFile.size) }}</span>
                  <span class="meta-dot">·</span>
                  <span>{{ ingestFile.type || 'text/plain' }}</span>
                </div>
              </div>
            </div>

            <div class="selected-file-actions">
              <button
                type="button"
                class="file-action-btn file-action-btn--change"
                title="Ganti dengan file lain"
                :disabled="ingestInspectPending || ingestCommitPending"
                @click="triggerFileInput"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Ganti file
              </button>
              <button
                type="button"
                class="file-action-btn file-action-btn--remove"
                title="Hapus file terpilih"
                :disabled="ingestInspectPending || ingestCommitPending"
                @click="clearIngestFile"
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                  <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                </svg>
                Hapus
              </button>
            </div>
          </div>
        </div>

        <div v-else class="ingest-input-panel">
          <label class="ingest-label" for="ingest-pasted-text">
            Tempel isi CSV atau TSV lengkap dengan baris judul (maks. 2 MB)
          </label>
          <textarea
            id="ingest-pasted-text"
            v-model="ingestPastedText"
            rows="6"
            placeholder="nama,kota,catatan&#10;Budi Santoso,Bandung,Pelanggan aktif"
            :disabled="ingestInspectPending || ingestCommitPending"
            @input="resetInspectionOnEdit"
          />
          <div class="ingest-text-toolbar">
            <span class="ingest-meta-hint">
              Ukuran teks: {{ formatFileSize(pastedTextBytes) }} / 2 MB
            </span>
            <button
              type="button"
              class="ingest-secondary-btn"
              :disabled="!ingestPastedText.trim() || pastedTextBytes > maxTextBytes || ingestInspectPending || ingestCommitPending"
              @click="runIngestInspect(true)"
            >
              {{ ingestInspectPending ? 'Memeriksa...' : 'Periksa teks' }}
            </button>
          </div>
          <p v-if="pastedTextBytes > maxTextBytes" class="source-message source-error" role="alert">
            Teks yang ditempel melebihi batas maksimal 2 MB.
          </p>
        </div>

        <p v-if="ingestInspectPending" class="source-message" role="status">
          <template v-if="ingestUploadProgress !== null && ingestUploadProgress < 100">
            Mengunggah file ke server ({{ ingestUploadProgress }}%)...
          </template>
          <template v-else>
            Memeriksa baris judul, pemisah kolom, dan 20 baris contoh...
          </template>
        </p>
        <p v-if="ingestInspectError" class="source-message source-error" role="alert">
          {{ ingestInspectError }}
        </p>

        <template v-if="ingestInspection">
          <section class="ingest-section" aria-label="Hasil pemeriksaan data">
            <div class="ingest-section-head">
              <div>
                <h3>Pratinjau &amp; pemisah kolom</h3>
                <p class="ingest-meta-hint">
                  <strong>{{ formatIdNumber(ingestInspection.rowCount) }}</strong> baris data ·
                  <strong>{{ formatIdNumber(ingestInspection.columnCount) }}</strong> kolom ·
                  Terdeteksi: <strong>{{ delimiterLabel(ingestInspection.detectedDelimiter) }}</strong>
                </p>
              </div>
              <label class="ingest-inline-field" for="ingest-delimiter-select">
                <span>Pemisah kolom</span>
                <select
                  id="ingest-delimiter-select"
                  v-model="ingestDelimiter"
                  :disabled="ingestInspectPending || ingestCommitPending"
                  @change="runIngestInspect(false)"
                >
                  <option value=",">Koma (,)</option>
                  <option value=";">Titik koma (;)</option>
                  <option value="	">Tab (\t)</option>
                  <option value="|">Pipa (|)</option>
                </select>
              </label>
            </div>

            <div class="ingest-columns-editor">
              <h4>Nama kolom hasil (dapat diubah)</h4>
              <div class="ingest-columns-grid">
                <label
                  v-for="(rawHeader, colIdx) in ingestInspection.rawHeaders"
                  :key="colIdx"
                  class="ingest-col-field"
                >
                  <span :title="rawHeader || `Kolom ${colIdx + 1}`">
                    Asli: {{ rawHeader || `(kosong #${colIdx + 1})` }}
                  </span>
                  <input
                    v-model="ingestEditedColumns[colIdx]"
                    type="text"
                    maxlength="64"
                    :disabled="ingestCommitPending"
                    :aria-label="`Nama kolom untuk ${rawHeader || `kolom ${colIdx + 1}`}`"
                  />
                </label>
              </div>
              <p v-if="ingestColumnValidationError" class="source-message source-error" role="alert">
                {{ ingestColumnValidationError }}
              </p>
            </div>

            <div v-if="ingestInspection.previewRows.length === 0" class="source-message" role="status">
              File hanya berisi baris judul (0 baris data).
            </div>
            <div v-else class="rows-table-viewport ingest-preview-viewport">
              <table class="rows-table">
                <thead>
                  <tr>
                    <th v-for="(colName, colIdx) in ingestEditedColumns" :key="colIdx" scope="col">
                      <span :title="colName">{{ colName || `kolom_${colIdx + 1}` }}</span>
                      <small>Nullable(String)</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIdx) in ingestInspection.previewRows" :key="rowIdx">
                    <td v-for="(colName, colIdx) in ingestEditedColumns" :key="colIdx">
                      <span
                        class="rows-cell-value"
                        :class="{ 'rows-cell-value--empty': (row[colIdx] ?? '') === '' }"
                        :title="displayCellValue(row[colIdx] ?? '')"
                      >
                        {{ displayCellValue(row[colIdx] ?? '') }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <form class="ingest-commit-form" @submit.prevent="submitIngestCommit">
            <div class="ingest-target-grid">
              <label class="ingest-target-field" for="ingest-target-db">
                <span>Database tujuan</span>
                <select
                  id="ingest-target-db"
                  v-model="ingestTargetDatabase"
                  :disabled="ingestCommitPending || databases.length === 0"
                  required
                >
                  <option value="" disabled>Pilih database</option>
                  <option v-for="database in databases" :key="database.name" :value="database.name">
                    {{ database.name }}
                  </option>
                </select>
              </label>

              <label class="ingest-target-field" for="ingest-table-name">
                <span>Nama tabel baru</span>
                <input
                  id="ingest-table-name"
                  v-model="ingestTargetTable"
                  type="text"
                  maxlength="64"
                  placeholder="contoh: data_staging_baru"
                  :disabled="ingestCommitPending"
                  required
                />
              </label>
            </div>

            <p v-if="ingestTargetTable && !isValidTargetTableName" class="source-message source-error" role="alert">
              Nama tabel harus diawali huruf, hanya berisi huruf, angka, dan garis bawah, maksimal 64 karakter.
            </p>

            <div class="ingest-summary-box">
              <p>
                Ringkasan: membuat tabel baru
                <code>{{ ingestTargetDatabase || '...' }}.{{ ingestTargetTable.trim() || '...' }}</code>
                dengan <strong>{{ formatIdNumber(ingestInspection.columnCount) }}</strong> kolom bertipe
                <code>Nullable(String)</code> dan memuat
                <strong>{{ formatIdNumber(ingestInspection.rowCount) }}</strong> baris data dari
                <strong>{{ ingestInspection.sourceLabel }}</strong>.
              </p>
              <p class="ingest-empty-note">
                Catatan: nilai kosong dimuat apa adanya sebagai string kosong; gunakan operasi &ldquo;Rapikan teks&rdquo; (ubah string kosong menjadi NULL) di ruang kerja bila perlu.
              </p>
            </div>

            <p v-if="ingestCommitError" class="source-message source-error" role="alert">
              {{ ingestCommitError }}
            </p>
            <p v-if="ingestCommitPending" class="source-message" role="status">
              Sedang membuat tabel baru dan mengalirkan data ke ClickHouse... Mohon tunggu.
            </p>

            <div class="ingest-actions">
              <button
                type="submit"
                class="source-primary-btn"
                :disabled="!canSubmitIngestCommit"
              >
                {{ ingestCommitPending ? 'Membuat tabel...' : 'Buat tabel' }}
              </button>
              <button
                type="button"
                class="ingest-secondary-btn"
                :disabled="ingestCommitPending"
                @click="closeIngestModal"
              >
                Batal
              </button>
            </div>
          </form>
        </template>
      </template>
    </section>

    <ExportDialog
      :open="showTableExportDialog"
      :database="selectedDatabase ?? ''"
      :table="selectedTable ?? ''"
      @close="showTableExportDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
type CatalogResponse<T> = { data: T[] }
type Database = { name: string }
type Table = { name: string; engine: string }
type Column = { name: string; type: string }
type TableRow = Record<string, unknown>
type RowsResponse = {
  columns: Column[]
  rows: TableRow[]
  count: number
  page: number
  limit: number
  orderGuaranteed: boolean
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object'
      && 'message' in error.data && typeof error.data.message === 'string') {
      return error.data.message
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message
    }
  }

  return fallback
}

const source = useSelectedSource()
const selectedDatabase = source.database
const selectedTable = source.table

const databases = ref<Database[]>([])
const databasesPending = ref(true)
const databasesError = ref('')
const tables = ref<Table[]>([])
const tablesPending = ref(false)
const tablesError = ref('')
const columns = ref<Column[]>([])
const columnsPending = ref(false)
const columnsError = ref('')
const selectedEngine = ref('')
const rowColumns = ref<Column[]>([])
const tableRows = ref<TableRow[]>([])
const rowCount = ref(0)
const pageNumber = ref(1)
const pageSize = ref(50)
const rowsPending = ref(false)
const rowsError = ref('')
const orderGuaranteed = ref(true)
const showTableExportDialog = ref(false)
let rowRequestId = 0

function openTableExportDialog() {
  if (!selectedDatabase.value || !selectedTable.value) return
  showTableExportDialog.value = true
}

const totalPages = computed(() => Math.max(1, Math.ceil(rowCount.value / pageSize.value)))
const rowsRange = computed(() => {
  const first = rowCount.value === 0 ? 0 : (pageNumber.value - 1) * pageSize.value + 1
  const last = Math.min(pageNumber.value * pageSize.value, rowCount.value)
  const format = (value: number) => new Intl.NumberFormat('id-ID').format(value)
  return `${format(first)}-${format(last)} dari ${format(rowCount.value)}`
})

async function loadDatabases() {
  databasesPending.value = true
  databasesError.value = ''

  try {
    const response = await $fetch<CatalogResponse<Database>>('/api/databases')
    databases.value = response.data

    if (selectedDatabase.value && !databases.value.some(({ name }) => name === selectedDatabase.value)) {
      source.setDatabase(null)
    }

    if (selectedDatabase.value) {
      await loadTables(selectedDatabase.value, true)
    }
  } catch (error) {
    databasesError.value = getErrorMessage(error, 'Terjadi kesalahan saat mengambil daftar database.')
  } finally {
    databasesPending.value = false
  }
}

async function loadTables(database: string, restoreSelection = false) {
  tablesPending.value = true
  tablesError.value = ''
  tables.value = []
  columns.value = []
  columnsError.value = ''
  selectedEngine.value = ''

  try {
    const response = await $fetch<CatalogResponse<Table>>('/api/tables', {
      query: { database },
    })

    if (selectedDatabase.value !== database) return
    tables.value = response.data

    if (restoreSelection && selectedTable.value) {
      const selected = tables.value.find(({ name }) => name === selectedTable.value)
      if (selected) {
        selectedEngine.value = selected.engine
        await loadColumns(database, selected.name)
      } else {
        source.setTable(null)
      }
    } else {
      source.setTable(null)
    }
  } catch (error) {
    if (selectedDatabase.value === database) {
      tablesError.value = getErrorMessage(error, 'Terjadi kesalahan saat mengambil daftar tabel.')
    }
  } finally {
    if (selectedDatabase.value === database) {
      tablesPending.value = false
    }
  }
}

async function loadColumns(database: string, table: string) {
  columnsPending.value = true
  columnsError.value = ''
  columns.value = []

  try {
    const response = await $fetch<CatalogResponse<Column>>('/api/columns', {
      query: { database, table },
    })

    if (selectedDatabase.value === database && selectedTable.value === table) {
      columns.value = response.data
    }
  } catch (error) {
    if (selectedDatabase.value === database && selectedTable.value === table) {
      columnsError.value = getErrorMessage(error, 'Terjadi kesalahan saat mengambil daftar kolom.')
    }
  } finally {
    if (selectedDatabase.value === database && selectedTable.value === table) {
      columnsPending.value = false
    }
  }
}

async function loadRows(database: string, table: string) {
  const requestId = ++rowRequestId
  const requestedPage = pageNumber.value
  const requestedLimit = pageSize.value
  rowsPending.value = true
  rowsError.value = ''
  tableRows.value = []
  rowColumns.value = []
  rowCount.value = 0

  try {
    const response = await $fetch<RowsResponse>('/api/rows', {
      query: {
        database,
        table,
        page: requestedPage,
        limit: requestedLimit,
      },
    })

    if (requestId !== rowRequestId
      || selectedDatabase.value !== database
      || selectedTable.value !== table) {
      return
    }

    rowColumns.value = response.columns
    tableRows.value = response.rows
    rowCount.value = response.count
    pageNumber.value = response.page
    orderGuaranteed.value = response.orderGuaranteed
  } catch (error) {
    if (requestId === rowRequestId
      && selectedDatabase.value === database
      && selectedTable.value === table) {
      rowsError.value = getErrorMessage(error, 'Terjadi kesalahan saat mengambil isi tabel.')
    }
  } finally {
    if (requestId === rowRequestId) {
      rowsPending.value = false
    }
  }
}

function displayCellValue(value: unknown): string {
  if (value === null) return 'NULL'
  if (value === '') return '(kosong)'
  if (typeof value === 'string') return value
  if (typeof value === 'object') return JSON.stringify(value) ?? String(value)
  return String(value)
}

function handlePageSizeChange(event: Event) {
  const selectedSize = Number((event.target as HTMLSelectElement).value)
  if (![25, 50, 100].includes(selectedSize)) return

  pageSize.value = selectedSize
  pageNumber.value = 1
  if (selectedDatabase.value && selectedTable.value) {
    void loadRows(selectedDatabase.value, selectedTable.value)
  }
}

function changePage(page: number) {
  if (page < 1 || page > totalPages.value || rowsPending.value) return

  pageNumber.value = page
  if (selectedDatabase.value && selectedTable.value) {
    void loadRows(selectedDatabase.value, selectedTable.value)
  }
}

watch(
  [selectedDatabase, selectedTable],
  ([database, table]) => {
    pageNumber.value = 1
    rowRequestId += 1
    tableRows.value = []
    rowColumns.value = []
    rowCount.value = 0
    rowsError.value = ''
    orderGuaranteed.value = true

    if (database && table) {
      void loadRows(database, table)
    } else {
      rowsPending.value = false
    }
  },
  { immediate: true },
)

async function handleDatabaseChange(event: Event) {
  const database = (event.target as HTMLSelectElement).value
  source.setDatabase(database || null)
  tables.value = []
  tablesError.value = ''
  columns.value = []
  columnsError.value = ''
  selectedEngine.value = ''

  if (database) {
    await loadTables(database)
  }
}

async function handleTableChange(event: Event) {
  const table = (event.target as HTMLSelectElement).value
  source.setTable(table || null)
  columns.value = []
  columnsError.value = ''
  selectedEngine.value = tables.value.find((item) => item.name === table)?.engine ?? ''

  if (selectedDatabase.value && table) {
    await loadColumns(selectedDatabase.value, table)
  }
}

function formatIdNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${formatIdNumber(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

type IngestInspectResponse = {
  uploadId?: string | null
  mode: 'file' | 'text'
  sourceLabel: string
  delimiter: ',' | ';' | '\t' | '|'
  detectedDelimiter: ',' | ';' | '\t' | '|'
  rawHeaders: string[]
  suggestedColumns: string[]
  previewRows: string[][]
  rowCount: number
  columnCount: number
}

type IngestCommitResponse = {
  database: string
  table: string
  sourceLabel: string
  delimiter: string
  columns: string[]
  rows: number
  durationMs: number
  verification: string
  historyWarning: string | null
}

const maxTextBytes = 2 * 1024 * 1024
const newTableNamePattern = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const columnNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

const showIngestModal = ref(false)
const ingestMode = ref<'file' | 'text'>('file')
const fileInputRef = ref<HTMLInputElement | null>(null)
const ingestFile = ref<File | null>(null)
const ingestUploadId = ref<string | null>(null)
const ingestUploadProgress = ref<number | null>(null)
const isDragging = ref(false)
const ingestPastedText = ref('')
const ingestDelimiter = ref<string>('auto')
const ingestInspection = ref<IngestInspectResponse | null>(null)
const ingestEditedColumns = ref<string[]>([])
const ingestTargetDatabase = ref('')
const ingestTargetTable = ref('')
const ingestInspectPending = ref(false)
const ingestInspectError = ref('')
const ingestCommitPending = ref(false)
const ingestCommitError = ref('')
const ingestCommitResult = ref<IngestCommitResponse | null>(null)

const pastedTextBytes = computed(() => new TextEncoder().encode(ingestPastedText.value).length)
const isValidTargetTableName = computed(() => newTableNamePattern.test(ingestTargetTable.value.trim()))

const ingestColumnValidationError = computed(() => {
  if (!ingestInspection.value) return ''
  if (ingestEditedColumns.value.length !== ingestInspection.value.columnCount) {
    return 'Jumlah nama kolom tidak sesuai dengan data.'
  }
  const seen = new Set<string>()
  for (let i = 0; i < ingestEditedColumns.value.length; i += 1) {
    const col = (ingestEditedColumns.value[i] ?? '').trim()
    if (!columnNamePattern.test(col)) {
      return `Kolom ke-${i + 1} ("${col || 'kosong'}") harus diawali huruf atau garis bawah, hanya huruf/angka/garis bawah, maks. 64 karakter.`
    }
    if (seen.has(col)) {
      return `Nama kolom "${col}" duplikat. Setiap kolom harus unik.`
    }
    seen.add(col)
  }
  return ''
})

const canSubmitIngestCommit = computed(() => (
  Boolean(ingestInspection.value)
  && !ingestInspectPending.value
  && !ingestCommitPending.value
  && Boolean(ingestTargetDatabase.value)
  && isValidTargetTableName.value
  && !ingestColumnValidationError.value
))

function delimiterLabel(delimiter: string): string {
  if (delimiter === ',') return 'Koma (,)'
  if (delimiter === ';') return 'Titik koma (;)'
  if (delimiter === '\t') return 'Tab (\\t)'
  if (delimiter === '|') return 'Pipa (|)'
  return delimiter
}

function suggestTableNameFromFilename(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, '')
  let clean = withoutExt
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!clean) clean = 'tabel_baru'
  if (!/^[A-Za-z]/.test(clean)) clean = `tbl_${clean}`
  return clean.slice(0, 64).replace(/_+$/g, '') || 'tabel_baru'
}

function releaseStagedUploadId() {
  const id = ingestUploadId.value
  ingestUploadId.value = null
  if (!id) return
  void fetch(`/api/ingest/upload?uploadId=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
}

function getHttpStatusCode(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode
    if ('status' in error && typeof error.status === 'number') return error.status
  }
  return undefined
}

function openIngestModal() {
  releaseStagedUploadId()
  showIngestModal.value = true
  ingestMode.value = 'file'
  ingestFile.value = null
  ingestUploadProgress.value = null
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
  isDragging.value = false
  ingestPastedText.value = ''
  ingestDelimiter.value = 'auto'
  ingestInspection.value = null
  ingestEditedColumns.value = []
  ingestTargetDatabase.value = selectedDatabase.value ?? databases.value[0]?.name ?? ''
  ingestTargetTable.value = ''
  ingestInspectPending.value = false
  ingestInspectError.value = ''
  ingestCommitPending.value = false
  ingestCommitError.value = ''
  ingestCommitResult.value = null
}

function closeIngestModal() {
  if (ingestCommitPending.value) return
  releaseStagedUploadId()
  showIngestModal.value = false
  isDragging.value = false
}

function handleIngestKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !ingestCommitPending.value) {
    closeIngestModal()
  }
}

function switchIngestMode(nextMode: 'file' | 'text') {
  if (ingestCommitPending.value || ingestMode.value === nextMode) return
  releaseStagedUploadId()
  ingestMode.value = nextMode
  ingestUploadProgress.value = null
  ingestInspection.value = null
  ingestEditedColumns.value = []
  ingestInspectError.value = ''
  ingestCommitError.value = ''
  ingestDelimiter.value = 'auto'
}

function resetInspectionOnEdit() {
  releaseStagedUploadId()
  ingestUploadProgress.value = null
  ingestInspection.value = null
  ingestEditedColumns.value = []
  ingestInspectError.value = ''
  ingestCommitError.value = ''
  ingestDelimiter.value = 'auto'
}

function triggerFileInput() {
  if (ingestInspectPending.value || ingestCommitPending.value) return
  fileInputRef.value?.click()
}

function handleDragOver() {
  if (ingestInspectPending.value || ingestCommitPending.value) return
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

function handleFileDrop(event: DragEvent) {
  isDragging.value = false
  if (ingestInspectPending.value || ingestCommitPending.value) return
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  processSelectedFile(file)
}

function clearIngestFile() {
  ingestFile.value = null
  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
  resetInspectionOnEdit()
}

function getFileExtension(name: string): string {
  const parts = name.split('.')
  if (parts.length > 1) {
    return parts.pop()!.toUpperCase()
  }
  return 'FILE'
}

function processSelectedFile(file: File) {
  releaseStagedUploadId()
  ingestUploadProgress.value = null
  ingestInspection.value = null
  ingestEditedColumns.value = []
  ingestInspectError.value = ''
  ingestCommitError.value = ''
  ingestDelimiter.value = 'auto'

  const lower = file.name.toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    ingestFile.value = null
    ingestInspectError.value = 'Format Excel (.xlsx/.xls) belum didukung; gunakan ekspor CSV UTF-8 dari Excel.'
    return
  }
  if (!lower.endsWith('.csv') && !lower.endsWith('.tsv') && !lower.endsWith('.txt')) {
    ingestFile.value = null
    ingestInspectError.value = 'Ekstensi file tidak didukung. Gunakan file .csv, .tsv, atau .txt.'
    return
  }
  if (file.size === 0) {
    ingestFile.value = null
    ingestInspectError.value = 'File yang dipilih kosong.'
    return
  }

  ingestFile.value = file
  if (!ingestTargetTable.value.trim()) {
    ingestTargetTable.value = suggestTableNameFromFilename(file.name)
  }
  void runIngestInspect(true)
}

function handleIngestFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  if (!file) {
    ingestFile.value = null
    return
  }
  processSelectedFile(file)
}

function uploadMultipartInspect(file: File, delimiter: string): Promise<IngestInspectResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/ingest/inspect')

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && evt.total > 0) {
        ingestUploadProgress.value = Math.min(100, Math.round((evt.loaded / evt.total) * 100))
      }
    }

    xhr.onload = () => {
      ingestUploadProgress.value = 100
      let parsed: Record<string, unknown> | null = null
      try {
        parsed = JSON.parse(xhr.responseText) as Record<string, unknown>
      } catch {
        parsed = null
      }

      if (xhr.status >= 200 && xhr.status < 300 && parsed) {
        resolve(parsed as unknown as IngestInspectResponse)
        return
      }

      const msg = (parsed && typeof parsed.message === 'string' && parsed.message)
        || (parsed && typeof parsed.statusMessage === 'string' && parsed.statusMessage)
        || 'Data tidak dapat diperiksa sebagai CSV/TSV yang valid.'
      reject({ statusCode: xhr.status, message: msg })
    }

    xhr.onerror = () => {
      reject(new Error('Koneksi terputus saat mengunggah file ke server.'))
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('delimiter', delimiter)
    ingestUploadProgress.value = 0
    xhr.send(formData)
  })
}

async function runIngestInspect(autoDelimiter = false) {
  ingestInspectError.value = ''
  ingestCommitError.value = ''

  if (ingestMode.value === 'file' && !ingestFile.value) {
    ingestInspectError.value = 'Pilih file terlebih dahulu.'
    return
  }
  if (ingestMode.value === 'text') {
    if (!ingestPastedText.value.trim()) {
      ingestInspectError.value = 'Tempel teks CSV atau TSV terlebih dahulu.'
      return
    }
    if (pastedTextBytes.value > maxTextBytes) {
      ingestInspectError.value = 'Teks yang ditempel melebihi batas maksimal 2 MB.'
      return
    }
  }

  ingestInspectPending.value = true
  try {
    const delimiterToSend = autoDelimiter ? 'auto' : ingestDelimiter.value
    let response: IngestInspectResponse

    if (ingestMode.value === 'file' && ingestFile.value) {
      if (ingestUploadId.value && !autoDelimiter) {
        try {
          response = await $fetch<IngestInspectResponse>('/api/ingest/inspect', {
            method: 'POST',
            body: {
              uploadId: ingestUploadId.value,
              delimiter: delimiterToSend,
            },
          })
        } catch (err) {
          if (getHttpStatusCode(err) === 404) {
            ingestUploadId.value = null
            response = await uploadMultipartInspect(ingestFile.value, delimiterToSend)
          } else {
            throw err
          }
        }
      } else {
        response = await uploadMultipartInspect(ingestFile.value, delimiterToSend)
      }
      ingestUploadId.value = response.uploadId ?? ingestUploadId.value
    } else {
      response = await $fetch<IngestInspectResponse>('/api/ingest/inspect', {
        method: 'POST',
        body: {
          pastedText: ingestPastedText.value,
          delimiter: delimiterToSend,
        },
      })
    }

    ingestInspection.value = response
    ingestDelimiter.value = response.delimiter
    ingestEditedColumns.value = [...response.suggestedColumns]
    if (!ingestTargetDatabase.value) {
      ingestTargetDatabase.value = selectedDatabase.value ?? databases.value[0]?.name ?? ''
    }
  } catch (error) {
    ingestInspection.value = null
    ingestEditedColumns.value = []
    ingestInspectError.value = getErrorMessage(error, 'Data tidak dapat diperiksa sebagai CSV/TSV yang valid.')
  } finally {
    ingestInspectPending.value = false
    ingestUploadProgress.value = null
  }
}

async function submitIngestCommit() {
  if (!canSubmitIngestCommit.value || !ingestInspection.value) return

  ingestCommitPending.value = true
  ingestCommitError.value = ''
  const trimmedColumns = ingestEditedColumns.value.map((col) => col.trim())
  const trimmedTable = ingestTargetTable.value.trim()

  try {
    let response: IngestCommitResponse

    if (ingestMode.value === 'file' && ingestFile.value) {
      if (ingestUploadId.value) {
        try {
          response = await $fetch<IngestCommitResponse>('/api/ingest/commit', {
            method: 'POST',
            body: {
              uploadId: ingestUploadId.value,
              delimiter: ingestDelimiter.value,
              targetDatabase: ingestTargetDatabase.value,
              tableName: trimmedTable,
              columns: trimmedColumns,
            },
          })
        } catch (err) {
          if (getHttpStatusCode(err) === 404) {
            ingestUploadId.value = null
            const formData = new FormData()
            formData.append('file', ingestFile.value)
            formData.append('delimiter', ingestDelimiter.value)
            formData.append('targetDatabase', ingestTargetDatabase.value)
            formData.append('tableName', trimmedTable)
            formData.append('columns', JSON.stringify(trimmedColumns))
            response = await $fetch<IngestCommitResponse>('/api/ingest/commit', {
              method: 'POST',
              body: formData,
            })
          } else {
            throw err
          }
        }
      } else {
        const formData = new FormData()
        formData.append('file', ingestFile.value)
        formData.append('delimiter', ingestDelimiter.value)
        formData.append('targetDatabase', ingestTargetDatabase.value)
        formData.append('tableName', trimmedTable)
        formData.append('columns', JSON.stringify(trimmedColumns))
        response = await $fetch<IngestCommitResponse>('/api/ingest/commit', {
          method: 'POST',
          body: formData,
        })
      }
      ingestUploadId.value = null
    } else {
      response = await $fetch<IngestCommitResponse>('/api/ingest/commit', {
        method: 'POST',
        body: {
          pastedText: ingestPastedText.value,
          delimiter: ingestDelimiter.value,
          targetDatabase: ingestTargetDatabase.value,
          tableName: trimmedTable,
          columns: trimmedColumns,
        },
      })
    }

    ingestCommitResult.value = response
  } catch (error) {
    ingestCommitError.value = getErrorMessage(error, 'Gagal memuat data ke tabel baru ClickHouse.')
  } finally {
    ingestCommitPending.value = false
  }
}

async function viewIngestedTable() {
  if (!ingestCommitResult.value) return
  const { database, table } = ingestCommitResult.value
  source.setDatabase(database)
  source.setTable(table)
  showIngestModal.value = false
  await loadDatabases()
}

async function openIngestedInWorkbench() {
  if (!ingestCommitResult.value) return
  const { database, table } = ingestCommitResult.value
  source.setDatabase(database)
  source.setTable(table)
  showIngestModal.value = false
  await navigateTo('/cleansing')
}

onMounted(loadDatabases)
</script>

<style scoped>
.rows-card {
  min-width: 0;
  margin: 0;
}

.rows-heading,
.rows-toolbar,
.rows-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.rows-heading {
  min-width: 0;
  margin-bottom: 12px;
}

.rows-heading .page-kicker {
  margin-bottom: 4px;
}

.rows-heading .card-title {
  margin: 0;
}

.rows-heading-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.rows-heading code {
  max-width: 320px;
  overflow: hidden;
  color: #375875;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rows-export-btn {
  min-height: 36px;
  padding: 6px 12px;
  font-size: 13px;
}

.rows-order-note {
  margin-top: 0;
}

.rows-toolbar {
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.rows-range {
  margin: 0;
  color: var(--warna-redup);
  font-size: 13px;
}

.rows-limit-field {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--warna-redup);
  font-size: 13px;
}

.rows-limit-field select {
  min-height: 40px;
  padding: 6px 9px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
}

.rows-table-viewport {
  max-width: 100%;
  max-height: 520px;
  overflow: auto;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
}

.rows-table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
}

.rows-table th,
.rows-table td {
  max-width: 240px;
  padding: 10px 12px;
  border-bottom: 1px solid #e8eff5;
  text-align: left;
  vertical-align: top;
}

.rows-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: #375875;
  background: #f3f8fc;
  font-weight: 700;
}

.rows-table th small {
  display: block;
  max-width: 210px;
  overflow: hidden;
  color: var(--warna-redup);
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rows-table td {
  color: var(--warna-teks);
  background: #fff;
}

.rows-table tr:last-child td {
  border-bottom: 0;
}

.rows-cell-value {
  display: block;
  max-width: 210px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rows-cell-value--null {
  color: #8a97a6;
  font-style: italic;
}

.rows-cell-value--empty {
  color: var(--warna-redup);
  font-style: italic;
}

.rows-pagination {
  justify-content: flex-end;
  flex-wrap: wrap;
  margin-top: 14px;
}

.rows-pagination span {
  color: var(--warna-redup);
  font-size: 13px;
}

.rows-pagination button {
  min-height: 42px;
  padding: 7px 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: var(--warna-biru-muda);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.rows-pagination button:hover:not(:disabled) {
  border-color: var(--warna-utama);
}

.rows-pagination button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.rows-pagination button:focus-visible,
.rows-limit-field select:focus-visible {
  outline: 2px solid var(--warna-utama);
  outline-offset: 2px;
}

.source-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.source-card .card-title {
  margin: 0 0 8px;
}

.source-field {
  color: var(--warna-teks);
  font-size: 14px;
  font-weight: 650;
  cursor: pointer;
}

.source-card select {
  width: 100%;
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}

.source-card select:hover:not(:disabled) {
  border-color: var(--warna-utama);
}

.source-card select:active:not(:disabled) {
  background: var(--warna-biru-muda);
}

.source-card select:focus-visible,
.source-retry:focus-visible {
  outline: 2px solid var(--warna-utama);
  outline-offset: 2px;
}

.source-card select:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.source-message {
  margin: 2px 0 8px;
  color: var(--warna-redup);
  font-size: 14px;
  overflow-wrap: anywhere;
}

.source-error {
  color: #a64b42;
}

.source-retry {
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: var(--warna-biru-muda);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.source-retry:hover {
  background: var(--warna-pistachio);
}

.source-retry:active {
  filter: brightness(0.94);
}

.table-summary {
  display: grid;
  width: 100%;
  gap: 10px;
  margin: 4px 0 12px;
}

.table-summary div {
  display: grid;
  grid-template-columns: minmax(72px, 0.35fr) minmax(0, 1fr);
  gap: 12px;
}

.table-summary dt {
  color: var(--warna-redup);
  font-size: 14px;
}

.table-summary dd {
  min-width: 0;
  margin: 0;
  color: var(--warna-teks);
  font-size: 15px;
  overflow-wrap: anywhere;
}

.columns-title {
  align-self: flex-start;
  margin: 8px 0 4px;
  color: var(--warna-teks);
  font-size: 16px;
}

.column-list {
  display: grid;
  width: 100%;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.column-list li {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
  border-top: 1px solid var(--warna-garis);
  font-size: 14px;
}

.column-list code,
.column-list span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.column-list span {
  color: var(--warna-redup);
  text-align: right;
}

@media (prefers-reduced-motion: reduce) {
  .source-card *,
  .source-card *::before,
  .source-card *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}

.source-ingest-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.source-ingest-copy .page-kicker {
  margin-bottom: 4px;
}

.source-ingest-desc {
  margin: 0;
  color: var(--warna-redup);
  font-size: 14px;
}

.source-primary-btn,
.ingest-secondary-btn,
.ingest-close-btn {
  min-height: 42px;
  padding: 8px 14px;
  border-radius: 9px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.source-primary-btn {
  border: 1px solid var(--warna-utama);
  color: #fff;
  background: var(--warna-utama);
  font-weight: 700;
}

.source-primary-btn:hover:not(:disabled) {
  filter: brightness(0.95);
}

.ingest-secondary-btn,
.ingest-close-btn {
  border: 1px solid var(--warna-garis);
  color: #375875;
  background: #fff;
  font-weight: 600;
}

.ingest-close-btn {
  min-height: 36px;
  padding: 6px 11px;
  font-size: 13px;
}

.source-primary-btn:disabled,
.ingest-secondary-btn:disabled,
.ingest-close-btn:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}

.ingest-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgb(21 38 55 / 42%);
}

.ingest-dialog {
  position: fixed;
  inset: 50% auto auto 50%;
  z-index: 21;
  display: grid;
  gap: 14px;
  width: min(920px, calc(100vw - 32px));
  max-height: min(90vh, 920px);
  overflow: auto;
  transform: translate(-50%, -50%);
}

.ingest-dialog-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ingest-dialog-heading .page-kicker {
  margin-bottom: 3px;
}

.ingest-dialog-heading .card-title {
  margin: 0;
}

.ingest-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ingest-tab {
  min-height: 38px;
  padding: 6px 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: #375875;
  background: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.ingest-tab--active {
  border-color: var(--warna-utama);
  color: #fff;
  background: var(--warna-utama);
}

.ingest-tab--disabled {
  color: #7c8b99;
  background: #f4f7fa;
  cursor: not-allowed;
}

.ingest-input-panel,
.ingest-section,
.ingest-commit-form,
.ingest-columns-editor {
  display: grid;
  gap: 10px;
}

.ingest-input-panel {
  padding: 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  background: #f8fbfe;
}

.ingest-label {
  color: #263a4e;
  font-size: 13px;
  font-weight: 650;
}

.sr-only-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

/* Modern Dropzone */
.modern-dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 30px 20px;
  border: 2px dashed #b7cde3;
  border-radius: 12px;
  background: #ffffff;
  cursor: pointer;
  text-align: center;
  transition: all 0.18s ease;
  user-select: none;
}

.modern-dropzone:hover {
  border-color: var(--warna-utama);
  background: #f0f7fd;
  transform: translateY(-1px);
}

.modern-dropzone:focus-visible {
  outline: 2px solid var(--warna-utama);
  outline-offset: 2px;
}

.modern-dropzone--active {
  border-color: var(--warna-utama);
  background: #e4f0fc;
  box-shadow: 0 0 0 4px rgba(87, 152, 215, 0.15);
}

.modern-dropzone--disabled {
  opacity: 0.6;
  cursor: not-allowed;
  pointer-events: none;
}

.dropzone-icon-circle {
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: #e6f1fa;
  color: var(--warna-utama);
  transition: transform 0.2s ease, background-color 0.2s ease;
}

.modern-dropzone:hover .dropzone-icon-circle {
  transform: scale(1.08);
  background: #d8ebfa;
}

.dropzone-svg {
  width: 25px;
  height: 25px;
}

.dropzone-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dropzone-title {
  margin: 0;
  color: #1a2b3c;
  font-size: 14px;
  font-weight: 500;
}

.dropzone-title strong {
  color: var(--warna-utama);
  font-weight: 700;
}

.dropzone-subtitle {
  margin: 0;
  color: #718196;
  font-size: 12px;
}

.dropzone-badge-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  background: #fff;
  border: 1px solid #d3e2ed;
  color: #3b5066;
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(34, 72, 112, 0.04);
  transition: all 0.15s ease;
}

.modern-dropzone:hover .dropzone-badge-pill {
  border-color: var(--warna-utama);
  color: var(--warna-utama);
}

.badge-icon {
  width: 14px;
  height: 14px;
}

/* Selected File Card */
.selected-file-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1px solid #cce0f0;
  background: #fff;
  box-shadow: 0 4px 14px rgba(34, 72, 112, 0.05);
  animation: fileCardFadeIn 0.22s ease-out;
}

@keyframes fileCardFadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.selected-file-main {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
  flex: 1;
}

.selected-file-badge {
  position: relative;
  display: grid;
  place-items: center;
  width: 44px;
  height: 48px;
  border-radius: 8px;
  background: #e8f3fc;
  color: var(--warna-utama);
  flex-shrink: 0;
}

.file-card-svg {
  width: 24px;
  height: 24px;
}

.file-ext-tag {
  position: absolute;
  bottom: 3px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--warna-utama);
  color: #fff;
  line-height: 1.1;
}

.selected-file-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.selected-file-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.selected-file-name {
  color: #1a2b3c;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.file-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 12px;
  background: #eef7eb;
  color: #3b7428;
  font-size: 11px;
  font-weight: 600;
}

.file-status-pill--pending {
  background: #eaf3fb;
  color: #2b6cb0;
}

.file-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #52a435;
}

.file-status-pill--pending .file-status-dot {
  background-color: #5798d7;
  animation: pulseDot 1s infinite alternate;
}

@keyframes pulseDot {
  from { opacity: 0.4; }
  to { opacity: 1; }
}

.selected-file-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #718196;
  font-size: 12px;
}

.meta-dot {
  color: #a0aec0;
}

.selected-file-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.file-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s ease;
}

.file-action-btn svg {
  width: 14px;
  height: 14px;
}

.file-action-btn--change {
  background: #f0f6fc;
  border-color: #d1e2f2;
  color: #2c4966;
}

.file-action-btn--change:hover:not(:disabled) {
  background: #e2effa;
  border-color: var(--warna-utama);
  color: var(--warna-utama);
}

.file-action-btn--remove {
  background: #fff5f5;
  border-color: #fed7d7;
  color: #c53030;
}

.file-action-btn--remove:hover:not(:disabled) {
  background: #fee2e2;
  border-color: #fc8181;
  color: #9b2c2c;
}

.file-action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ingest-input-panel textarea,
.ingest-inline-field select,
.ingest-col-field input,
.ingest-target-field select,
.ingest-target-field input {
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
  font-size: 13px;
}

.ingest-input-panel textarea {
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.ingest-text-toolbar,
.ingest-section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ingest-section-head h3,
.ingest-columns-editor h4 {
  margin: 0;
  color: #263a4e;
  font-size: 14px;
}

.ingest-meta-hint {
  margin: 0;
  color: var(--warna-redup);
  font-size: 13px;
}

.ingest-inline-field,
.ingest-target-field,
.ingest-col-field {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.ingest-inline-field {
  min-width: 180px;
}

.ingest-inline-field span,
.ingest-target-field span {
  color: #40566d;
  font-size: 12px;
  font-weight: 650;
}

.ingest-columns-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(175px, 1fr));
  gap: 8px;
  max-height: 220px;
  overflow: auto;
  padding: 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  background: #f8fbfe;
}

.ingest-col-field span {
  overflow: hidden;
  color: var(--warna-redup);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ingest-preview-viewport {
  max-height: 280px;
}

.ingest-target-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.ingest-summary-box,
.ingest-safety-note {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid #d5e5c4;
  border-radius: 9px;
  color: #365228;
  background: #f1f7e9;
  font-size: 13px;
}

.ingest-summary-box p {
  margin: 0;
  overflow-wrap: anywhere;
}

.ingest-empty-note {
  color: #5b4d1d;
}

.ingest-summary-list {
  display: grid;
  gap: 8px;
  margin: 0;
}

.ingest-summary-list > div {
  display: grid;
  grid-template-columns: minmax(120px, 0.35fr) minmax(0, 1fr);
  gap: 10px;
}

.ingest-summary-list dt {
  color: var(--warna-redup);
  font-size: 13px;
}

.ingest-summary-list dd {
  margin: 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.ingest-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

@media (max-width: 720px) {
  .ingest-dialog {
    width: calc(100vw - 24px);
    padding: 16px;
  }

  .ingest-target-grid,
  .ingest-summary-list > div {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
