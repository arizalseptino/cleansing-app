<template>
  <div class="workbench-page">
    <section class="kartu wb-source" :class="{ 'wb-source-etl': sourceMode === 'etl' }" aria-label="Sumber data">
      <div class="wb-source-title">
        <div class="wb-source-header">
          <div>
            <h2 class="card-title">Sumber</h2>
            <p v-if="sourceMode === 'database'">Tabel sumber tidak diubah oleh pratinjau.</p>
            <p v-else>Jalankan pipeline ETL Python otomatis dengan logika identik dan simpan ke ClickHouse.</p>
          </div>
          <div class="wb-mode-tabs" role="tablist" aria-label="Mode sumber data">
            <button
              type="button"
              role="tab"
              :aria-selected="sourceMode === 'database'"
              class="wb-mode-tab"
              :class="{ 'wb-mode-tab-active': sourceMode === 'database' }"
              @click="setSourceMode('database')"
            >
              Database
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="sourceMode === 'etl'"
              class="wb-mode-tab"
              :class="{ 'wb-mode-tab-active': sourceMode === 'etl' }"
              @click="setSourceMode('etl')"
            >
              ETL
            </button>
          </div>
        </div>
      </div>

      <template v-if="sourceMode === 'database'">
        <div class="wb-source-field">
          <label for="workbench-database">Database</label>
          <select
            id="workbench-database"
            :title="pipeline.source.database || 'Database'"
            :value="pipeline.source.database"
            :disabled="databasesPending || Boolean(databasesError)"
            @change="changeDatabase"
          >
            <option value="">Pilih database</option>
            <option v-for="database in databases" :key="database.name" :value="database.name">
              {{ database.name }}
            </option>
          </select>
        </div>
        <div class="wb-source-field">
          <label for="workbench-table">Tabel sumber</label>
          <select
            id="workbench-table"
            :title="pipeline.source.table || 'Tabel sumber'"
            :value="pipeline.source.table"
            :disabled="!pipeline.source.database || tablesPending || Boolean(tablesError)"
            @change="changeTable"
          >
            <option value="">Pilih tabel</option>
            <option v-for="table in tables" :key="table.name" :value="table.name">
              {{ table.name }}
            </option>
          </select>
        </div>
        <button
          class="wb-button wb-primary wb-save-open"
          type="button"
          :disabled="!canOpenSave"
          @click="openSaveDialog"
        >
          Simpan sebagai tabel baru
        </button>
        <p v-if="databasesPending" class="wb-message" role="status">Memuat daftar database...</p>
        <p v-else-if="databasesError" class="wb-message wb-error" role="alert">
          {{ databasesError }} <button class="wb-link-button" type="button" @click="loadDatabases">Coba lagi</button>
        </p>
        <p v-if="tablesPending" class="wb-message" role="status">Memuat daftar tabel...</p>
        <p v-else-if="tablesError" class="wb-message wb-error" role="alert">
          {{ tablesError }} <button class="wb-link-button" type="button" @click="loadTables(pipeline.source.database)">Coba lagi</button>
        </p>
        <p v-if="persistenceError" class="wb-message wb-error" role="alert">{{ persistenceError }}</p>
      </template>

      <template v-else>
        <div class="wb-etl-controls">
          <div class="wb-source-field wb-etl-pipeline-select">
            <label for="etl-pipeline-select">Pilih Pipeline ETL</label>
            <select
              id="etl-pipeline-select"
              :value="etlPipeline"
              :disabled="etlProcessing || etlSyncing"
              @change="changeEtlPipeline"
            >
              <option v-for="opt in etlPipelineOptions" :key="opt.id" :value="opt.id">
                {{ opt.label }}
              </option>
            </select>
            <small class="wb-etl-hint">Target: <code>{{ activeEtlMeta.targetTable }}</code></small>
          </div>

          <div class="wb-etl-dynamic-input">
            <template v-if="etlPipeline === 'media_humas'">
              <div class="wb-source-field">
                <div class="wb-etl-input-top">
                  <label for="etl-wa-textarea">Teks Rekap Broadcast WA (atau unggah .txt)</label>
                  <div class="wb-etl-inline-tools">
                    <label class="wb-button wb-small wb-file-label">
                      Unggah .txt
                      <input
                        type="file"
                        accept=".txt,text/plain"
                        :disabled="etlProcessing || etlSyncing"
                        @change="handleEtlFileChange"
                      />
                    </label>
                    <button
                      v-if="etlFile || etlRawText"
                      type="button"
                      class="wb-button wb-small"
                      :disabled="etlProcessing || etlSyncing"
                      @click="clearEtlInputs"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
                <textarea
                  id="etl-wa-textarea"
                  v-model="etlRawText"
                  class="wb-etl-textarea"
                  rows="5"
                  :disabled="etlProcessing || etlSyncing"
                  placeholder="Tempel teks broadcast WA di sini (beserta periode tanggal &amp; header seksi seperti Media Online:, Berita Unit:, Media Sosial:)..."
                />
                <p v-if="etlFile" class="wb-etl-file-chip">
                  File terpilih: <strong>{{ etlFile.name }}</strong> ({{ formatFileSize(etlFile.size) }})
                </p>
              </div>
            </template>

            <template v-else-if="etlPipeline === 'peserta_vpl'">
              <div class="wb-etl-vpl-wrap">
                <div class="wb-etl-vpl-grid">
                  <div class="wb-source-field">
                    <label>File Excel VPL 2025 (opsional jika hanya memproses 2026)</label>
                    <div
                      class="wb-dropzone wb-etl-dropzone"
                      :class="{ 'wb-dropzone-active': etlDragActive2025 }"
                      @dragover.prevent="etlDragActive2025 = true"
                      @dragleave.prevent="etlDragActive2025 = false"
                      @drop.prevent="handleEtlVplDrop('2025', $event)"
                    >
                      <template v-if="etlFile2025">
                        <p>
                          <strong>{{ etlFile2025.name }}</strong> ({{ formatFileSize(etlFile2025.size) }})
                        </p>
                        <div class="wb-etl-file-actions">
                          <label class="wb-button wb-small wb-file-label">
                            Ganti file 2025
                            <input
                              type="file"
                              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                              :disabled="etlProcessing || etlSyncing"
                              @change="handleEtlVplFileChange('2025', $event)"
                            />
                          </label>
                          <button
                            type="button"
                            class="wb-button wb-small"
                            :disabled="etlProcessing || etlSyncing"
                            @click="clearEtlVplFile('2025')"
                          >
                            Hapus
                          </button>
                        </div>
                      </template>
                      <template v-else>
                        <p>Tarik dan lepas file <code>.xlsx</code> VPL 2025 ke sini, atau pilih file</p>
                        <label class="wb-button wb-small wb-file-label">
                          Pilih file VPL 2025 (.xlsx)
                          <input
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            :disabled="etlProcessing || etlSyncing"
                            @change="handleEtlVplFileChange('2025', $event)"
                          />
                        </label>
                      </template>
                    </div>
                    <small class="wb-etl-hint">Contoh: <code>Data Peserta VPL Series ATA-X Ditekdijar.xlsx</code></small>
                  </div>

                  <div class="wb-source-field">
                    <label>File Excel VPL 2026 (opsional jika hanya memproses 2025)</label>
                    <div
                      class="wb-dropzone wb-etl-dropzone"
                      :class="{ 'wb-dropzone-active': etlDragActive2026 }"
                      @dragover.prevent="etlDragActive2026 = true"
                      @dragleave.prevent="etlDragActive2026 = false"
                      @drop.prevent="handleEtlVplDrop('2026', $event)"
                    >
                      <template v-if="etlFile2026">
                        <p>
                          <strong>{{ etlFile2026.name }}</strong> ({{ formatFileSize(etlFile2026.size) }})
                        </p>
                        <div class="wb-etl-file-actions">
                          <label class="wb-button wb-small wb-file-label">
                            Ganti file 2026
                            <input
                              type="file"
                              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                              :disabled="etlProcessing || etlSyncing"
                              @change="handleEtlVplFileChange('2026', $event)"
                            />
                          </label>
                          <button
                            type="button"
                            class="wb-button wb-small"
                            :disabled="etlProcessing || etlSyncing"
                            @click="clearEtlVplFile('2026')"
                          >
                            Hapus
                          </button>
                        </div>
                      </template>
                      <template v-else>
                        <p>Tarik dan lepas file <code>.xlsx</code> VPL 2026 ke sini, atau pilih file</p>
                        <label class="wb-button wb-small wb-file-label">
                          Pilih file VPL 2026 (.xlsx)
                          <input
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            :disabled="etlProcessing || etlSyncing"
                            @change="handleEtlVplFileChange('2026', $event)"
                          />
                        </label>
                      </template>
                    </div>
                    <small class="wb-etl-hint">Contoh: <code>Data VPL 2026 Seri 1 dan 2.xlsx</code></small>
                  </div>
                </div>
                <small class="wb-etl-hint">
                  Unggah minimal satu file (2025 atau 2026). Jika keduanya diunggah, data digabung berurutan (2025 lalu 2026) dengan kolom <code>id</code> berurutan tunggal <code>1..N</code>.
                </small>
              </div>
            </template>

            <template v-else-if="etlPipeline === 'anggaran_sp2d'">
              <div class="wb-etl-excel-wrap wb-etl-excel-with-date">
                <div class="wb-source-field">
                  <label>File Excel (.xlsx)</label>
                  <div
                    class="wb-dropzone wb-etl-dropzone"
                    :class="{ 'wb-dropzone-active': etlDragActive }"
                    @dragover.prevent="etlDragActive = true"
                    @dragleave.prevent="etlDragActive = false"
                    @drop.prevent="handleEtlDrop"
                  >
                    <template v-if="etlFile">
                      <p>
                        <strong>{{ etlFile.name }}</strong> ({{ formatFileSize(etlFile.size) }})
                      </p>
                      <div class="wb-etl-file-actions">
                        <label class="wb-button wb-small wb-file-label">
                          Ganti file .xlsx
                          <input
                            type="file"
                            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            :disabled="etlProcessing || etlSyncing"
                            @change="handleEtlFileChange"
                          />
                        </label>
                        <button
                          type="button"
                          class="wb-button wb-small"
                          :disabled="etlProcessing || etlSyncing"
                          @click="clearEtlFile"
                        >
                          Hapus
                        </button>
                      </div>
                    </template>
                    <template v-else>
                      <p>Tarik dan lepas file <code>.xlsx</code> ke sini, atau pilih file</p>
                      <label class="wb-button wb-small wb-file-label">
                        Pilih file Excel (.xlsx)
                        <input
                          type="file"
                          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          :disabled="etlProcessing || etlSyncing"
                          @change="handleEtlFileChange"
                        />
                      </label>
                    </template>
                  </div>
                </div>

                <div class="wb-source-field">
                  <label for="etl-sp2d-date">Tanggal Realisasi</label>
                  <input
                    id="etl-sp2d-date"
                    v-model="etlTanggalRealisasi"
                    type="date"
                    class="wb-etl-date-input"
                    :disabled="etlProcessing || etlSyncing"
                  />
                  <small class="wb-etl-hint">Disimpan pada kolom <code>tahun</code> (YYYY-MM-DD).</small>
                </div>
              </div>
            </template>

            <template v-else-if="etlPipeline === 'course_es'">
              <div class="wb-etl-course-wrap">
                <div class="wb-source-field">
                  <span class="wb-field-label">Sumber Data</span>
                  <div class="wb-etl-source-toggle" role="radiogroup" aria-label="Sumber data Course Elasticsearch">
                    <label
                      class="wb-etl-radio-option"
                      :class="{ 'wb-etl-radio-active': etlCourseEsSourceMode === 'api' }"
                    >
                      <input
                        v-model="etlCourseEsSourceMode"
                        type="radio"
                        name="course-es-source-mode"
                        value="api"
                        :disabled="etlProcessing || etlSyncing"
                        @change="onCourseEsSourceModeChange"
                      />
                      <span>Server Elasticsearch (API)</span>
                    </label>
                    <label
                      class="wb-etl-radio-option"
                      :class="{ 'wb-etl-radio-active': etlCourseEsSourceMode === 'file' }"
                    >
                      <input
                        v-model="etlCourseEsSourceMode"
                        type="radio"
                        name="course-es-source-mode"
                        value="file"
                        :disabled="etlProcessing || etlSyncing"
                        @change="onCourseEsSourceModeChange"
                      />
                      <span>Unggah File Export (.json / .csv)</span>
                    </label>
                  </div>
                </div>

                <div v-if="etlCourseEsSourceMode === 'api'" class="wb-etl-date-grid">
                  <div class="wb-source-field">
                    <label for="etl-es-start">Dari Tanggal (<code>updatedAt</code>)</label>
                    <input
                      id="etl-es-start"
                      v-model="etlStartDate"
                      type="date"
                      class="wb-etl-date-input"
                      :disabled="etlProcessing || etlSyncing"
                    />
                  </div>
                  <div class="wb-source-field">
                    <label for="etl-es-end">Sampai Tanggal (<code>updatedAt</code>)</label>
                    <input
                      id="etl-es-end"
                      v-model="etlEndDate"
                      type="date"
                      class="wb-etl-date-input"
                      :disabled="etlProcessing || etlSyncing"
                    />
                  </div>
                </div>

                <div v-else class="wb-etl-file-mode">
                  <div class="wb-source-field">
                    <label>File Export Elasticsearch (.json / .csv)</label>
                    <div
                      class="wb-dropzone wb-etl-dropzone"
                      :class="{ 'wb-dropzone-active': etlDragActive }"
                      @dragover.prevent="etlDragActive = true"
                      @dragleave.prevent="etlDragActive = false"
                      @drop.prevent="handleEtlDrop"
                    >
                      <template v-if="etlFile">
                        <p>
                          <strong>{{ etlFile.name }}</strong> ({{ formatFileSize(etlFile.size) }})
                        </p>
                        <div class="wb-etl-file-actions">
                          <label class="wb-button wb-small wb-file-label">
                            Ganti file .json / .csv
                            <input
                              type="file"
                              accept=".json,.csv,application/json,text/csv"
                              :disabled="etlProcessing || etlSyncing"
                              @change="handleEtlFileChange"
                            />
                          </label>
                          <button
                            type="button"
                            class="wb-button wb-small"
                            :disabled="etlProcessing || etlSyncing"
                            @click="clearEtlFile"
                          >
                            Hapus
                          </button>
                        </div>
                      </template>
                      <template v-else>
                        <p>Tarik dan lepas file <code>.json</code> (array, NDJSON, atau <code>hits.hits</code>) atau <code>.csv</code> ke sini, atau pilih file</p>
                        <label class="wb-button wb-small wb-file-label">
                          Pilih file (.json / .csv)
                          <input
                            type="file"
                            accept=".json,.csv,application/json,text/csv"
                            :disabled="etlProcessing || etlSyncing"
                            @change="handleEtlFileChange"
                          />
                        </label>
                      </template>
                    </div>
                  </div>

                  <div class="wb-etl-date-grid">
                    <div class="wb-source-field">
                      <label for="etl-es-file-start">Dari Tanggal (<code>updatedAt</code>, opsional)</label>
                      <input
                        id="etl-es-file-start"
                        v-model="etlFileStartDate"
                        type="date"
                        class="wb-etl-date-input"
                        :disabled="etlProcessing || etlSyncing"
                      />
                    </div>
                    <div class="wb-source-field">
                      <label for="etl-es-file-end">Sampai Tanggal (<code>updatedAt</code>, opsional)</label>
                      <input
                        id="etl-es-file-end"
                        v-model="etlFileEndDate"
                        type="date"
                        class="wb-etl-date-input"
                        :disabled="etlProcessing || etlSyncing"
                      />
                    </div>
                  </div>
                  <small class="wb-etl-hint">
                    Filter tanggal bersifat opsional. Kosongkan untuk memproses seluruh data di dalam file.
                    <button
                      v-if="etlFileStartDate || etlFileEndDate"
                      type="button"
                      class="wb-link-button"
                      :disabled="etlProcessing || etlSyncing"
                      @click="clearEtlCourseFileDates"
                    >
                      Reset tanggal
                    </button>
                  </small>
                </div>
              </div>
            </template>
          </div>

          <div class="wb-etl-submit-wrap">
            <button
              class="wb-button wb-primary wb-save-open"
              type="button"
              :disabled="!canRunEtl || etlProcessing || etlSyncing"
              @click="runEtlPipeline('preview')"
            >
              {{ etlProcessing ? 'Memproses...' : 'Proses Data' }}
            </button>
          </div>
        </div>
        <p v-if="etlError" class="wb-etl-banner wb-etl-banner-error" role="alert">{{ etlError }}</p>
      </template>
    </section>

    <div v-if="sourceMode === 'database'" class="wb-grid">
      <section class="kartu wb-steps-card" aria-label="Langkah cleansing">
        <div class="wb-card-heading">
          <div>
            <p class="page-kicker">Pipeline</p>
            <h2 class="card-title">Langkah</h2>
          </div>
          <button class="wb-button wb-small" type="button" :disabled="!sourceReady" @click="showOperations">
            Tambah langkah
          </button>
        </div>

        <p v-if="!sourceReady" class="wb-message">Pilih database dan tabel untuk memulai.</p>
        <template v-else>
          <button
            class="wb-step wb-source-step"
            :class="{ 'wb-step-selected': selectedStep === 0 }"
            type="button"
            @click="selectStep(0)"
          >
            <span class="wb-step-number">0</span>
            <span class="wb-step-copy">
              <strong>Data sumber</strong>
              <small :title="pipeline.source.table">{{ pipeline.source.table }}</small>
            </span>
            <span class="wb-status wb-status-valid">Sumber</span>
          </button>

          <ol v-if="pipeline.steps.length" class="wb-step-list">
            <li v-for="(step, index) in pipeline.steps" :key="step.id">
              <div class="wb-step-row">
                <button
                  class="wb-step"
                  :class="{ 'wb-step-selected': selectedStep === index + 1 }"
                  type="button"
                  @click="selectStep(index + 1)"
                >
                  <span class="wb-step-number">{{ index + 1 }}</span>
                  <span class="wb-step-copy">
                    <strong :title="operationName(step.op)">{{ operationName(step.op) }}</strong>
                    <small :title="touchedColumns(step).join(', ')">{{ touchedColumns(step).join(', ') || 'Tanpa kolom langsung' }}</small>
                  </span>
                  <span class="wb-status" :class="`wb-status-${stepStates[index]?.status ?? 'loading'}`">
                    {{ stepStatusLabel(stepStates[index]?.status) }}
                  </span>
                </button>
                <div class="wb-step-tools">
                  <button
                    class="wb-icon-button"
                    type="button"
                    :disabled="index === 0"
                    :aria-label="`Geser langkah ${index + 1} ke atas`"
                    @click="moveStep(index, -1)"
                  >Naik</button>
                  <button
                    class="wb-icon-button"
                    type="button"
                    :disabled="index === pipeline.steps.length - 1"
                    :aria-label="`Geser langkah ${index + 1} ke bawah`"
                    @click="moveStep(index, 1)"
                  >Turun</button>
                  <button class="wb-icon-button" type="button" @click="editStep(index)">Edit</button>
                  <button class="wb-icon-button wb-danger-text" type="button" @click="deleteStep(index)">Hapus</button>
                </div>
                <p v-if="stepStates[index]?.status === 'error'" class="wb-step-error" role="alert">
                  {{ stepStates[index]?.message }}
                </p>
                <p v-for="warning in stepStates[index]?.warnings ?? []" :key="warning" class="wb-message" role="status">
                  {{ warning }}
                </p>
              </div>
            </li>
          </ol>
          <p v-else class="wb-message">Belum ada langkah. Tambahkan operasi untuk membentuk hasil.</p>
        </template>

        <div v-if="importSummary" class="wb-import-summary" role="status">
          <p>
            <strong>Cleansing template "{{ importSummary.name }}":</strong>
            {{ importSummary.valid }} langkah valid, {{ importSummary.invalid }} langkah bermasalah.
          </p>
          <p v-if="importSummary.suggestedSourceNote" class="wb-import-note">
            {{ importSummary.suggestedSourceNote }}
          </p>
          <div class="wb-import-summary-actions">
            <button
              v-if="missingColumnReferences.length > 0"
              class="wb-button wb-small"
              type="button"
              @click="openMappingDialog"
            >
              Pemetaan kolom ({{ missingColumnReferences.length }})
            </button>
            <button class="wb-link-button" type="button" @click="importSummary = null">Tutup ringkasan</button>
          </div>
        </div>

        <button
          class="wb-sql-link"
          type="button"
          :disabled="!sourceReady || pipeline.steps.length === 0"
          @click="openSql"
        >
          Lihat SQL
        </button>

        <div class="wb-template-actions">
          <button
            class="wb-button wb-small"
            type="button"
            :disabled="!sourceReady || pipeline.steps.length === 0"
            @click="openExportDialog"
          >
            Ekspor cleansing template
          </button>
          <button class="wb-button wb-small" type="button" @click="openImportDialog">
            Impor cleansing template
          </button>
        </div>
      </section>

      <section class="kartu wb-data-card" aria-label="Data keluaran">
        <div class="wb-card-heading wb-data-heading">
          <div class="wb-data-title">
            <p class="page-kicker">Pratinjau</p>
            <div class="wb-data-title-row">
              <h2 class="card-title">{{ selectedStep === 0 ? 'Data sumber' : `Hasil langkah ${selectedStep}` }}</h2>
              <div v-if="previewIsSampled && sourceReady" ref="sampleInfoRef" class="wb-sample-inline">
                <span class="wb-sample-badge">Sampel {{ numberFormat(previewSampleLimit) }} baris</span>
                <div
                  class="wb-sample-info-wrap"
                  @mouseenter="sampleTooltipHover = true"
                  @mouseleave="sampleTooltipHover = false"
                >
                  <button
                    type="button"
                    class="wb-sample-info-btn"
                    aria-label="Informasi sampel pratinjau"
                    :aria-expanded="sampleTooltipVisible"
                    aria-controls="wb-sample-popover"
                    @click.stop="toggleSampleTooltip"
                    @keydown.escape="closeSampleTooltip"
                  >
                    ⓘ
                  </button>
                </div>
                <div
                  v-if="sampleTooltipVisible"
                  id="wb-sample-popover"
                  class="wb-sample-popover"
                  role="tooltip"
                  @mouseenter="sampleTooltipHover = true"
                  @mouseleave="sampleTooltipHover = false"
                >
                  Pratinjau memakai {{ numberFormat(previewSampleLimit) }} baris pertama agar respons cepat (termasuk untuk deduplikasi &amp; nomor urut). Simpan tabel tetap memproses seluruh data.
                </div>
              </div>
            </div>
          </div>
          <label class="wb-limit-field" for="workbench-limit">
            Baris per halaman
            <select id="workbench-limit" :value="limit" @change="changeLimit">
              <option :value="25">25</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </label>
        </div>
        <div v-if="previewPending" class="wb-data-actions">
          <span class="wb-inline-status" role="status">Sedang menghitung pratinjau...</span>
        </div>
        <div v-if="displayFilter" class="wb-filter-chip" role="status">
          <span>
            <strong>Penyaring tampilan</strong> (hanya memengaruhi tampilan pratinjau, tidak ikut pipeline atau tabel hasil):
            <code>{{ displayFilter.column }}</code>
            <template v-if="displayFilter.kind === 'contains'"> mengandung </template>
            <template v-else> = </template>
            <code>{{ displayFilter.label }}</code>
          </span>
          <button class="wb-icon-button" type="button" @click="clearDisplayFilter">Lepas penyaring</button>
        </div>
        <p v-for="warning in previewWarnings" :key="warning" class="wb-message" role="status">{{ warning }}</p>
        <p v-if="!sourceReady" class="wb-message">Pilih sumber untuk melihat data.</p>
        <p v-else-if="previewPending && previewRows.length === 0" class="wb-message" role="status">Memuat data...</p>
        <p v-else-if="previewError" class="wb-message wb-error" role="alert">{{ previewError }}</p>
        <p v-else-if="previewRows.length === 0" class="wb-message" role="status">Tidak ada baris pada halaman ini.</p>
        <template v-else>
          <div class="wb-table-viewport">
            <table class="wb-table">
              <thead>
                <tr>
                  <th v-for="column in visibleColumns" :key="column.name" scope="col">
                    <div class="wb-column-heading">
                      <button
                        class="wb-column-menu-button"
                        type="button"
                        :aria-expanded="activeColumnMenu === column.name"
                        @click="toggleColumnMenu(column.name)"
                      >
                        <span class="wb-column-name" :title="column.name">{{ column.name }}</span>
                      </button>
                      <small :title="column.type">{{ column.type }}</small>
                      <span
                        v-if="previewIsSampled && previewSequenceColumns.has(column.name)"
                        class="wb-col-sample-tag"
                        :title="`Nomor urut pada kolom ${column.name} di pratinjau hanya dihitung dari sampel ${numberFormat(previewSampleLimit)} baris pertama`"
                      >
                        Sampel nomor urut
                      </span>
                      <div v-if="activeColumnMenu === column.name" class="wb-column-menu">
                        <strong>Operasi untuk {{ column.name }}</strong>
                        <button
                          v-for="operation in columnOperations(column)"
                          :key="operation.id"
                          type="button"
                          @click="chooseOperation(operation, column.name)"
                        >
                          {{ operation.name }}
                        </button>
                        <p v-if="columnOperations(column).length === 0">Tidak ada operasi yang cocok.</p>
                      </div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in previewRows" :key="`${page}-${rowIndex}`">
                  <td v-for="column in visibleColumns" :key="column.name">
                    <span
                      class="wb-cell"
                      :class="{
                        'wb-cell-null': row[column.name] === null,
                        'wb-cell-empty': row[column.name] === '',
                        'wb-cell-changed': isChanged(row, column.name),
                      }"
                      :title="cellTitle(row, column.name)"
                    >
                      {{ displayValue(row[column.name]) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <nav class="wb-pagination" aria-label="Halaman data pratinjau">
            <span v-if="previewIsSampled">
              Total baris pratinjau (sampel maks. {{ numberFormat(previewSampleLimit) }} baris): <strong>{{ numberFormat(totalRows) }}</strong> baris · Halaman {{ page }} dari {{ totalPages }}
            </span>
            <span v-else>
              {{ numberFormat(totalRows) }} baris · Halaman {{ page }} dari {{ totalPages }}
            </span>
            <div>
              <button class="wb-button wb-small" type="button" :disabled="page <= 1 || previewPending" @click="changePage(page - 1)">
                Sebelumnya
              </button>
              <button class="wb-button wb-small" type="button" :disabled="page >= totalPages || previewPending" @click="changePage(page + 1)">
                Berikutnya
              </button>
            </div>
          </nav>
        </template>

        <section class="wb-rare-panel" aria-label="Cek Sisa Anomali / Typo (Frekuensi Rendah)">
          <div class="wb-rare-heading">
            <div class="wb-rare-title-row">
              <h3>Cek Sisa Anomali / Typo (Frekuensi Rendah)</h3>
              <span class="wb-full-data-badge">Dihitung dari seluruh data</span>
            </div>
            <p>Periksa sisa nilai teks berfrekuensi rendah yang berpotensi anomali atau typo setelah langkah ke-{{ selectedStep }} (dihitung dari seluruh data, terpisah dari sampel pratinjau {{ numberFormat(previewSampleLimit) }} baris). Klik nilai untuk menyaring tampilan pratinjau.</p>
          </div>

          <p v-if="!sourceReady" class="wb-message">Pilih database dan tabel sumber untuk mengecek sisa anomali atau typo (frekuensi rendah).</p>
          <p v-else-if="rareTextColumns.length === 0" class="wb-message">Tidak ada kolom bertipe teks pada langkah ini.</p>
          <template v-else>
            <form class="wb-rare-controls" @submit.prevent="loadRareValues">
              <label>
                <span>Kolom teks</span>
                <select v-model="rareColumn">
                  <option value="">Pilih kolom teks</option>
                  <option v-for="col in rareTextColumns" :key="col.name" :value="col.name">
                    {{ col.name }} ({{ col.type }})
                  </option>
                </select>
              </label>
              <label>
                <span>Ambang N (1-1000)</span>
                <input v-model.number="rareThreshold" type="number" min="1" max="1000" required />
              </label>
              <label>
                <span>Cari nilai</span>
                <input v-model="rareSearch" type="text" maxlength="200" placeholder="Potongan teks..." />
              </label>
              <label>
                <span>Batas daftar (maks. 200)</span>
                <input v-model.number="rareLimit" type="number" min="1" max="200" required />
              </label>
              <div class="wb-rare-toggles">
                <label class="wb-rare-check">
                  <input v-model="rareExcludeNull" type="checkbox" />
                  <span>Kecualikan (NULL)</span>
                </label>
                <label class="wb-rare-check">
                  <input v-model="rareExcludeEmpty" type="checkbox" />
                  <span>Kecualikan (kosong)</span>
                </label>
              </div>
              <button class="wb-button wb-small wb-primary" type="submit" :disabled="!rareColumn || rarePending">
                {{ rarePending ? 'Menganalisis seluruh data...' : 'Cek Anomali / Typo' }}
              </button>
            </form>

            <p v-if="rarePending" class="wb-rare-loading" role="status">
              Sedang menghitung nilai frekuensi rendah dari seluruh data... Proses ini memeriksa seluruh tabel tanpa sampel sehingga dapat memakan waktu lebih lama.
            </p>
            <p v-if="rareError" class="wb-message wb-error" role="alert">{{ rareError }}</p>
            <template v-else-if="rareResult">
              <p class="wb-rare-summary" role="status">
                <strong>{{ numberFormat(rareResult.summary.uniqueValues) }}</strong> nilai unik ·
                <strong>{{ numberFormat(rareResult.summary.rareValues) }}</strong> nilai frekuensi rendah (&lt; {{ rareResult.threshold }}) ·
                <strong>{{ numberFormat(rareResult.summary.affectedRows) }}</strong> baris terdampak ·
                <span>dihitung dari seluruh data</span>
              </p>

              <div v-if="selectedRareItems.length > 0" class="wb-rare-bulk">
                <span>{{ selectedRareItems.length }} nilai dipilih</span>
                <div>
                  <button class="wb-button wb-small wb-primary" type="button" @click="createReplaceFromRare">
                    Buat langkah ganti nilai
                  </button>
                  <button class="wb-button wb-small" type="button" @click="selectedRareKeys = []">
                    Batal pilih
                  </button>
                </div>
              </div>

              <p v-if="rareResult.items.length === 0" class="wb-message">
                Tidak ditemukan sisa anomali atau typo dengan kemunculan kurang dari {{ rareResult.threshold }}.
              </p>
              <ul v-else class="wb-rare-list">
                <li
                  v-for="(item, itemIdx) in rareResult.items"
                  :key="`${item.jenis}-${item.nilai}-${itemIdx}`"
                  :class="{ 'wb-rare-item-active': isRareItemFiltered(item) }"
                >
                  <input
                    v-model="selectedRareKeys"
                    type="checkbox"
                    :value="rareItemKey(item)"
                    :aria-label="`Pilih nilai ${item.nilai}`"
                  />
                  <button
                    class="wb-rare-value-btn"
                    type="button"
                    :title="`Saring pratinjau untuk ${item.nilai}`"
                    @click="toggleRareDisplayFilter(item)"
                  >
                    <span
                      :class="{
                        'wb-cell-null': item.jenis === 'null',
                        'wb-cell-empty': item.jenis === 'empty',
                      }"
                    >
                      {{ item.nilai }}
                    </span>
                  </button>
                  <span class="wb-rare-count">{{ numberFormat(item.jumlah) }}</span>
                </li>
              </ul>
            </template>
          </template>
        </section>
      </section>

      <section class="kartu wb-operations-card" aria-label="Operasi">
        <div class="wb-card-heading">
          <div>
            <p class="page-kicker">Buat perubahan</p>
            <h2 class="card-title">Operasi</h2>
          </div>
          <button v-if="selectedOperation" class="wb-link-button" type="button" @click="resetOperationForm">
            Kembali
          </button>
        </div>
        <p v-if="operationsPending" class="wb-message" role="status">Memuat daftar operasi...</p>
        <p v-else-if="operationsError" class="wb-message wb-error" role="alert">
          {{ operationsError }} <button class="wb-link-button" type="button" @click="loadOperations">Coba lagi</button>
        </p>
        <template v-else-if="selectedOperation">
          <h3 class="wb-operation-name">{{ selectedOperation.name }}</h3>
          <p v-if="masterColumnsError" class="wb-message wb-error" role="alert">{{ masterColumnsError }}</p>
          <WorkbenchOperationForm
            :key="formKey"
            :operation="selectedOperation"
            :schema="schemaBeforeSelectedStep"
            :master-columns="masterColumns"
            :databases="databases"
            :tables-by-database="tablesByDatabase"
            :initial-params="formInitialParams"
            :editing="editingStepIndex !== null"
            :prefilled-column="prefilledColumn"
            @submit="commitForm"
            @database-change="loadTables"
            @table-change="loadMasterColumns"
          />
        </template>
        <template v-else>
          <p class="wb-message">Pilih operasi untuk mengatur langkah baru.</p>
          <ul class="wb-operation-list">
            <li v-for="operation in operations" :key="operation.id">
              <button type="button" :disabled="!sourceReady" @click="chooseOperation(operation)">
                <strong>{{ operation.name }}</strong>
                <span>{{ operation.description }}</span>
              </button>
            </li>
          </ul>
        </template>
      </section>
    </div>

    <section v-else class="kartu wb-etl-preview-card" aria-label="Pratinjau Hasil ETL">
      <div class="wb-card-heading wb-data-heading">
        <div class="wb-data-title">
          <p class="page-kicker">Pratinjau</p>
          <div class="wb-data-title-row">
            <h2 class="card-title">Hasil Pipeline {{ activeEtlMeta.label }}</h2>
            <span v-if="etlResult" class="wb-sample-badge">
              {{ etlPreviewBadgeText }}
            </span>
          </div>
        </div>

        <div class="wb-etl-header-actions">
          <label class="wb-limit-field" for="etl-limit">
            Baris per halaman
            <select id="etl-limit" :value="etlLimit" @change="changeEtlLimit">
              <option :value="25">25</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </label>
          <button
            class="wb-button"
            type="button"
            :disabled="!etlResult || !etlResult.download_token || etlProcessing || etlSyncing"
            @click="downloadEtlCsv"
          >
            Unduh CSV
          </button>
          <button
            class="wb-button wb-primary"
            type="button"
            :disabled="!etlResult || etlResult.total_rows === 0 || etlProcessing || etlSyncing"
            @click="runEtlPipeline('sync_db')"
          >
            {{ etlSyncing ? 'Menyimpan...' : `Simpan ke ${activeEtlMeta.targetTable}` }}
          </button>
          <button
            class="wb-button"
            type="button"
            :disabled="!etlResult || etlResult.total_rows === 0 || etlProcessing || etlSyncing || applying"
            @click="openEtlSaveDialog"
          >
            Simpan sebagai tabel baru
          </button>
        </div>
      </div>

      <p v-if="etlSyncMessage" class="wb-etl-banner wb-etl-banner-success" role="status">
        {{ etlSyncMessage }}
      </p>
      <p v-if="etlProcessing" class="wb-message" role="status">
        Sedang menjalankan skrip Python ETL. Mohon tunggu...
      </p>
      <p v-else-if="!etlResult" class="wb-message">
        Pilih pipeline ETL, lengkapi input di atas, lalu klik <strong>Proses Data</strong> untuk melihat pratinjau hasil.
      </p>
      <template v-else>
        <div v-if="etlSummaryChips.length" class="wb-etl-summary-bar" role="status">
          <span v-for="chip in etlSummaryChips" :key="chip.label" class="wb-etl-summary-chip">
            <strong>{{ chip.label }}:</strong> {{ chip.value }}
          </span>
        </div>
        <p v-if="etlResult.rows.length === 0" class="wb-message" role="status">
          {{ etlResult.message || 'Tidak ada baris hasil.' }}
        </p>
        <template v-else>
          <div class="wb-table-viewport">
            <table class="wb-table">
              <thead>
                <tr>
                  <th v-for="col in etlResult.columns" :key="col" scope="col">
                    <div class="wb-column-heading">
                      <span class="wb-column-name" :title="col">{{ col }}</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIdx) in etlPagedRows" :key="`${etlPage}-${rowIdx}`">
                  <td v-for="col in etlResult.columns" :key="col">
                    <span
                      class="wb-cell"
                      :class="{
                        'wb-cell-null': row[col] === null,
                        'wb-cell-empty': row[col] === '',
                      }"
                      :title="displayValue(row[col])"
                    >
                      {{ displayValue(row[col]) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <nav class="wb-pagination" aria-label="Halaman data pratinjau ETL">
            <span>
              Total: <strong>{{ numberFormat(etlResult.total_rows) }}</strong> baris · Halaman {{ etlPage }} dari {{ etlTotalPages }}
            </span>
            <div>
              <button class="wb-button wb-small" type="button" :disabled="etlPage <= 1" @click="changeEtlPage(etlPage - 1)">
                Sebelumnya
              </button>
              <button class="wb-button wb-small" type="button" :disabled="etlPage >= etlTotalPages" @click="changeEtlPage(etlPage + 1)">
                Berikutnya
              </button>
            </div>
          </nav>
        </template>
      </template>
    </section>

    <div v-if="showSqlPanel || showSaveDialog || showExportDialog || showImportDialog || showMappingDialog" class="wb-backdrop" @click.self="closePanels" />
    <section
      v-if="showSqlPanel"
      class="kartu wb-dialog wb-sql-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wb-sql-title"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <div class="wb-dialog-heading">
        <h2 id="wb-sql-title" class="card-title">SQL pratinjau</h2>
        <button class="wb-icon-button" type="button" @click="showSqlPanel = false">Tutup</button>
      </div>
      <p class="wb-message">Query ini hanya untuk dibaca. Parameter dikirim terpisah.</p>
      <p v-if="sqlPending" class="wb-message" role="status">Memuat SQL...</p>
      <p v-else-if="sqlError" class="wb-message wb-error" role="alert">{{ sqlError }}</p>
      <template v-else-if="sqlResult">
        <pre class="wb-code">{{ sqlResult.sql }}</pre>
        <h3>Parameter</h3>
        <pre class="wb-code">{{ formatJson(sqlResult.params) }}</pre>
        <button class="wb-button" type="button" @click="copySql">
          {{ sqlCopied ? 'Disalin' : 'Salin SQL' }}
        </button>
        <button class="wb-button" type="button" @click="copyParameters">
          {{ parametersCopied ? 'Parameter disalin' : 'Salin parameter' }}
        </button>
        <p v-if="copyError" class="wb-error" role="alert">{{ copyError }}</p>
      </template>
    </section>

    <section
      v-if="showSaveDialog"
      class="kartu wb-dialog wb-save-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wb-save-title"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <div class="wb-dialog-heading">
        <h2 id="wb-save-title" class="card-title">{{ applyResult ? 'Tabel baru berhasil dibuat' : 'Simpan sebagai tabel baru' }}</h2>
        <button v-if="!applying" class="wb-icon-button" type="button" @click="closeSaveDialog">Tutup</button>
      </div>
      <template v-if="applyResult">
        <p class="wb-safety-note">
          {{ saveDialogMode === 'database' ? 'Tabel sumber tetap tidak diubah.' : 'Tabel bawaan ETL tetap tidak diubah.' }}
        </p>
        <dl class="wb-summary">
          <div><dt>Tabel hasil</dt><dd><code>{{ applyResult.database }}.{{ applyResult.table }}</code></dd></div>
          <div><dt>Jumlah baris</dt><dd>{{ numberFormat(applyResult.rows) }}</dd></div>
          <div v-if="saveDialogMode === 'database'"><dt>Jumlah langkah</dt><dd>{{ numberFormat(applyResult.steps) }}</dd></div>
          <div><dt>Durasi</dt><dd>{{ applyResult.durationMs === undefined ? 'Tidak dikirim API' : `${numberFormat(applyResult.durationMs)} ms` }}</dd></div>
          <div><dt>Verifikasi</dt><dd>{{ applyResult.verification ?? 'Hasil verifikasi tidak dikirim API.' }}</dd></div>
        </dl>
        <QualitySummaryCard v-if="applyResult.qualitySummary" :summary="applyResult.qualitySummary" />
        <div class="wb-dialog-actions">
          <button class="wb-button wb-primary" type="button" @click="viewResultTable">Lihat isi tabel hasil</button>
          <button class="wb-button" type="button" @click="openResultExportDialog">Ekspor tabel hasil</button>
        </div>
      </template>
      <template v-else>
        <form class="wb-save-form" @submit.prevent="applyPipeline">
          <p v-if="saveDialogMode === 'database'" class="wb-safety-note">
            Tabel sumber <code>{{ pipeline.source.database }}.{{ pipeline.source.table }}</code> tidak akan diubah.
          </p>
          <p v-else class="wb-safety-note">
            Hasil ETL <strong>{{ activeEtlMeta.label }}</strong> akan disimpan ke tabel baru tanpa mengubah tabel bawaan
            <code>{{ activeEtlMeta.targetTable }}</code>.
          </p>

          <label for="wb-result-database">Pilih Database</label>
          <select id="wb-result-database" v-model="resultDatabase" :disabled="applying || saveDialogMode === 'database'" required>
            <option v-if="!saveDatabaseOptions.length" value="" disabled>Tidak ada database tersedia</option>
            <option v-for="db in saveDatabaseOptions" :key="db" :value="db">{{ db }}</option>
          </select>
          <p v-if="resultDatabase && !validResultDatabase" class="wb-error" role="alert">
            Pilih nama database tujuan yang valid selain database sistem.
          </p>

          <label for="wb-result-name">Nama tabel hasil</label>
          <input id="wb-result-name" v-model="resultTableName" maxlength="64" required :disabled="applying" />
          <p v-if="resultTableName && !validResultName" class="wb-error" role="alert">
            Nama harus diawali huruf dan hanya berisi huruf, angka, atau garis bawah.
          </p>

          <label for="wb-result-engine">Engine</label>
          <select id="wb-result-engine" v-model="resultEngine" :disabled="applying">
            <option value="MergeTree">MergeTree</option>
            <option value="ReplacingMergeTree">ReplacingMergeTree</option>
          </select>

          <fieldset class="wb-order-fields" :disabled="applying">
            <legend>Kolom ORDER BY</legend>
            <p>Pilih satu kolom untuk mengurutkan tabel hasil.</p>
            <label v-for="column in activeSaveColumns" :key="column.name" class="wb-order-option">
              <input
                :checked="orderBy[0] === column.name"
                type="radio"
                name="wb-result-order-by"
                :disabled="isNullable(column.type)"
                @change="selectOrderBy(column.name)"
              />
              <span>{{ column.name }} <small>({{ column.type }})</small></span>
              <small v-if="isNullable(column.type)" class="wb-nullable-note">Kolom Nullable tidak dapat dipilih.</small>
            </label>
          </fieldset>

          <template v-if="saveDialogMode === 'database'">
            <label class="wb-save-original">
              <input v-model="saveOriginal" type="checkbox" :disabled="applying || originalColumnNames.length === 0" />
              <span>
                Simpan nilai sebelum perubahan
                <template v-if="originalColumnNames.length">
                  di <code>{{ originalColumnNames.map((column) => `${column}_asli`).join(', ') }}</code>
                </template>
                <template v-else> (tidak ada kolom sumber yang memenuhi syarat)</template>
              </span>
            </label>
            <p class="wb-message">Nilai yang disimpan berasal langsung dari tabel sumber, sebelum langkah pipeline dijalankan.</p>

            <div>
              <h3>Ringkasan langkah</h3>
              <ol class="wb-summary-steps">
                <li v-for="(step, index) in pipeline.steps" :key="step.id">
                  {{ index + 1 }}. {{ operationName(step.op) }} — {{ touchedColumns(step).join(', ') || 'Tanpa kolom langsung' }}
                </li>
              </ol>
            </div>
          </template>
          <div>
            <h3>Kolom hasil</h3>
            <ul class="wb-result-columns">
              <li v-for="column in activeSaveColumns" :key="column.name">{{ column.name }} <small>({{ column.type }})</small></li>
            </ul>
          </div>
          <p v-if="applyError" class="wb-error" role="alert">{{ applyError }}</p>
          <div v-if="applying" class="wb-save-progress" role="status" aria-live="polite">
            <div class="wb-save-progress-header">
              <span>{{ applyProgress?.message || 'Sedang membuat tabel baru. Mohon tunggu...' }}</span>
              <strong v-if="applyProgress && applyProgress.totalSteps > 0">
                {{ applyProgress.currentStep }} / {{ applyProgress.totalSteps }}
              </strong>
            </div>
            <div class="wb-save-progress-track" aria-hidden="true">
              <div class="wb-save-progress-fill" :style="{ width: `${applyProgressPercent}%` }" />
            </div>
          </div>
          <div class="wb-dialog-actions">
            <button class="wb-button wb-primary" type="submit" :disabled="!canApply || applying">
              {{ applying ? 'Sedang membuat...' : 'Ya, buat tabel' }}
            </button>
            <button class="wb-button" type="button" :disabled="applying" @click="closeSaveDialog">Batal</button>
          </div>
        </form>
      </template>
    </section>

    <section
      v-if="showExportDialog"
      class="kartu wb-dialog wb-export-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wb-export-title"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <div class="wb-dialog-heading">
        <h2 id="wb-export-title" class="card-title">Ekspor cleansing template pipeline</h2>
        <button class="wb-icon-button" type="button" @click="showExportDialog = false">Tutup</button>
      </div>
      <form class="wb-save-form" @submit.prevent="downloadCleansingTemplate">
        <p class="wb-message">
          File cleansing template JSON hanya berisi definisi langkah dan opsi simpan. Tidak ada data baris atau kredensial di dalamnya.
        </p>
        <label for="wb-template-name">Nama cleansing template</label>
        <input id="wb-template-name" v-model="exportTemplateName" maxlength="120" required placeholder="Contoh: Standarisasi Data Pelanggan" />
        <dl class="wb-summary">
          <div><dt>Versi format</dt><dd>1</dd></div>
          <div><dt>Saran sumber</dt><dd><code>{{ pipeline.source.database }}.{{ pipeline.source.table }}</code> (tidak mengikat)</dd></div>
          <div><dt>Jumlah langkah</dt><dd>{{ pipeline.steps.length }} langkah</dd></div>
          <div><dt>Opsi simpan</dt><dd>{{ resultEngine }}, ORDER BY {{ orderBy[0] || '(tidak dipilih)' }}, nilai asli: {{ saveOriginal ? 'Ya' : 'Tidak' }}</dd></div>
        </dl>
        <p v-if="exportError" class="wb-error" role="alert">{{ exportError }}</p>
        <div class="wb-dialog-actions">
          <button class="wb-button wb-primary" type="submit" :disabled="!exportTemplateName.trim()">
            Unduh file .json
          </button>
          <button class="wb-button" type="button" @click="showExportDialog = false">Batal</button>
        </div>
      </form>
    </section>

    <section
      v-if="showImportDialog"
      class="kartu wb-dialog wb-import-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wb-import-title"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <div class="wb-dialog-heading">
        <h2 id="wb-import-title" class="card-title">Impor cleansing template pipeline</h2>
        <button class="wb-icon-button" type="button" :disabled="importingTemplate" @click="showImportDialog = false">Tutup</button>
      </div>
      <div class="wb-save-form">
        <p class="wb-message">
          Pilih atau tarik file cleansing template <code>.json</code> (maksimal 1 MB). Setiap langkah akan divalidasi ulang terhadap skema tabel sumber yang sedang dipilih.
        </p>
        <div
          class="wb-dropzone"
          :class="{ 'wb-dropzone-active': importDragActive }"
          @dragover.prevent="importDragActive = true"
          @dragleave.prevent="importDragActive = false"
          @drop.prevent="handleTemplateDrop"
        >
          <p>{{ importingTemplate ? 'Memvalidasi cleansing template di server...' : 'Tarik dan lepas file .json ke sini' }}</p>
          <span>atau</span>
          <label class="wb-button wb-small wb-file-label">
            Pilih file JSON
            <input
              type="file"
              accept=".json,application/json"
              :disabled="importingTemplate"
              @change="handleTemplateFileChange"
            />
          </label>
        </div>
        <p v-if="!sourceReady" class="wb-warning" role="status">
          Belum ada tabel sumber yang dipilih. Langkah cleansing template tetap dapat dimuat, lalu akan divalidasi saat Anda memilih database dan tabel.
        </p>
        <p v-if="importError" class="wb-error" role="alert">{{ importError }}</p>
      </div>
    </section>

    <section
      v-if="showMappingDialog"
      class="kartu wb-dialog wb-mapping-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wb-mapping-title"
      tabindex="-1"
      @keydown="handleDialogKeydown"
    >
      <div class="wb-dialog-heading">
        <h2 id="wb-mapping-title" class="card-title">Pemetaan kolom</h2>
        <button class="wb-icon-button" type="button" @click="showMappingDialog = false">Tutup</button>
      </div>
      <form class="wb-save-form" @submit.prevent="applyColumnMapping">
        <p class="wb-message">
          Pilih kolom pengganti dari tabel <code>{{ pipeline.source.table }}</code> untuk kolom cleansing template yang tidak ditemukan.
        </p>
        <div v-for="item in missingColumnReferences" :key="item.column" class="wb-mapping-row">
          <div>
            <strong><code>{{ item.column }}</code></strong>
            <small>Dipakai di langkah {{ item.steps.join(', ') }}</small>
          </div>
          <select v-model="columnMappingDraft[item.column]" :aria-label="`Kolom pengganti untuk ${item.column}`">
            <option value="">Biarkan tidak diubah</option>
            <option v-for="col in sourceColumns" :key="col.name" :value="col.name">
              {{ col.name }} ({{ col.type }})
            </option>
          </select>
        </div>
        <div class="wb-dialog-actions">
          <button class="wb-button wb-primary" type="submit">Terapkan pemetaan</button>
          <button class="wb-button" type="button" @click="showMappingDialog = false">Batal</button>
        </div>
      </form>
    </section>

    <ExportDialog
      :open="showResultExportDialog"
      :database="applyResult?.database ?? ''"
      :table="applyResult?.table ?? ''"
      @close="showResultExportDialog = false"
    />
  </div>
</template>

<script setup lang="ts">
import type { QualitySummaryData } from '~/components/QualitySummaryCard.vue'
import type { WorkbenchPreviewResponse, WorkbenchStep } from '~/composables/useWorkbench'

type Database = { name: string }
type Table = { name: string; engine?: string }
type Column = { name: string; type: string }
type OperationParam = { key: string; label: string; description: string; type: string; required?: boolean; options?: string[] }
type Operation = { id: string; name: string; description: string; params: OperationParam[] }
type StepState = { status: 'valid' | 'error' | 'loading'; schema?: Column[]; message?: string; warnings?: string[] }
type PreviewRow = Record<string, unknown>
type PreviewResponse = WorkbenchPreviewResponse
type SchemaResponse = { valid: boolean; schema?: Column[]; error?: string; steps?: Array<{ index: number; valid: boolean; schema?: Column[]; error?: string; warnings?: string[] }> }
type SqlResponse = { sql: string; params: Record<string, unknown>; schema: Column[]; warnings?: string[] }
type ApplyResponse = {
  status: string
  database: string
  table: string
  rows: number
  steps: number
  durationMs?: number
  verification?: string
  qualitySummary?: QualitySummaryData
}
type SaveTableStartResponse = {
  jobId: string
  status: 'running' | 'done' | 'error'
  currentStep: number
  totalSteps: number
  message: string
}
type SaveTableStatusResponse = {
  jobId: string
  status: 'running' | 'done' | 'error'
  currentStep: number
  totalSteps: number
  message: string
  result?: ApplyResponse
  error?: string
}
type RareValueItem = {
  nilai: string
  jumlah: number
  jenis: 'null' | 'empty' | 'text'
  nilaiAsli: string | null
}
type RareValuesResponse = {
  aborted?: boolean
  column: string
  upTo: number
  threshold: number
  limit: number
  computedFromFullData?: boolean
  maxExecutionTimeSec?: number
  items: RareValueItem[]
  summary: {
    uniqueValues: number
    rareValues: number
    affectedRows: number
  }
}
type DisplayFilter = {
  column: string
  kind: 'null' | 'empty' | 'text' | 'contains'
  value?: string | null
  label: string
}
type ImportTemplateResponse = {
  recipe: {
    version: number
    name: string
    createdAt: string
    suggestedSource: { database: string; table: string } | null
    saveOptions: { engine: 'MergeTree' | 'ReplacingMergeTree'; orderBy: string[]; saveOriginal: boolean }
  }
  steps: WorkbenchStep[]
  stepStatuses: Array<{ index: number; valid: boolean; error?: string; warnings?: string[] }>
  summary: { total: number; valid: number; invalid: number }
}

const workbench = useWorkbench()
const { pipeline, selectedStep, page, limit, persistenceError } = workbench
const selectedSource = useSelectedSource()
const databases = ref<Database[]>([])
const tables = ref<Table[]>([])
const tablesByDatabase = reactive<Record<string, Table[]>>({})
const operations = ref<Operation[]>([])
const sourceColumns = ref<Column[]>([])
const stepStates = ref<StepState[]>([])
const databasesPending = ref(false)
const tablesPending = ref(false)
const operationsPending = ref(false)
const databasesError = ref('')
const tablesError = ref('')
const operationsError = ref('')
const masterColumnsError = ref('')
const previewPending = ref(false)
const previewError = ref('')
const previewRows = ref<PreviewRow[]>([])
const previewWarnings = ref<string[]>([])
const previewIsSampled = ref(false)
const previewSampleLimit = ref(5000)
const totalRows = ref(0)
const sqlPending = ref(false)
const sqlError = ref('')
const sqlResult = ref<SqlResponse | null>(null)
const sqlCopied = ref(false)
const parametersCopied = ref(false)
const copyError = ref('')
const selectedOperationId = ref('')
const formInitialParams = ref<Record<string, unknown>>({})
const editingStepIndex = ref<number | null>(null)
const insertAtIndex = ref<number | null>(null)
const prefilledColumn = ref('')
const formKey = ref(0)
const activeColumnMenu = ref('')
const showSqlPanel = ref(false)
const showSaveDialog = ref(false)
const saveDialogMode = ref<'database' | 'etl'>('database')
const resultDatabase = ref('')
const resultTableName = ref('')
const resultEngine = ref<'MergeTree' | 'ReplacingMergeTree'>('MergeTree')
const orderBy = ref<string[]>([])
const saveOriginal = ref(false)
const applying = ref(false)
const applyError = ref('')
const applyResult = ref<ApplyResponse | null>(null)
const applyProgress = ref<{ currentStep: number; totalSteps: number; message: string } | null>(null)
const showResultExportDialog = ref(false)
const masterColumns = ref<Column[]>([])

const rareColumn = ref('')
const rareThreshold = ref(10)
const rareLimit = ref(100)
const rareSearch = ref('')
const rareExcludeNull = ref(false)
const rareExcludeEmpty = ref(false)
const rarePending = ref(false)
const rareError = ref('')
const rareResult = ref<RareValuesResponse | null>(null)
const selectedRareKeys = ref<string[]>([])
const displayFilter = ref<DisplayFilter | null>(null)

const showExportDialog = ref(false)
const exportTemplateName = ref('')
const exportError = ref('')
const showImportDialog = ref(false)
const importDragActive = ref(false)
const importingTemplate = ref(false)
const importError = ref('')
const importSummary = ref<{ name: string; valid: number; invalid: number; suggestedSourceNote: string } | null>(null)
const showMappingDialog = ref(false)
const columnMappingDraft = reactive<Record<string, string>>({})
const sampleInfoRef = ref<HTMLElement | null>(null)
const sampleTooltipPinned = ref(false)
const sampleTooltipHover = ref(false)

type SourceMode = 'database' | 'etl'
type EtlPipelineId = 'media_humas' | 'peserta_vpl' | 'anggaran_sp2d' | 'course_es'
type EtlResponse = {
  status: 'ok' | 'error'
  pipeline: EtlPipelineId
  action: 'preview' | 'sync_db'
  targetTable: string
  columns: string[]
  column_schema?: Column[]
  rows: PreviewRow[]
  total_rows: number
  csv_filename: string | null
  download_token: string | null
  summary: Record<string, unknown>
  durationMs?: number
  message: string
}

const etlPipelineOptions: Array<{ id: EtlPipelineId; label: string; targetTable: string }> = [
  { id: 'media_humas', label: 'Publikasi Media Humas', targetTable: 'dataset.publikasi_media' },
  { id: 'peserta_vpl', label: 'Peserta VPL', targetTable: 'db_vpl.vpl_series_atax' },
  { id: 'anggaran_sp2d', label: 'Realisasi Anggaran SP2D', targetTable: 'dataset.anggaran' },
  { id: 'course_es', label: 'Course Elasticsearch', targetTable: 'dataset.course_sibangkom' },
]

const todayIso = new Date().toISOString().slice(0, 10)
const sourceMode = ref<SourceMode>('database')
const etlPipeline = ref<EtlPipelineId>('media_humas')
const etlCourseEsSourceMode = ref<'api' | 'file'>('api')
const etlRawText = ref('')
const etlFile = ref<File | null>(null)
const etlFile2025 = ref<File | null>(null)
const etlFile2026 = ref<File | null>(null)
const etlDragActive = ref(false)
const etlDragActive2025 = ref(false)
const etlDragActive2026 = ref(false)
const etlStartDate = ref(todayIso)
const etlEndDate = ref(todayIso)
const etlFileStartDate = ref('')
const etlFileEndDate = ref('')
const etlTanggalRealisasi = ref(todayIso)
const etlProcessing = ref(false)
const etlSyncing = ref(false)
const etlError = ref('')
const etlSyncMessage = ref('')
const etlResult = ref<EtlResponse | null>(null)
const etlPage = ref(1)
const etlLimit = ref(25)

const activeEtlMeta = computed(() => (
  etlPipelineOptions.find((item) => item.id === etlPipeline.value) ?? etlPipelineOptions[0]!
))

const canRunEtl = computed(() => {
  if (etlPipeline.value === 'media_humas') {
    return Boolean(etlRawText.value.trim() || etlFile.value)
  }
  if (etlPipeline.value === 'peserta_vpl') {
    return Boolean(etlFile2025.value || etlFile2026.value)
  }
  if (etlPipeline.value === 'anggaran_sp2d') {
    return Boolean(etlFile.value)
  }
  if (etlPipeline.value === 'course_es') {
    if (etlCourseEsSourceMode.value === 'file') {
      if (!etlFile.value) return false
      if (etlFileStartDate.value && etlFileEndDate.value && etlFileStartDate.value > etlFileEndDate.value) return false
      return true
    }
    return Boolean(etlStartDate.value && etlEndDate.value && etlStartDate.value <= etlEndDate.value)
  }
  return false
})

const etlPreviewBadgeText = computed(() => {
  const result = etlResult.value
  if (!result) return ''
  if (result.pipeline === 'peserta_vpl') {
    const tahunCounts = result.summary?.tahun_counts
    if (tahunCounts && typeof tahunCounts === 'object') {
      const entries = Object.entries(tahunCounts as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([yr, cnt]) => `${yr}: ${numberFormat(Number(cnt) || 0)} baris`)
      if (entries.length > 0) {
        entries.push(`Total: ${numberFormat(result.total_rows)} baris`)
        return entries.join(' · ')
      }
    }
  }
  return `${numberFormat(result.total_rows)} baris`
})

const etlTotalPages = computed(() => {
  const total = etlResult.value?.total_rows ?? 0
  return Math.max(1, Math.ceil(total / etlLimit.value))
})

const etlPagedRows = computed(() => {
  const rows = etlResult.value?.rows ?? []
  const start = (etlPage.value - 1) * etlLimit.value
  return rows.slice(start, start + etlLimit.value)
})

const etlSummaryChips = computed(() => {
  const result = etlResult.value
  if (!result) return []
  const s = result.summary || {}
  const chips: Array<{ label: string; value: string }> = [
    { label: 'Tabel Target', value: result.targetTable },
  ]
  if (typeof s.periode === 'string' && s.periode) {
    chips.push({ label: 'Periode', value: s.periode })
  }
  if (s.by_jenis_berita && typeof s.by_jenis_berita === 'object') {
    const parts = Object.entries(s.by_jenis_berita as Record<string, number>)
      .map(([k, v]) => `${k}: ${numberFormat(v)}`)
    if (parts.length) chips.push({ label: 'Jenis Berita', value: parts.join(' · ') })
  }
  if (s.by_disagregasi && typeof s.by_disagregasi === 'object') {
    const parts = Object.entries(s.by_disagregasi as Record<string, number>)
      .map(([k, v]) => `${k}: ${numberFormat(v)}`)
    if (parts.length) chips.push({ label: 'Disagregasi', value: parts.join(' · ') })
  }
  if (typeof s.total_pagu_anggaran === 'number' && s.total_pagu_anggaran > 0) {
    chips.push({ label: 'Total Pagu', value: `Rp ${numberFormat(s.total_pagu_anggaran)}` })
  }
  if (typeof s.total_sp2d_span === 'number' && s.total_sp2d_span > 0) {
    chips.push({ label: 'Total SP2D', value: `Rp ${numberFormat(s.total_sp2d_span)}` })
  }
  if (typeof s.total_es_docs === 'number') {
    chips.push({ label: 'Dokumen ES', value: numberFormat(s.total_es_docs) })
  }
  if (typeof s.total_pppk === 'number') {
    chips.push({ label: 'Filter PPPK', value: numberFormat(s.total_pppk) })
  }
  if (typeof s.master_instansi_count === 'number' || typeof s.master_jf_count === 'number') {
    chips.push({
      label: 'Referensi BKN',
      value: `${numberFormat(Number(s.master_instansi_count || 0))} instansi · ${numberFormat(Number(s.master_jf_count || 0))} JF`,
    })
  }
  if (typeof s.overrides_instansi_hit === 'number' || typeof s.overrides_jabatan_hit === 'number') {
    chips.push({
      label: 'Koreksi Manual',
      value: `${numberFormat(Number(s.overrides_instansi_hit || 0))} instansi · ${numberFormat(Number(s.overrides_jabatan_hit || 0))} jabatan`,
    })
  }
  return chips
})

let schemaController: AbortController | null = null
let rareController: AbortController | null = null
let previewRequest = 0
let schemaRequest = 0
let rareRequest = 0
let masterColumnsRequest = 0
let savePollTimer: ReturnType<typeof setTimeout> | null = null
let activeSavePollRun = 0
let returnFocusElement: HTMLElement | null = null

const sourceReady = computed(() => Boolean(pipeline.value.source.database && pipeline.value.source.table))
const selectedOperation = computed(() => operations.value.find(({ id }) => id === selectedOperationId.value) ?? null)
const visibleColumns = computed(() => {
  const schema = selectedStep.value === 0
    ? sourceColumns.value
    : stepStates.value[selectedStep.value - 1]?.schema ?? []
  return schema.filter(({ name }) => !name.startsWith('__sebelum_'))
})
const finalSchema = computed(() => pipeline.value.steps.length
  ? stepStates.value[pipeline.value.steps.length - 1]?.schema ?? []
  : sourceColumns.value)
const schemaBeforeSelectedStep = computed(() => selectedStep.value > 0
  ? editingStepIndex.value !== null
    ? stepStates.value[editingStepIndex.value - 1]?.schema ?? sourceColumns.value
    : insertAtIndex.value !== null
      ? insertAtIndex.value > 0
        ? stepStates.value[insertAtIndex.value - 1]?.schema ?? sourceColumns.value
        : sourceColumns.value
      : finalSchema.value
  : editingStepIndex.value !== null
    ? sourceColumns.value
    : insertAtIndex.value !== null
      ? insertAtIndex.value > 0
        ? stepStates.value[insertAtIndex.value - 1]?.schema ?? sourceColumns.value
        : sourceColumns.value
      : finalSchema.value)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / limit.value)))
const validResultName = computed(() => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(resultTableName.value))
const validResultDatabase = computed(() => (
  /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(resultDatabase.value)
  && !['system', 'information_schema', 'bersihdata'].includes(resultDatabase.value.toLowerCase())
))
const activeSaveColumns = computed<Column[]>(() => {
  if (saveDialogMode.value === 'etl') {
    if (etlResult.value?.column_schema?.length) return etlResult.value.column_schema
    return (etlResult.value?.columns ?? []).map((name) => ({ name, type: 'String' }))
  }
  return finalSchema.value
})
const saveDatabaseOptions = computed<string[]>(() => {
  const names = new Set<string>()
  for (const db of databases.value) {
    if (!['system', 'information_schema', 'bersihdata'].includes(db.name.toLowerCase())) {
      names.add(db.name)
    }
  }
  if (saveDialogMode.value === 'etl') {
    const [defaultDb] = activeEtlMeta.value.targetTable.split('.')
    if (defaultDb) names.add(defaultDb)
  } else if (pipeline.value.source.database) {
    names.add(pipeline.value.source.database)
  }
  return [...names]
})
const originalColumnNames = computed(() => [...new Set(
  pipeline.value.steps
    .filter((step) => step.op !== 'add_column' && step.op !== 'manage_columns')
    .flatMap((step) => touchedColumns(step)),
)].filter((name) => sourceColumns.value.some((column) => column.name === name)))
const canApply = computed(() => {
  if (applying.value || !validResultName.value || !validResultDatabase.value) return false
  if (saveDialogMode.value === 'etl') {
    return Boolean(etlResult.value && etlResult.value.total_rows > 0 && canRunEtl.value)
  }
  return sourceReady.value
    && pipeline.value.steps.length > 0
    && stepStates.value.length === pipeline.value.steps.length
    && stepStates.value.every(({ status }) => status === 'valid')
})
const canOpenSave = computed(() => sourceReady.value
  && pipeline.value.steps.length > 0
  && stepStates.value.length === pipeline.value.steps.length
  && stepStates.value.every(({ status }) => status === 'valid'))
const applyProgressPercent = computed(() => {
  const progress = applyProgress.value
  if (!progress || progress.totalSteps <= 0) return 8
  if (progress.currentStep <= 0) return 5
  return Math.min(100, Math.max(5, Math.round((progress.currentStep / progress.totalSteps) * 100)))
})

const sampleTooltipVisible = computed(() => Boolean(previewIsSampled.value && sourceReady.value && (sampleTooltipPinned.value || sampleTooltipHover.value)))
const previewActiveSteps = computed(() => pipeline.value.steps.slice(0, selectedStep.value))
const previewSequenceColumns = computed(() => new Set(
  previewActiveSteps.value
    .filter((step) => step.op === 'add_column' && step.params?.kind === 'sequence' && typeof step.params.name === 'string' && step.params.name.trim())
    .map((step) => String(step.params.name).trim()),
))

function toggleSampleTooltip(): void {
  sampleTooltipPinned.value = !sampleTooltipPinned.value
}

function closeSampleTooltip(): void {
  sampleTooltipPinned.value = false
  sampleTooltipHover.value = false
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!sampleTooltipPinned.value) return
  const target = event.target as Node | null
  if (sampleInfoRef.value && target && !sampleInfoRef.value.contains(target)) {
    sampleTooltipPinned.value = false
  }
}
const rareTextColumns = computed(() => visibleColumns.value.filter(isTextColumn))
const selectedRareItems = computed(() => {
  if (!rareResult.value) return []
  const keySet = new Set(selectedRareKeys.value)
  return rareResult.value.items.filter((item) => keySet.has(rareItemKey(item)))
})
const missingColumnReferences = computed(() => {
  if (!sourceColumns.value.length || !pipeline.value.steps.length) return []
  const known = new Set(sourceColumns.value.map((c) => c.name))
  const missingMap = new Map<string, number[]>()

  const checkCol = (colName: unknown, stepNumber: number) => {
    if (typeof colName !== 'string' || !colName.trim()) return
    if (!known.has(colName)) {
      const list = missingMap.get(colName) ?? []
      if (!list.includes(stepNumber)) list.push(stepNumber)
      missingMap.set(colName, list)
    }
  }

  pipeline.value.steps.forEach((step, idx) => {
    const stepNumber = idx + 1
    const p = step.params ?? {}
    if (step.op === 'trim_text' || step.op === 'replace_values') {
      checkCol(p.column, stepNumber)
    } else if (step.op === 'add_column') {
      if (p.kind === 'sequence') checkCol(p.orderColumn, stepNumber)
      if (p.kind === 'combine' && Array.isArray(p.columns)) {
        p.columns.forEach((col) => checkCol(col, stepNumber))
      }
      if (typeof p.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(p.name.trim())) {
        known.add(p.name.trim())
      }
    } else if (step.op === 'manage_columns') {
      if (p.mode === 'drop' && Array.isArray(p.columns)) {
        p.columns.forEach((col) => {
          checkCol(col, stepNumber)
          if (typeof col === 'string') known.delete(col.trim())
        })
      } else if (p.mode === 'rename') {
        checkCol(p.sourceColumn, stepNumber)
        if (typeof p.sourceColumn === 'string') known.delete(p.sourceColumn.trim())
        if (typeof p.newName === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(p.newName.trim())) {
          known.add(p.newName.trim())
        }
      }
    } else if (step.op === 'deduplicate') {
      if (Array.isArray(p.keyColumns)) p.keyColumns.forEach((col) => checkCol(col, stepNumber))
      checkCol(p.orderColumn, stepNumber)
      if (Array.isArray(p.completenessColumns)) p.completenessColumns.forEach((col) => checkCol(col, stepNumber))
    } else if (step.op === 'conditional_rule' && Array.isArray(p.rules)) {
      p.rules.forEach((rule: any) => {
        if (!rule || typeof rule !== 'object') return
        if (Array.isArray(rule.conditions)) {
          rule.conditions.forEach((cond: any) => {
            if (cond && typeof cond === 'object') checkCol(cond.column, stepNumber)
          })
        }
        checkCol(rule.targetColumn, stepNumber)
        if (rule.action === 'copy_column') checkCol(rule.sourceColumn, stepNumber)
      })
    } else if (step.op === 'extract_and_route') {
      checkCol(p.sourceColumn, stepNumber)
      if (p.createTarget === true) {
        if (typeof p.newTargetName === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(p.newTargetName.trim())) {
          known.add(p.newTargetName.trim())
        }
      } else {
        checkCol(p.targetColumn, stepNumber)
      }
    } else if (step.op === 'fill_from_master') {
      checkCol(p.sourceColumn, stepNumber)
      checkCol(p.targetColumn, stepNumber)
    } else if (step.op === 'fuzzy_match_master') {
      checkCol(p.sourceColumn, stepNumber)
      if (p.routeUnmatched === true) checkCol(p.unmatchedColumn, stepNumber)
      if (p.createTarget === true) {
        if (typeof p.newTargetName === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(p.newTargetName.trim())) {
          known.add(p.newTargetName.trim())
        }
      } else if (typeof p.targetColumn === 'string' && p.targetColumn.trim()) {
        checkCol(p.targetColumn, stepNumber)
      }
    }
  })

  return [...missingMap.entries()].map(([column, steps]) => ({ column, steps }))
})

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object'
      && 'message' in error.data && typeof error.data.message === 'string') return error.data.message
    if ('message' in error && typeof error.message === 'string') return error.message
  }
  return fallback
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as { name?: unknown; code?: unknown; statusCode?: unknown; status?: unknown; message?: unknown; cause?: unknown }
  if (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.statusCode === 499 || err.status === 499) return true
  if (typeof err.message === 'string' && /\b(AbortError|aborted)\b/i.test(err.message)) return true
  if (err.cause && err.cause !== error) return isAbortLikeError(err.cause)
  return false
}

function numberFormat(value: number): string {
  return new Intl.NumberFormat('id-ID').format(Number(value) || 0)
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? '{}'
}

function displayValue(value: unknown): string {
  if (value === null) return 'NULL'
  if (value === '') return '(string kosong)'
  if (typeof value === 'string' && /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    return JSON.stringify(value)
  }
  if (typeof value === 'object') return JSON.stringify(value) ?? String(value)
  return String(value)
}

function isChanged(row: PreviewRow, column: string): boolean {
  const previousKey = `__sebelum_${column}`
  if (!(previousKey in row)) return false
  return JSON.stringify(row[column]) !== JSON.stringify(row[previousKey])
}

function cellTitle(row: PreviewRow, column: string): string {
  const current = displayValue(row[column])
  if (isChanged(row, column)) return `Nilai sebelumnya: ${displayValue(row[`__sebelum_${column}`])} · Nilai sekarang: ${current}`
  return current
}

function operationName(id: string): string {
  return operations.value.find((operation) => operation.id === id)?.name ?? id
}

function touchedColumns(step: WorkbenchStep): string[] {
  if (step.op === 'add_column') {
    return typeof step.params.name === 'string' && step.params.name ? [step.params.name] : []
  }
  if (step.op === 'manage_columns') {
    if (step.params.mode === 'drop') {
      const cols = Array.isArray(step.params.columns)
        ? step.params.columns.filter((c): c is string => typeof c === 'string' && Boolean(c))
        : []
      return cols.length ? [`Hapus: ${cols.join(', ')}`] : []
    }
    if (step.params.mode === 'rename') {
      const src = typeof step.params.sourceColumn === 'string' ? step.params.sourceColumn : ''
      const dst = typeof step.params.newName === 'string' ? step.params.newName : ''
      if (src && dst) return [`${src} -> ${dst}`]
      return src ? [src] : []
    }
    return []
  }
  if (step.op === 'fill_from_master') {
    return typeof step.params.targetColumn === 'string' && step.params.targetColumn
      ? [step.params.targetColumn]
      : []
  }
  if (step.op === 'fuzzy_match_master') {
    const cols: string[] = []
    if (step.params.createTarget === true) {
      if (typeof step.params.newTargetName === 'string' && step.params.newTargetName) cols.push(step.params.newTargetName)
    } else if (typeof step.params.targetColumn === 'string' && step.params.targetColumn) {
      cols.push(step.params.targetColumn)
    } else if (typeof step.params.sourceColumn === 'string' && step.params.sourceColumn) {
      cols.push(step.params.sourceColumn)
    }
    if (step.params.routeUnmatched === true && typeof step.params.unmatchedColumn === 'string' && step.params.unmatchedColumn) {
      cols.push(step.params.unmatchedColumn)
    }
    return [...new Set(cols)]
  }
  const values = Object.entries(step.params)
    .filter(([key, value]) => /column/i.test(key) && typeof value === 'string' && value)
    .map(([, value]) => String(value))
  return [...new Set(values)]
}

function stepStatusLabel(status?: StepState['status']): string {
  if (status === 'valid') return 'Valid'
  if (status === 'error') return 'Kesalahan'
  return 'Sedang dihitung'
}

function isNullable(type: string): boolean {
  return /Nullable\s*\(/.test(type)
}

async function loadDatabases(): Promise<void> {
  databasesPending.value = true
  databasesError.value = ''
  try {
    const response = await $fetch<{ data: Database[] }>('/api/databases')
    databases.value = response.data
  } catch (error) {
    databasesError.value = getErrorMessage(error, 'Daftar database tidak dapat dimuat.')
  } finally {
    databasesPending.value = false
  }
}

async function loadTables(database: string): Promise<void> {
  if (!database) return
  const isSourceDatabase = database === pipeline.value.source.database
  if (isSourceDatabase) {
    tablesPending.value = true
    tablesError.value = ''
    tables.value = []
  }
  try {
    const response = await $fetch<{ data: Table[] }>('/api/tables', { query: { database } })
    tablesByDatabase[database] = response.data
    if (pipeline.value.source.database === database) tables.value = response.data
  } catch (error) {
    if (isSourceDatabase) tablesError.value = getErrorMessage(error, 'Daftar tabel tidak dapat dimuat.')
  } finally {
    if (isSourceDatabase) tablesPending.value = false
  }
}

async function loadSourceColumns(database: string, table: string): Promise<void> {
  sourceColumns.value = []
  if (!database || !table) return
  try {
    const response = await $fetch<{ data: Column[] }>('/api/columns', { query: { database, table } })
    if (pipeline.value.source.database === database && pipeline.value.source.table === table) {
      sourceColumns.value = response.data
    }
  } catch (error) {
    previewError.value = getErrorMessage(error, 'Skema tabel sumber tidak dapat dimuat.')
  }
}

async function loadMasterColumns(database: string, table: string): Promise<void> {
  const request = ++masterColumnsRequest
  masterColumns.value = []
  masterColumnsError.value = ''
  if (!database || !table) return
  try {
    const response = await $fetch<{ data: Column[] }>('/api/columns', { query: { database, table } })
    if (request === masterColumnsRequest) masterColumns.value = response.data
  } catch (error) {
    if (request === masterColumnsRequest) {
      masterColumnsError.value = getErrorMessage(error, 'Kolom tabel master tidak dapat dimuat.')
    }
  }
}

async function loadOperations(): Promise<void> {
  operationsPending.value = true
  operationsError.value = ''
  try {
    const response = await $fetch<{ data: Operation[] }>('/api/workbench/ops')
    operations.value = response.data
  } catch (error) {
    operationsError.value = getErrorMessage(error, 'Daftar operasi tidak dapat dimuat.')
  } finally {
    operationsPending.value = false
  }
}

function abortRareValues(): void {
  if (rareController) {
    rareController.abort()
    rareController = null
  }
  rarePending.value = false
}

function changeDatabase(event: Event): void {
  const database = (event.target as HTMLSelectElement).value
  abortRareValues()
  workbench.setSource(database, '')
  tables.value = []
  sourceColumns.value = []
  displayFilter.value = null
  rareResult.value = null
  rareError.value = ''
  selectedRareKeys.value = []
  importSummary.value = null
  if (database) void loadTables(database)
}

function changeTable(event: Event): void {
  const table = (event.target as HTMLSelectElement).value
  abortRareValues()
  workbench.setSource(pipeline.value.source.database, table)
  displayFilter.value = null
  rareResult.value = null
  rareError.value = ''
  selectedRareKeys.value = []
  importSummary.value = null
  void loadSourceColumns(pipeline.value.source.database, table)
}

function selectStep(index: number): void {
  selectedStep.value = index
  page.value = 1
  activeColumnMenu.value = ''
  resetOperationForm()
}

function showOperations(): void {
  selectedOperationId.value = ''
  editingStepIndex.value = null
  insertAtIndex.value = pipeline.value.steps.length
  selectedStep.value = pipeline.value.steps.length
  formInitialParams.value = {}
}

function resetOperationForm(): void {
  selectedOperationId.value = ''
  formInitialParams.value = {}
  editingStepIndex.value = null
  insertAtIndex.value = null
  prefilledColumn.value = ''
  formKey.value += 1
}

function chooseOperation(operation: Operation, column = ''): void {
  selectedOperationId.value = operation.id
  editingStepIndex.value = null
  insertAtIndex.value = selectedStep.value
  formInitialParams.value = {}
  prefilledColumn.value = column
  formKey.value += 1
  activeColumnMenu.value = ''
}

function editStep(index: number): void {
  const step = pipeline.value.steps[index]
  if (!step) return
  const operation = operations.value.find(({ id }) => id === step.op)
  if (!operation) return
  selectedStep.value = index + 1
  selectedOperationId.value = operation.id
  editingStepIndex.value = index
  insertAtIndex.value = null
  formInitialParams.value = JSON.parse(JSON.stringify(step.params))
  const masterDatabase = String(step.params.masterDatabase ?? '')
  const masterTable = String(step.params.masterTable ?? '')
  if (masterDatabase) void loadTables(masterDatabase)
  if (masterDatabase && masterTable) void loadMasterColumns(masterDatabase, masterTable)
  prefilledColumn.value = ''
  formKey.value += 1
}

function commitForm(params: Record<string, unknown>): void {
  if (!selectedOperation.value) return

  const editingStep = editingStepIndex.value === null
    ? null
    : pipeline.value.steps[editingStepIndex.value]

  if (editingStepIndex.value !== null && editingStep == null) {
    resetOperationForm()
    return
  }

  const changed: WorkbenchStep = {
    id: editingStep != null
      ? editingStep.id
      : `step-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    op: selectedOperation.value.id,
    params,
  }

  if (editingStepIndex.value === null) {
    const insertionIndex = Math.max(0, Math.min(insertAtIndex.value ?? pipeline.value.steps.length, pipeline.value.steps.length))
    pipeline.value.steps.splice(insertionIndex, 0, changed)
    selectedStep.value = insertionIndex + 1
  } else {
    pipeline.value.steps.splice(editingStepIndex.value, 1, changed)
    selectedStep.value = editingStepIndex.value + 1
  }
  page.value = 1
  resetOperationForm()
  workbench.savePipeline()
}

function moveStep(index: number, offset: number): void {
  const target = index + offset
  if (index < 0 || index >= pipeline.value.steps.length
    || target < 0 || target >= pipeline.value.steps.length) return
  const selectedId = selectedStep.value > 0 ? pipeline.value.steps[selectedStep.value - 1]?.id : ''
  const step = pipeline.value.steps[index]
  if (!step) return
  pipeline.value.steps.splice(index, 1)
  pipeline.value.steps.splice(target, 0, step)
  const selectedIndex = pipeline.value.steps.findIndex(({ id }) => id === selectedId)
  if (selectedIndex >= 0) selectedStep.value = selectedIndex + 1
  page.value = 1
  workbench.savePipeline()
}

function deleteStep(index: number): void {
  pipeline.value.steps.splice(index, 1)
  if (selectedStep.value > pipeline.value.steps.length) selectedStep.value = pipeline.value.steps.length
  else if (selectedStep.value === index + 1) selectedStep.value = Math.max(0, index)
  page.value = 1
  resetOperationForm()
  workbench.savePipeline()
}

function changePage(nextPage: number): void {
  if (nextPage < 1 || nextPage > totalPages.value || previewPending.value) return
  page.value = nextPage
}

function changeLimit(event: Event): void {
  const nextLimit = Number((event.target as HTMLSelectElement).value)
  if (![25, 50, 100].includes(nextLimit)) return
  limit.value = nextLimit
  page.value = 1
}

async function refreshStepSchemas(): Promise<void> {
  const request = ++schemaRequest
  schemaController?.abort()
  schemaController = null
  const source = pipeline.value.source
  const steps = pipeline.value.steps
  if (!source.database || !source.table) {
    stepStates.value = []
    return
  }
  const controller = new AbortController()
  schemaController = controller
  const statuses: StepState[] = []
  const validPrefix: WorkbenchStep[] = []
  for (let index = 0; index < steps.length; index += 1) {
    if (request !== schemaRequest || controller.signal.aborted) return
    stepStates.value = [...statuses, ...steps.slice(index).map(() => ({ status: 'loading' as const }))]
    const step = steps[index]
    if (!step) {
      statuses.push({ status: 'error', message: `Langkah ${index + 1} tidak valid.` })
      continue
    }
    try {
      const response = await $fetch<SchemaResponse>('/api/workbench/schema', {
        method: 'POST',
        body: { source, steps: [...validPrefix, step] },
        signal: controller.signal,
      })
      if (request !== schemaRequest || controller.signal.aborted) return
      if (!response.valid) {
        const rawMessage = response.error || 'Skema langkah tidak valid.'
        const prefix = `Langkah ${validPrefix.length + 1}: `
        const cleaned = rawMessage.startsWith(prefix) ? rawMessage.slice(prefix.length) : rawMessage
        statuses.push({ status: 'error', message: `Langkah ${index + 1}: ${cleaned}` })
        continue
      }
      validPrefix.push(step)
      const stepWarnings = response.steps?.[validPrefix.length - 1]?.warnings ?? []
      statuses.push({
        status: 'valid',
        schema: response.schema ?? [],
        warnings: stepWarnings.map((warning) => `Langkah ${index + 1}: ${warning}`),
      })
    } catch (error) {
      if (request !== schemaRequest || controller.signal.aborted || isAbortLikeError(error)) return
      const message = getErrorMessage(error, 'Skema langkah tidak dapat diperiksa.')
      statuses.push({ status: 'error', message })
    }
  }
  if (request === schemaRequest) {
    if (schemaController === controller) schemaController = null
    stepStates.value = statuses
    if (importSummary.value) {
      importSummary.value = {
        ...importSummary.value,
        valid: statuses.filter((s) => s.status === 'valid').length,
        invalid: statuses.filter((s) => s.status === 'error').length,
      }
    }
  }
}

async function loadPreview(): Promise<void> {
  const request = ++previewRequest
  workbench.abortPreview()
  if (!sourceReady.value) {
    previewRows.value = []
    previewWarnings.value = []
    previewIsSampled.value = false
    totalRows.value = 0
    previewError.value = ''
    previewPending.value = false
    return
  }
  previewPending.value = true
  previewError.value = ''
  previewRows.value = []
  previewWarnings.value = []
  const steps = pipeline.value.steps.slice(0, selectedStep.value)
  const activeFilter = displayFilter.value && visibleColumns.value.some((c) => c.name === displayFilter.value?.column)
    ? {
        column: displayFilter.value.column,
        kind: displayFilter.value.kind,
        ...(displayFilter.value.kind === 'text' || displayFilter.value.kind === 'contains'
          ? { value: displayFilter.value.value ?? '' }
          : {}),
      }
    : undefined
  try {
    const result = await workbench.fetchPreview({
      source: pipeline.value.source,
      steps,
      page: page.value,
      limit: limit.value,
      ...(activeFilter ? { displayFilter: activeFilter } : {}),
    })
    if (result.aborted || !result.data || request !== previewRequest) return
    const response: PreviewResponse = result.data
    previewRows.value = response.rows
    previewWarnings.value = response.warnings ?? []
    previewIsSampled.value = Boolean(response.isSampled)
    previewSampleLimit.value = Number(response.sampleLimit ?? 5000) || 5000
    totalRows.value = Number(response.totalRows)
    page.value = response.page
  } catch (error) {
    if (request !== previewRequest || isAbortLikeError(error)) return
    previewIsSampled.value = false
    previewError.value = getErrorMessage(error, 'Pratinjau tidak dapat dimuat.')
  } finally {
    if (request === previewRequest) previewPending.value = false
  }
}

async function openSql(): Promise<void> {
  showSqlPanel.value = true
  sqlResult.value = null
  sqlError.value = ''
  sqlPending.value = true
  try {
    sqlResult.value = await $fetch<SqlResponse>('/api/workbench/sql', {
      method: 'POST',
      body: { source: pipeline.value.source, steps: pipeline.value.steps.slice(0, selectedStep.value) },
    })
  } catch (error) {
    sqlError.value = getErrorMessage(error, 'SQL tidak dapat dimuat.')
  } finally {
    sqlPending.value = false
  }
}

async function copySql(): Promise<void> {
  if (!sqlResult.value) return
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(sqlResult.value.sql)
    sqlCopied.value = true
    window.setTimeout(() => { sqlCopied.value = false }, 1800)
  } catch (error) {
    copyError.value = getErrorMessage(error, 'SQL tidak dapat disalin dari peramban ini.')
  }
}

async function copyParameters(): Promise<void> {
  if (!sqlResult.value) return
  copyError.value = ''
  try {
    await navigator.clipboard.writeText(formatJson(sqlResult.value.params))
    parametersCopied.value = true
    window.setTimeout(() => { parametersCopied.value = false }, 1800)
  } catch (error) {
    copyError.value = getErrorMessage(error, 'Parameter tidak dapat disalin dari peramban ini.')
  }
}

function operationMatchesColumn(operation: Operation, column: Column): boolean {
  const columnParams = operation.params.filter(({ type }) => type === 'column')
  if (!columnParams.length) return false
  return columnParams.some((parameter) => {
    const textOnly = `${parameter.label} ${parameter.description}`.toLowerCase().includes('teks')
      || operation.id === 'trim_text'
      || operation.id === 'replace_values'
      || ((operation.id === 'fill_from_master' || operation.id === 'fuzzy_match_master') && /Column$/.test(parameter.key) && parameter.key !== 'masterColumn')
    return !textOnly || isTextColumn(column)
  })
}

function columnOperations(column: Column): Operation[] {
  return operations.value.filter((operation) => operationMatchesColumn(operation, column))
}

function toggleColumnMenu(column: string): void {
  activeColumnMenu.value = activeColumnMenu.value === column ? '' : column
}

function isTextColumn(column: Column): boolean {
  const type = column.type.replace(/Nullable\s*\(/g, '').replace(/LowCardinality\s*\(/g, '')
  return /^\s*String\s*\)*\s*$/.test(type)
}

function isIdColumn(column: Column): boolean {
  const trimmed = column.name.trim()
  const lower = trimmed.toLowerCase()
  if (lower === 'id' || lower === 'uuid') return true
  if (lower.endsWith('_id') || lower.startsWith('id_')) return true
  if (/[a-z0-9]Id$/.test(trimmed) || /^id[A-Z]/.test(trimmed)) return true
  return false
}

function pickDefaultRareColumn(cols: Column[]): string {
  return cols.find((col) => !isIdColumn(col))?.name ?? cols[0]?.name ?? ''
}

function clearSavePollTimer(): void {
  activeSavePollRun += 1
  if (savePollTimer !== null) {
    clearTimeout(savePollTimer)
    savePollTimer = null
  }
}

function openSaveDialog(): void {
  saveDialogMode.value = 'database'
  const sourceName = pipeline.value.source.table
  resultDatabase.value = pipeline.value.source.database
  resultTableName.value = `${sourceName}_cleaned`.slice(0, 64)
  resultEngine.value = pipeline.value.saveOptions.engine
  orderBy.value = [...pipeline.value.saveOptions.orderBy]
  saveOriginal.value = pipeline.value.saveOptions.saveOriginal
  applyError.value = ''
  applyResult.value = null
  applyProgress.value = null
  showSaveDialog.value = true
}

function openEtlSaveDialog(): void {
  if (!etlResult.value || etlResult.value.total_rows === 0) return
  saveDialogMode.value = 'etl'
  const [defaultDb, defaultTbl] = activeEtlMeta.value.targetTable.split('.')
  resultDatabase.value = defaultDb || saveDatabaseOptions.value[0] || 'dataset'
  const baseName = (defaultTbl || activeEtlMeta.value.id).replace(/[^A-Za-z0-9_]/g, '_')
  resultTableName.value = `${baseName}_baru`.slice(0, 64)
  resultEngine.value = 'MergeTree'

  const schema = etlResult.value.column_schema?.length
    ? etlResult.value.column_schema
    : etlResult.value.columns.map((name) => ({ name, type: 'String' }))
  const nonNullable = schema.filter((col) => !isNullable(col.type))
  const preferred = nonNullable.find((col) => ['id', 'uuid'].includes(col.name.toLowerCase())) ?? nonNullable[0]
  orderBy.value = preferred ? [preferred.name] : []

  applyError.value = ''
  applyResult.value = null
  applyProgress.value = null
  showSaveDialog.value = true
}

function selectOrderBy(column: string): void {
  orderBy.value = [column]
}

async function applyPipeline(): Promise<void> {
  if (!canApply.value) return
  if (saveDialogMode.value === 'etl') {
    applying.value = true
    applyError.value = ''
    applyProgress.value = {
      currentStep: 0,
      totalSteps: 1,
      message: 'Membuat tabel baru dari hasil ETL di ClickHouse...',
    }
    try {
      const response = await executeEtlRequest('sync_db', {
        targetDb: resultDatabase.value,
        targetTable: resultTableName.value,
        engine: resultEngine.value,
        orderBy: orderBy.value[0] || '',
      })
      etlResult.value = response
      etlSyncMessage.value = response.message
      const [resDb, resTbl] = (response.targetTable || `${resultDatabase.value}.${resultTableName.value}`).split('.')
      const targetDbName = resDb || resultDatabase.value
      const targetTableName = resTbl || resultTableName.value
      await loadDatabases()
      await loadTables(targetDbName)
      applyResult.value = {
        status: 'done',
        database: targetDbName,
        table: targetTableName,
        rows: response.total_rows,
        steps: 0,
        durationMs: response.durationMs,
        verification: response.message,
      }
    } catch (error) {
      applyError.value = getErrorMessage(error, 'Tabel hasil ETL tidak dapat dibuat.')
    } finally {
      applying.value = false
    }
    return
  }

  clearSavePollTimer()
  const pollRun = activeSavePollRun
  applying.value = true
  applyError.value = ''
  applyProgress.value = {
    currentStep: 0,
    totalSteps: pipeline.value.steps.length,
    message: 'Mengirim permintaan pembuatan tabel...',
  }

  try {
    const startResponse = await $fetch<SaveTableStartResponse>('/api/workbench/save-table', {
      method: 'POST',
      body: {
        source: pipeline.value.source,
        steps: pipeline.value.steps,
        resultTableName: resultTableName.value,
        engine: resultEngine.value,
        orderBy: orderBy.value,
        saveOriginal: saveOriginal.value,
      },
    })

    if (pollRun !== activeSavePollRun) return
    applyProgress.value = {
      currentStep: startResponse.currentStep,
      totalSteps: startResponse.totalSteps,
      message: startResponse.message,
    }

    let consecutiveErrors = 0
    const pollStatus = async (): Promise<void> => {
      if (pollRun !== activeSavePollRun) return
      try {
        const statusRes = await $fetch<SaveTableStatusResponse>('/api/workbench/save-table-status', {
          query: { jobId: startResponse.jobId },
        })
        if (pollRun !== activeSavePollRun) return
        consecutiveErrors = 0
        applyProgress.value = {
          currentStep: statusRes.currentStep,
          totalSteps: statusRes.totalSteps,
          message: statusRes.message,
        }

        if (statusRes.status === 'done' && statusRes.result) {
          applyResult.value = statusRes.result
          applying.value = false
          return
        }
        if (statusRes.status === 'error') {
          applyError.value = statusRes.error || statusRes.message || 'Tabel hasil tidak dapat dibuat.'
          applying.value = false
          return
        }

        savePollTimer = setTimeout(() => {
          void pollStatus()
        }, 2000)
      } catch (pollErr) {
        if (pollRun !== activeSavePollRun) return
        const statusCode = pollErr && typeof pollErr === 'object' && 'statusCode' in pollErr
          ? Number((pollErr as { statusCode?: unknown }).statusCode)
          : 0
        consecutiveErrors += 1
        if (statusCode === 400 || statusCode === 404 || consecutiveErrors >= 3) {
          applyError.value = getErrorMessage(pollErr, 'Gagal memeriksa progres pembuatan tabel.')
          applying.value = false
          return
        }
        savePollTimer = setTimeout(() => {
          void pollStatus()
        }, 2000)
      }
    }

    savePollTimer = setTimeout(() => {
      void pollStatus()
    }, 2000)
  } catch (error) {
    if (pollRun !== activeSavePollRun) return
    applyError.value = getErrorMessage(error, 'Tabel hasil tidak dapat dibuat.')
    applying.value = false
  }
}

async function viewResultTable(): Promise<void> {
  if (!applyResult.value) return
  selectedSource.setDatabase(applyResult.value.database)
  selectedSource.setTable(applyResult.value.table)
  await navigateTo('/sumber-data')
}

function openResultExportDialog(): void {
  if (!applyResult.value) return
  showResultExportDialog.value = true
}

function closePanels(): void {
  if (!applying.value && !importingTemplate.value) {
    showSqlPanel.value = false
    showExportDialog.value = false
    showImportDialog.value = false
    showMappingDialog.value = false
    showResultExportDialog.value = false
    closeSaveDialog()
  }
}

function closeSaveDialog(): void {
  if (applying.value) return
  showResultExportDialog.value = false
  showSaveDialog.value = false
}

function rareItemKey(item: RareValueItem): string {
  return `${item.jenis}:${item.nilaiAsli ?? ''}`
}

function isRareItemFiltered(item: RareValueItem): boolean {
  if (!displayFilter.value || !rareResult.value) return false
  return displayFilter.value.column === rareResult.value.column
    && displayFilter.value.kind === item.jenis
    && (item.jenis !== 'text' || displayFilter.value.value === item.nilaiAsli)
}

function toggleRareDisplayFilter(item: RareValueItem): void {
  if (!rareResult.value) return
  if (isRareItemFiltered(item)) {
    displayFilter.value = null
  } else {
    displayFilter.value = {
      column: rareResult.value.column,
      kind: item.jenis,
      value: item.nilaiAsli,
      label: item.nilai,
    }
  }
  page.value = 1
  void loadPreview()
}

function clearDisplayFilter(): void {
  displayFilter.value = null
  page.value = 1
  void loadPreview()
}

function setSourceMode(mode: SourceMode): void {
  sourceMode.value = mode
  etlError.value = ''
}

function changeEtlPipeline(event: Event): void {
  const next = (event.target as HTMLSelectElement).value as EtlPipelineId
  etlPipeline.value = next
  etlFile.value = null
  etlFile2025.value = null
  etlFile2026.value = null
  etlDragActive.value = false
  etlDragActive2025.value = false
  etlDragActive2026.value = false
  etlRawText.value = ''
  etlError.value = ''
  etlSyncMessage.value = ''
  etlResult.value = null
  etlPage.value = 1
}

function onCourseEsSourceModeChange(): void {
  etlError.value = ''
}

function clearEtlCourseFileDates(): void {
  etlFileStartDate.value = ''
  etlFileEndDate.value = ''
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function assignEtlVplFile(year: '2025' | '2026', file: File): void {
  etlError.value = ''
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    etlError.value = `File VPL ${year} harus berformat Excel (.xlsx).`
    return
  }
  if (year === '2025') etlFile2025.value = file
  else etlFile2026.value = file
}

function handleEtlVplFileChange(year: '2025' | '2026', event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) assignEtlVplFile(year, file)
}

function handleEtlVplDrop(year: '2025' | '2026', event: DragEvent): void {
  if (year === '2025') etlDragActive2025.value = false
  else etlDragActive2026.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) assignEtlVplFile(year, file)
}

function clearEtlVplFile(year: '2025' | '2026'): void {
  if (year === '2025') etlFile2025.value = null
  else etlFile2026.value = null
}

function assignEtlFile(file: File): void {
  etlError.value = ''
  const lower = file.name.toLowerCase()
  if (etlPipeline.value === 'media_humas') {
    if (!lower.endsWith('.txt')) {
      etlError.value = 'Pipeline Publikasi Media Humas hanya menerima file .txt.'
      return
    }
    etlFile.value = file
    void file.text().then((txt) => {
      etlRawText.value = txt
    }).catch(() => {})
    return
  }
  if (etlPipeline.value === 'course_es') {
    if (!lower.endsWith('.json') && !lower.endsWith('.csv')) {
      etlError.value = 'Pipeline Course Elasticsearch mode file hanya menerima file .json atau .csv.'
      return
    }
    etlFile.value = file
    return
  }
  if (!lower.endsWith('.xlsx')) {
    etlError.value = 'Pipeline ini hanya menerima file Excel (.xlsx).'
    return
  }
  etlFile.value = file
}

function handleEtlFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) assignEtlFile(file)
}

function handleEtlDrop(event: DragEvent): void {
  etlDragActive.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) assignEtlFile(file)
}

function clearEtlFile(): void {
  etlFile.value = null
}

function clearEtlInputs(): void {
  etlFile.value = null
  etlFile2025.value = null
  etlFile2026.value = null
  etlRawText.value = ''
  etlError.value = ''
}

function changeEtlPage(nextPage: number): void {
  if (nextPage < 1 || nextPage > etlTotalPages.value) return
  etlPage.value = nextPage
}

function changeEtlLimit(event: Event): void {
  const nextLimit = Number((event.target as HTMLSelectElement).value)
  if (![25, 50, 100].includes(nextLimit)) return
  etlLimit.value = nextLimit
  etlPage.value = 1
}

type EtlCustomTargetPayload = {
  targetDb: string
  targetTable: string
  engine: 'MergeTree' | 'ReplacingMergeTree'
  orderBy: string
}

async function executeEtlRequest(
  action: 'preview' | 'sync_db',
  customTarget?: EtlCustomTargetPayload,
): Promise<EtlResponse> {
  if (etlPipeline.value === 'course_es' && etlCourseEsSourceMode.value === 'api') {
    return await $fetch<EtlResponse>('/api/etl/run', {
      method: 'POST',
      body: {
        pipeline: etlPipeline.value,
        action,
        sourceMode: 'api',
        startDate: etlStartDate.value,
        endDate: etlEndDate.value,
        ...(customTarget ?? {}),
      },
    })
  }
  if (etlPipeline.value === 'media_humas' && !etlFile.value) {
    return await $fetch<EtlResponse>('/api/etl/run', {
      method: 'POST',
      body: {
        pipeline: etlPipeline.value,
        action,
        rawText: etlRawText.value,
        ...(customTarget ?? {}),
      },
    })
  }

  const formData = new FormData()
  formData.append('pipeline', etlPipeline.value)
  formData.append('action', action)
  if (etlPipeline.value === 'peserta_vpl') {
    if (etlFile2025.value) formData.append('file_2025', etlFile2025.value)
    if (etlFile2026.value) formData.append('file_2026', etlFile2026.value)
  } else if (etlFile.value) {
    formData.append('file', etlFile.value)
  }
  if (etlPipeline.value === 'course_es') {
    formData.append('sourceMode', 'file')
    if (etlFileStartDate.value) formData.append('startDate', etlFileStartDate.value)
    if (etlFileEndDate.value) formData.append('endDate', etlFileEndDate.value)
  }
  if (etlPipeline.value === 'media_humas' && etlRawText.value.trim()) {
    formData.append('rawText', etlRawText.value)
  }
  if (etlPipeline.value === 'anggaran_sp2d' && etlTanggalRealisasi.value) {
    formData.append('tanggalRealisasi', etlTanggalRealisasi.value)
  }
  if (customTarget) {
    formData.append('targetDb', customTarget.targetDb)
    formData.append('targetTable', customTarget.targetTable)
    formData.append('engine', customTarget.engine)
    formData.append('orderBy', customTarget.orderBy)
  }
  return await $fetch<EtlResponse>('/api/etl/run', {
    method: 'POST',
    body: formData,
  })
}

async function runEtlPipeline(action: 'preview' | 'sync_db'): Promise<void> {
  if (!canRunEtl.value) return
  etlError.value = ''
  if (action === 'preview') {
    etlProcessing.value = true
    etlSyncMessage.value = ''
  } else {
    etlSyncing.value = true
  }

  try {
    const response = await executeEtlRequest(action)
    etlResult.value = response
    if (action === 'preview') {
      etlPage.value = 1
    } else {
      etlSyncMessage.value = response.message
      void loadDatabases()
    }
  } catch (error) {
    etlError.value = getErrorMessage(error, 'Pipeline ETL gagal dijalankan.')
  } finally {
    etlProcessing.value = false
    etlSyncing.value = false
  }
}

function downloadEtlCsv(): void {
  const token = etlResult.value?.download_token
  if (!token) return
  const filename = etlResult.value?.csv_filename || 'etl_output.csv'
  const url = `/api/etl/download?token=${encodeURIComponent(token)}&filename=${encodeURIComponent(filename)}`
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function loadRareValues(): Promise<void> {
  if (!sourceReady.value || !rareColumn.value) return
  const request = ++rareRequest
  abortRareValues()
  const controller = new AbortController()
  rareController = controller
  rarePending.value = true
  rareError.value = ''
  selectedRareKeys.value = []
  try {
    const response = await $fetch<RareValuesResponse>('/api/workbench/rare-values', {
      method: 'POST',
      body: {
        source: pipeline.value.source,
        steps: pipeline.value.steps,
        upTo: selectedStep.value,
        column: rareColumn.value,
        threshold: rareThreshold.value,
        limit: rareLimit.value,
        search: rareSearch.value,
        excludeNull: rareExcludeNull.value,
        excludeEmpty: rareExcludeEmpty.value,
      },
      signal: controller.signal,
    })
    if (request !== rareRequest || controller.signal.aborted || response.aborted) return
    rareResult.value = response
  } catch (error) {
    if (request !== rareRequest || controller.signal.aborted || isAbortLikeError(error)) return
    rareResult.value = null
    rareError.value = getErrorMessage(error, 'Nilai frekuensi rendah dari seluruh data tidak dapat dianalisis.')
  } finally {
    if (rareController === controller) rareController = null
    if (request === rareRequest) rarePending.value = false
  }
}

function createReplaceFromRare(): void {
  const replaceOp = operations.value.find((op) => op.id === 'replace_values')
  if (!replaceOp || !rareResult.value || selectedRareItems.value.length === 0) return

  const seenOld = new Set<string>()
  const pairs: Array<{ old: string; new: string }> = []
  for (const item of selectedRareItems.value) {
    const oldVal = item.nilaiAsli ?? ''
    if (seenOld.has(oldVal)) continue
    seenOld.add(oldVal)
    pairs.push({ old: oldVal, new: '' })
  }

  selectedOperationId.value = replaceOp.id
  editingStepIndex.value = null
  insertAtIndex.value = selectedStep.value
  prefilledColumn.value = ''
  formInitialParams.value = {
    column: rareResult.value.column,
    pairs,
    ignoreCase: false,
    ignoreTrim: false,
  }
  formKey.value += 1
}

function openExportDialog(): void {
  if (!sourceReady.value || pipeline.value.steps.length === 0) return
  exportTemplateName.value = `Cleansing Template ${pipeline.value.source.table}`
  exportError.value = ''
  showExportDialog.value = true
}

function downloadCleansingTemplate(): void {
  const name = exportTemplateName.value.trim()
  if (!name) {
    exportError.value = 'Nama cleansing template wajib diisi.'
    return
  }
  const payload = {
    version: 1,
    name,
    createdAt: new Date().toISOString(),
    suggestedSource: {
      database: pipeline.value.source.database,
      table: pipeline.value.source.table,
    },
    steps: pipeline.value.steps.map((step) => ({
      op: step.op,
      params: step.params,
    })),
    saveOptions: {
      engine: resultEngine.value,
      orderBy: [...orderBy.value],
      saveOriginal: saveOriginal.value,
    },
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cleansing-template'
  const link = document.createElement('a')
  link.href = url
  link.download = `${slug}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  showExportDialog.value = false
}

function openImportDialog(): void {
  importError.value = ''
  importDragActive.value = false
  showImportDialog.value = true
}

function handleTemplateDrop(event: DragEvent): void {
  importDragActive.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void processImportFile(file)
}

function handleTemplateFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void processImportFile(file)
}

async function processImportFile(file: File): Promise<void> {
  importError.value = ''
  if (file.size > 1024 * 1024) {
    importError.value = 'Ukuran file cleansing template melebihi batas maksimal 1 MB.'
    return
  }
  importingTemplate.value = true
  try {
    const rawJson = await file.text()
    const response = await $fetch<ImportTemplateResponse>('/api/workbench/import-recipe', {
      method: 'POST',
      body: {
        rawJson,
        ...(sourceReady.value ? { source: pipeline.value.source } : {}),
      },
    })

    pipeline.value.steps = response.steps
    workbench.setSaveOptions(response.recipe.saveOptions)
    resultEngine.value = response.recipe.saveOptions.engine
    orderBy.value = [...response.recipe.saveOptions.orderBy]
    saveOriginal.value = response.recipe.saveOptions.saveOriginal

    selectedStep.value = response.steps.length > 0 && response.summary.invalid === 0 ? response.steps.length : 0
    page.value = 1
    displayFilter.value = null
    rareResult.value = null
    selectedRareKeys.value = []
    resetOperationForm()
    workbench.savePipeline()

    const suggested = response.recipe.suggestedSource
    const suggestedSourceNote = suggested && (suggested.database !== pipeline.value.source.database || suggested.table !== pipeline.value.source.table)
      ? `Saran sumber cleansing template: ${suggested.database}.${suggested.table} (hanya saran, tetap menggunakan tabel sumber saat ini).`
      : ''

    importSummary.value = {
      name: response.recipe.name,
      valid: response.summary.valid,
      invalid: response.summary.invalid,
      suggestedSourceNote,
    }

    showImportDialog.value = false
    await refreshStepSchemas()
    void loadPreview()
  } catch (error) {
    importError.value = getErrorMessage(error, 'File cleansing template tidak dapat diimpor.')
  } finally {
    importingTemplate.value = false
  }
}

function openMappingDialog(): void {
  for (const key of Object.keys(columnMappingDraft)) delete columnMappingDraft[key]
  for (const item of missingColumnReferences.value) {
    columnMappingDraft[item.column] = ''
  }
  showMappingDialog.value = true
}

function applyColumnMapping(): void {
  const map = new Map<string, string>()
  for (const item of missingColumnReferences.value) {
    const replacement = columnMappingDraft[item.column]
    if (replacement) map.set(item.column, replacement)
  }
  if (map.size === 0) {
    showMappingDialog.value = false
    return
  }

  const remap = (val: unknown): unknown => (typeof val === 'string' && map.has(val) ? map.get(val) : val)
  pipeline.value.steps = pipeline.value.steps.map((step) => {
    const p = { ...step.params }
    if (step.op === 'trim_text' || step.op === 'replace_values') {
      p.column = remap(p.column)
    } else if (step.op === 'add_column') {
      if (p.kind === 'sequence') p.orderColumn = remap(p.orderColumn)
      if (p.kind === 'combine' && Array.isArray(p.columns)) p.columns = p.columns.map(remap)
    } else if (step.op === 'manage_columns') {
      if (p.mode === 'drop' && Array.isArray(p.columns)) p.columns = p.columns.map(remap)
      if (p.mode === 'rename') p.sourceColumn = remap(p.sourceColumn)
    } else if (step.op === 'deduplicate') {
      if (Array.isArray(p.keyColumns)) p.keyColumns = p.keyColumns.map(remap)
      if (p.orderColumn) p.orderColumn = remap(p.orderColumn)
      if (Array.isArray(p.completenessColumns)) p.completenessColumns = p.completenessColumns.map(remap)
    } else if (step.op === 'conditional_rule' && Array.isArray(p.rules)) {
      p.rules = p.rules.map((rule: any) => ({
        ...rule,
        targetColumn: remap(rule.targetColumn),
        sourceColumn: rule.action === 'copy_column' ? remap(rule.sourceColumn) : rule.sourceColumn,
        conditions: Array.isArray(rule.conditions)
          ? rule.conditions.map((cond: any) => ({ ...cond, column: remap(cond.column) }))
          : rule.conditions,
      }))
    } else if (step.op === 'extract_and_route') {
      p.sourceColumn = remap(p.sourceColumn)
      if (p.createTarget !== true) p.targetColumn = remap(p.targetColumn)
    } else if (step.op === 'fill_from_master') {
      p.sourceColumn = remap(p.sourceColumn)
      p.targetColumn = remap(p.targetColumn)
    } else if (step.op === 'fuzzy_match_master') {
      p.sourceColumn = remap(p.sourceColumn)
      if (p.createTarget !== true && typeof p.targetColumn === 'string' && p.targetColumn) {
        p.targetColumn = remap(p.targetColumn)
      }
      if (p.routeUnmatched === true) p.unmatchedColumn = remap(p.unmatchedColumn)
    }
    return { ...step, params: p }
  })

  workbench.savePipeline()
  showMappingDialog.value = false
  void refreshStepSchemas()
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closePanels()
    return
  }
  if (event.key !== 'Tab') return
  const dialog = event.currentTarget as HTMLElement
  const focusable = [...dialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
  )].filter((element) => element.getAttribute('aria-hidden') !== 'true')
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (!first || !last) return
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
    event.preventDefault()
    first.focus()
  }
}

watch([showSqlPanel, showSaveDialog, showExportDialog, showImportDialog, showMappingDialog], async (next, prev) => {
  const anyOpen = next.some(Boolean)
  const wasAnyOpen = prev.some(Boolean)
  if (anyOpen) {
    if (!wasAnyOpen) {
      returnFocusElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    await nextTick()
    const selector = next[1]
      ? '.wb-save-dialog'
      : next[2]
        ? '.wb-export-dialog'
        : next[3]
          ? '.wb-import-dialog'
          : next[4]
            ? '.wb-mapping-dialog'
            : '.wb-sql-dialog'
    const dialog = document.querySelector<HTMLElement>(selector)
    const initialFocus = dialog?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')
    ;(initialFocus ?? dialog)?.focus()
  } else if (wasAnyOpen) {
    returnFocusElement?.focus()
    returnFocusElement = null
  }
})

watch([resultEngine, orderBy, saveOriginal], ([engine, nextOrderBy, nextSaveOriginal]) => {
  if (saveDialogMode.value !== 'database') return
  workbench.setSaveOptions({
    engine,
    orderBy: [...nextOrderBy],
    saveOriginal: nextSaveOriginal,
  })
}, { deep: true })

watch(rareTextColumns, (cols) => {
  if (!cols.some((c) => c.name === rareColumn.value)) {
    rareColumn.value = pickDefaultRareColumn(cols)
    rareResult.value = null
    selectedRareKeys.value = []
  }
}, { immediate: true })

watch(visibleColumns, (cols) => {
  if (displayFilter.value && !cols.some((c) => c.name === displayFilter.value?.column)) {
    displayFilter.value = null
    void loadPreview()
  }
})

watch(
  () => `${pipeline.value.source.database}\u0000${pipeline.value.source.table}\u0000${JSON.stringify(pipeline.value.steps)}`,
  () => {
    page.value = 1
    abortRareValues()
    rareResult.value = null
    rareError.value = ''
    selectedRareKeys.value = []
    workbench.savePipeline()
    void refreshStepSchemas()
    if (pipeline.value.source.database && pipeline.value.source.table) {
      void loadSourceColumns(pipeline.value.source.database, pipeline.value.source.table)
    }
    void loadPreview()
  },
)

watch([selectedStep, page, limit], () => {
  void loadPreview()
})

watch(selectedStep, () => {
  abortRareValues()
  rareResult.value = null
  rareError.value = ''
  selectedRareKeys.value = []
})

watch(
  () => pipeline.value.source.database,
  (database) => {
    if (database) void loadTables(database)
    else tables.value = []
  },
)

onMounted(async () => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  workbench.initialize()
  resultEngine.value = pipeline.value.saveOptions.engine
  orderBy.value = [...pipeline.value.saveOptions.orderBy]
  saveOriginal.value = pipeline.value.saveOptions.saveOriginal
  await Promise.all([loadDatabases(), loadOperations()])
  if (pipeline.value.source.database) await loadTables(pipeline.value.source.database)
  if (pipeline.value.source.database && pipeline.value.source.table) {
    await loadSourceColumns(pipeline.value.source.database, pipeline.value.source.table)
    void refreshStepSchemas()
    void loadPreview()
  }
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  clearSavePollTimer()
  workbench.abortPreview()
  abortRareValues()
  schemaController?.abort()
  schemaController = null
})
</script>

<style scoped>
.workbench-page {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.workbench-page > *,
.wb-grid > * {
  min-width: 0;
}

.wb-source {
  display: grid;
  grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr) auto;
  align-items: end;
  gap: 12px;
}

.wb-source-title {
  grid-column: 1 / -1;
}

.wb-source-title .card-title {
  margin: 0;
}

.wb-source-title p {
  margin: 4px 0 0;
  color: var(--warna-redup);
  font-size: 13px;
}

.wb-source-field {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.wb-source-field label,
.wb-save-form > label {
  color: #40566d;
  font-size: 13px;
  font-weight: 650;
}

.wb-source select,
.wb-save-form > input,
.wb-save-form > select {
  width: 100%;
  min-width: 0;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
}

.wb-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(220px, 0.9fr) minmax(0, 2fr) minmax(250px, 1fr);
  align-items: start;
  gap: 16px;
}

.wb-steps-card,
.wb-data-card,
.wb-operations-card {
  min-width: 0;
  margin: 0;
}

.wb-card-heading,
.wb-data-actions,
.wb-pagination,
.wb-pagination > div,
.wb-dialog-heading,
.wb-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.wb-card-heading {
  margin-bottom: 14px;
}

.wb-card-heading .page-kicker,
.wb-data-title .page-kicker {
  margin-bottom: 3px;
}

.wb-card-heading .card-title,
.wb-data-title .card-title {
  margin: 0;
}

.wb-button,
.wb-icon-button,
.wb-link-button,
.wb-sql-link {
  min-height: 38px;
  padding: 7px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: #375875;
  background: #fff;
  font: inherit;
  cursor: pointer;
}

.wb-button:disabled,
.wb-icon-button:disabled,
.wb-link-button:disabled,
.wb-sql-link:disabled {
  color: #8998a8;
  background: #f5f8fa;
  cursor: not-allowed;
}

.wb-small {
  min-height: 34px;
  padding: 5px 8px;
  font-size: 12px;
}

.wb-primary {
  border-color: var(--warna-utama);
  color: #fff;
  background: var(--warna-utama);
  font-weight: 700;
}

.wb-save-open {
  min-height: 42px;
  white-space: normal;
}

.wb-message,
.wb-inline-status {
  margin: 8px 0;
  color: var(--warna-redup);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.wb-error,
.wb-danger-text {
  color: #963c35;
}

.wb-warning {
  margin: 0;
  padding: 9px;
  border: 1px solid #ecdca4;
  border-radius: 8px;
  color: #74591c;
  background: #fff9e6;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.wb-link-button {
  min-height: 0;
  padding: 0;
  border: 0;
  color: var(--warna-utama);
  background: transparent;
  font-size: 13px;
}

.wb-step-list {
  display: grid;
  gap: 9px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}

.wb-step-row {
  min-width: 0;
}

.wb-step {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  color: var(--warna-teks);
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.wb-step-selected {
  border-color: var(--warna-utama);
  box-shadow: 0 0 0 2px rgb(87 152 215 / 12%);
}

.wb-step-number {
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 50%;
  color: #375875;
  background: var(--warna-biru-muda);
  font-size: 12px;
  font-weight: 750;
}

.wb-step-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.wb-step-copy strong,
.wb-step-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-step-copy strong {
  font-size: 12px;
}

.wb-step-copy small {
  color: var(--warna-redup);
  font-size: 11px;
}

.wb-status {
  padding: 3px 6px;
  border: 1px solid var(--warna-garis);
  border-radius: 999px;
  color: #5a6c7d;
  font-size: 10px;
  white-space: nowrap;
}

.wb-status-valid {
  border-color: #c9dec1;
  color: #315d27;
  background: #edf5e9;
}

.wb-status-error {
  border-color: #f0c8c4;
  color: #8a352e;
  background: #fdf0ee;
}

.wb-status-loading {
  color: #526479;
  background: #f2f5f8;
}

.wb-step-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 6px 0 0 35px;
}

.wb-icon-button {
  min-height: 30px;
  padding: 4px 7px;
  font-size: 11px;
}

.wb-step-error {
  margin: 7px 0 0 35px;
  color: #963c35;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.wb-sql-link {
  width: 100%;
  margin-top: 15px;
  color: var(--warna-utama);
  font-size: 13px;
  font-weight: 650;
}

.wb-data-card {
  overflow: hidden;
}

.wb-data-heading {
  flex-wrap: wrap;
}

.wb-limit-field {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-limit-field select {
  min-height: 36px;
  padding: 5px 8px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  background: #fff;
  font: inherit;
}

.wb-data-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.wb-inline-status {
  margin: 0;
}

.wb-table-viewport {
  width: 100%;
  max-width: 100%;
  max-height: 560px;
  overflow: auto;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  overscroll-behavior: contain;
}

.wb-table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}

.wb-table th,
.wb-table td {
  max-width: 280px;
  min-width: 130px;
  padding: 9px 10px;
  border-right: 1px solid #e8eff5;
  border-bottom: 1px solid #e8eff5;
  text-align: left;
  vertical-align: top;
}

.wb-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: #526479;
  background: #f5f8fa;
  font-weight: 650;
}

.wb-table th:last-child,
.wb-table td:last-child {
  border-right: 0;
}

.wb-column-heading {
  position: relative;
  display: grid;
  gap: 4px;
}

.wb-column-menu-button {
  max-width: 100%;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.wb-column-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-column-heading > small {
  display: block;
  max-width: 220px;
  overflow: hidden;
  color: #8190a0;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-column-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 4;
  display: grid;
  min-width: 190px;
  max-width: min(260px, 80vw);
  gap: 5px;
  padding: 9px;
  border: 1px solid var(--warna-garis);
  border-radius: 9px;
  background: #fff;
  box-shadow: var(--bayangan-kartu);
}

.wb-column-menu strong,
.wb-column-menu button,
.wb-column-menu p {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 11px;
}

.wb-column-menu button {
  padding: 6px;
  border: 0;
  border-radius: 6px;
  color: #375875;
  background: #f5f8fa;
  text-align: left;
  cursor: pointer;
}

.wb-cell {
  display: block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-cell-null {
  color: #9c3e36;
  font-style: italic;
}

.wb-cell-empty {
  color: #718196;
  font-style: italic;
}

.wb-cell-changed {
  padding: 1px 4px;
  border-radius: 4px;
  outline: 1px solid #e3c85b;
  background: #fff4bf;
}

.wb-pagination {
  flex-wrap: wrap;
  margin-top: 12px;
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-pagination > div {
  flex-wrap: wrap;
}

.wb-operation-list {
  display: grid;
  gap: 8px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}

.wb-operation-list button {
  display: grid;
  width: 100%;
  min-width: 0;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 9px;
  color: var(--warna-teks);
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.wb-operation-list button:disabled {
  cursor: not-allowed;
}

.wb-operation-list strong {
  font-size: 13px;
}

.wb-operation-list span {
  color: var(--warna-redup);
  font-size: 11px;
}

.wb-operation-name {
  margin: 0 0 12px;
  color: #263a4e;
  font-size: 15px;
}

.wb-backdrop {
  position: fixed;
  inset: 0;
  z-index: 8;
  background: rgb(21 38 55 / 38%);
}

.wb-dialog {
  position: fixed;
  inset: 50% auto auto 50%;
  z-index: 9;
  width: min(680px, calc(100vw - 32px));
  max-height: min(88vh, 900px);
  overflow: auto;
  transform: translate(-50%, -50%);
}

.wb-dialog-heading .card-title {
  margin: 0;
}

.wb-sql-dialog h3,
.wb-save-form h3 {
  margin: 16px 0 7px;
  color: #30455b;
  font-size: 14px;
}

.wb-code {
  max-height: 300px;
  overflow: auto;
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  background: #f7fafc;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.wb-save-form {
  display: grid;
  gap: 10px;
}

.wb-safety-note {
  margin: 0;
  padding: 10px;
  border: 1px solid #d5e5c4;
  border-radius: 8px;
  color: #426132;
  background: #f1f7e9;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.wb-order-fields {
  display: grid;
  gap: 8px;
  margin: 4px 0;
  padding: 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 9px;
}

.wb-order-fields legend {
  padding: 0 5px;
  color: #40566d;
  font-size: 13px;
  font-weight: 700;
}

.wb-order-fields > p {
  margin: 0;
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-order-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 6px;
  color: #526479;
  font-size: 12px;
}

.wb-order-option input,
.wb-save-original input {
  width: 16px;
  min-height: 16px;
  margin: 3px 0 0;
}

.wb-order-option > span {
  overflow-wrap: anywhere;
}

.wb-nullable-note {
  grid-column: 2;
  color: #8a6a22;
}

.wb-save-original {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #40566d;
  font-size: 13px;
}

.wb-summary {
  display: grid;
  gap: 9px;
  margin: 14px 0;
}

.wb-summary > div {
  display: grid;
  grid-template-columns: minmax(110px, 0.7fr) minmax(0, 1.3fr);
  gap: 8px;
}

.wb-summary dt {
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-summary dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.wb-summary-steps,
.wb-result-columns {
  display: grid;
  gap: 5px;
  margin: 0;
  padding-left: 20px;
  color: #526479;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.wb-result-columns {
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  padding: 0;
  list-style: none;
}

.wb-dialog-actions {
  justify-content: flex-start;
  flex-wrap: wrap;
  margin-top: 6px;
}

.wb-save-progress {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #c7dcef;
  border-radius: 9px;
  background: #f4f9fe;
}

.wb-save-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #2c4358;
  font-size: 13px;
}

.wb-save-progress-track {
  width: 100%;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #dfeaf4;
}

.wb-save-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--warna-utama);
  transition: width 250ms ease;
}

@media (max-width: 1100px) {
  .wb-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .wb-operations-card {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .wb-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
  }

  .wb-operations-card {
    grid-column: auto;
  }

  .wb-source {
    grid-template-columns: minmax(0, 1fr);
  }

  .wb-source-title {
    grid-column: 1;
  }

  .wb-save-open {
    width: 100%;
  }

  .wb-dialog {
    width: calc(100vw - 24px);
    max-height: 90vh;
    padding: 16px;
  }

  .wb-table th,
  .wb-table td {
    max-width: 220px;
    min-width: 120px;
  }
}

@media (max-width: 420px) {
  .wb-card-heading,
  .wb-data-heading,
  .wb-pagination,
  .wb-dialog-heading {
    align-items: flex-start;
  }

  .wb-step {
    grid-template-columns: 26px minmax(0, 1fr);
  }

  .wb-status {
    grid-column: 2;
    justify-self: start;
  }

  .wb-summary > div {
    grid-template-columns: 1fr;
    gap: 2px;
  }

  .wb-pagination {
    flex-direction: column;
  }
}

.wb-template-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #e8eff5;
}

.wb-template-actions .wb-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 6px 8px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: #40566d;
  background: #fff;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1.25;
  text-align: center;
  white-space: normal;
  overflow-wrap: break-word;
}

.wb-template-actions .wb-button:hover:not(:disabled) {
  border-color: #b8cde0;
  background: #f8fbfe;
}

.wb-template-actions .wb-button:disabled {
  color: #8998a8;
  background: #f5f8fa;
}

.wb-import-summary {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  padding: 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  background: #f5f9fd;
  font-size: 12px;
}

.wb-import-summary p {
  margin: 0;
  overflow-wrap: anywhere;
}

.wb-import-note {
  color: var(--warna-redup);
}

.wb-import-summary-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.wb-filter-chip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 10px;
  border: 1px solid #b8d3ec;
  border-radius: 9px;
  color: #263a4e;
  background: #edf5fc;
  font-size: 12px;
}

.wb-filter-chip span {
  overflow-wrap: anywhere;
}

.wb-data-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.wb-sample-inline {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.wb-sample-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid #b4d1ec;
  border-radius: 999px;
  color: #24507a;
  background: #e3f0fb;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.wb-sample-info-wrap {
  display: inline-flex;
  align-items: center;
}

.wb-sample-info-btn {
  display: inline-grid;
  width: 22px;
  height: 22px;
  padding: 0;
  place-items: center;
  border: 1px solid #b4d1ec;
  border-radius: 999px;
  color: #24507a;
  background: #f4f9fe;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.wb-sample-info-btn:hover,
.wb-sample-info-btn:focus-visible {
  border-color: var(--warna-utama);
  background: #e3f0fb;
}

.wb-sample-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 6;
  width: min(320px, calc(100vw - 64px));
  padding: 9px 11px;
  border: 1px solid #c7dcef;
  border-radius: 9px;
  color: #2c4358;
  background: #fff;
  box-shadow: var(--bayangan-kartu);
  font-size: 12px;
  line-height: 1.45;
}

.wb-col-sample-tag {
  display: inline-block;
  width: fit-content;
  margin-top: 2px;
  padding: 1px 6px;
  border: 1px solid #c7dcef;
  border-radius: 4px;
  color: #24507a;
  background: #eaf3fc;
  font-size: 10px;
  font-weight: 650;
}

.wb-rare-panel {
  display: grid;
  gap: 10px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--warna-garis);
}

.wb-rare-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.wb-rare-heading h3 {
  margin: 0;
  color: #263a4e;
  font-size: 15px;
}

.wb-full-data-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid #b8d8bd;
  border-radius: 4px;
  color: #255a30;
  background: #eaf5ec;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.wb-rare-loading {
  margin: 0;
  padding: 9px 11px;
  border: 1px solid #c7dcef;
  border-radius: 8px;
  color: #24507a;
  background: #f4f9fe;
  font-size: 12px;
  line-height: 1.45;
}

.wb-rare-heading p {
  margin: 3px 0 0;
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-rare-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  align-items: end;
}

.wb-rare-controls > label {
  display: grid;
  gap: 4px;
  min-width: 0;
  color: #40566d;
  font-size: 12px;
  font-weight: 650;
}

.wb-rare-controls select,
.wb-rare-controls input[type='number'],
.wb-rare-controls input[type='text'] {
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 6px 8px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
  font-size: 13px;
}

.wb-rare-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.wb-rare-check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #40566d;
  font-size: 12px;
  cursor: pointer;
}

.wb-rare-summary {
  margin: 0;
  color: var(--warna-redup);
  font-size: 12px;
}

.wb-rare-summary strong {
  color: #263a4e;
}

.wb-rare-bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  background: #f5f9fd;
  font-size: 12px;
}

.wb-rare-bulk > div {
  display: flex;
  gap: 6px;
}

.wb-rare-list {
  display: grid;
  gap: 4px;
  max-height: 240px;
  overflow: auto;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  background: #fff;
}

.wb-rare-list li {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
}

.wb-rare-list li:hover {
  background: #f5f9fd;
}

.wb-rare-item-active {
  background: #e6f1fa;
}

.wb-rare-value-btn {
  min-width: 0;
  padding: 2px 0;
  border: 0;
  color: var(--warna-teks);
  background: transparent;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-rare-count {
  padding: 2px 7px;
  border-radius: 999px;
  color: #375875;
  background: var(--warna-biru-muda);
  font-size: 11px;
  font-weight: 700;
}

.wb-dropzone {
  display: grid;
  place-items: center;
  gap: 8px;
  padding: 28px 16px;
  border: 2px dashed var(--warna-garis);
  border-radius: 12px;
  background: #f8fbfe;
  text-align: center;
  transition: border-color 150ms ease, background-color 150ms ease;
}

.wb-dropzone p,
.wb-dropzone span {
  margin: 0;
  color: var(--warna-redup);
  font-size: 13px;
}

.wb-dropzone-active {
  border-color: var(--warna-utama);
  background: #eaf4fc;
}

.wb-file-label {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}

.wb-file-label input[type='file'] {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.wb-mapping-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
}

.wb-mapping-row small {
  display: block;
  color: var(--warna-redup);
  font-size: 11px;
}

.wb-mapping-row select {
  width: 100%;
  min-height: 36px;
  padding: 6px 8px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 13px;
}

@media (max-width: 620px) {
  .wb-rare-controls,
  .wb-mapping-row,
  .wb-etl-date-grid,
  .wb-etl-excel-with-date {
    grid-template-columns: minmax(0, 1fr);
  }
}

.wb-source-etl {
  grid-template-columns: minmax(0, 1fr);
}

.wb-source-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.wb-mode-tabs {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--warna-garis);
  border-radius: 9px;
  background: #f4f8fc;
  gap: 3px;
}

.wb-mode-tab {
  min-height: 34px;
  padding: 5px 14px;
  border: 0;
  border-radius: 7px;
  color: #4b6178;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.wb-mode-tab-active {
  color: #fff;
  background: var(--warna-utama);
  font-weight: 700;
}

.wb-etl-controls {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
}

.wb-etl-dynamic-input {
  min-width: 0;
}

.wb-etl-submit-wrap {
  padding-top: 22px;
}

.wb-etl-hint {
  color: var(--warna-redup);
  font-size: 11px;
}

.wb-etl-input-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wb-etl-inline-tools,
.wb-etl-file-actions,
.wb-etl-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.wb-etl-textarea {
  width: 100%;
  min-width: 0;
  min-height: 112px;
  padding: 10px 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  resize: vertical;
}

.wb-etl-file-chip {
  margin: 4px 0 0;
  color: #375875;
  font-size: 12px;
}

.wb-etl-excel-wrap {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}

.wb-etl-vpl-wrap {
  display: grid;
  gap: 8px;
}

.wb-etl-vpl-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

.wb-etl-excel-with-date {
  grid-template-columns: minmax(0, 1fr) 190px;
  align-items: start;
}

.wb-etl-dropzone {
  padding: 16px;
}

.wb-etl-course-wrap,
.wb-etl-file-mode {
  display: grid;
  gap: 12px;
}

.wb-field-label {
  color: #40566d;
  font-size: 13px;
  font-weight: 650;
}

.wb-etl-source-toggle {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.wb-etl-radio-option {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  padding: 6px 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  background: #fff;
  color: #40566d;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 140ms ease, background-color 140ms ease, color 140ms ease;
}

.wb-etl-radio-option input[type='radio'] {
  margin: 0;
  accent-color: var(--warna-utama);
  cursor: pointer;
}

.wb-etl-radio-active {
  border-color: var(--warna-utama);
  background: #edf5fc;
  color: #24507a;
  font-weight: 650;
}

.wb-etl-date-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(150px, 1fr));
  gap: 12px;
}

.wb-etl-date-input {
  width: 100%;
  min-width: 0;
  min-height: 42px;
  padding: 8px 10px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: var(--warna-teks);
  background: #fff;
  font: inherit;
}

.wb-etl-preview-card {
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.wb-etl-summary-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.wb-etl-summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  color: #2f465c;
  background: #f5f9fd;
  font-size: 12px;
}

.wb-etl-banner {
  margin: 8px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.wb-etl-banner-error {
  border: 1px solid #f0c8c4;
  color: #8a352e;
  background: #fdf0ee;
}

.wb-etl-banner-success {
  margin-top: 0;
  margin-bottom: 12px;
  border: 1px solid #c9dec1;
  color: #315d27;
  background: #edf5e9;
}

@media (max-width: 900px) {
  .wb-etl-controls {
    grid-template-columns: minmax(0, 1fr);
  }

  .wb-etl-submit-wrap {
    padding-top: 0;
  }

  .wb-etl-vpl-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
