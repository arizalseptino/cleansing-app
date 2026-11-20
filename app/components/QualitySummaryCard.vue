<template>
  <section class="qs-card" aria-label="Ringkasan Kualitas Data">
    <div class="qs-header">
      <h3 class="qs-title">Ringkasan Kualitas Data (Sebelum → Sesudah)</h3>
      <span v-if="summary.status === 'dilewati'" class="qs-badge qs-badge-skipped">
        Dilewati
      </span>
    </div>

    <div class="qs-row-stats">
      <div class="qs-row-item">
        <span>Total baris</span>
        <strong>
          {{ formatNumber(summary.barisSebelum) }}
          <span class="qs-arrow" aria-hidden="true">→</span>
          {{ formatNumber(summary.barisSesudah) }}
        </strong>
      </div>
      <div class="qs-row-item">
        <span>Selisih baris</span>
        <strong :class="rowDeltaClass">{{ formatRowDelta(summary.selisihBaris) }}</strong>
      </div>
    </div>

    <p v-if="summary.catatan" class="qs-note" role="status">
      {{ summary.catatan }}
    </p>

    <div v-if="summary.kolom.length > 0" class="qs-table-wrap">
      <table class="qs-table">
        <thead>
          <tr>
            <th scope="col">Kolom</th>
            <th scope="col" class="qs-num">Kosong Sebelum</th>
            <th scope="col" class="qs-num">Kosong Sesudah</th>
            <th scope="col" class="qs-num">Selisih Perubahan</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in summary.kolom" :key="item.kolom">
            <td class="qs-col-name"><code>{{ item.kolom }}</code></td>
            <td class="qs-num">{{ formatNumber(item.kosongSebelum) }}</td>
            <td class="qs-num">{{ formatNumber(item.kosongSesudah) }}</td>
            <td class="qs-num">
              <span class="qs-delta" :class="columnDeltaClass(item.selisih)">
                {{ formatColumnDelta(item.selisih) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="summary.status === 'ok'" class="qs-empty-note">
      Tidak ada kolom yang sama antara tabel sumber dan tabel hasil untuk dibandingkan.
    </p>
  </section>
</template>

<script setup lang="ts">
export type QualitySummaryColumnStat = {
  kolom: string
  kosongSebelum: number
  kosongSesudah: number
  selisih: number
}

export type QualitySummaryData = {
  status: 'ok' | 'dilewati'
  barisSebelum: number
  barisSesudah: number
  selisihBaris: number
  kolom: QualitySummaryColumnStat[]
  catatan: string | null
}

const props = defineProps<{
  summary: QualitySummaryData
}>()

const rowDeltaClass = computed(() => {
  if (props.summary.selisihBaris < 0) return 'qs-delta-removed'
  if (props.summary.selisihBaris > 0) return 'qs-delta-added'
  return 'qs-delta-neutral'
})

function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

function formatRowDelta(delta: number): string {
  if (delta === 0) return '0 (tetap)'
  if (delta < 0) return `-${formatNumber(Math.abs(delta))} baris (berkurang)`
  return `+${formatNumber(delta)} baris`
}

function columnDeltaClass(delta: number): string {
  if (delta < 0) return 'qs-delta-improved'
  if (delta > 0) return 'qs-delta-cleaned'
  return 'qs-delta-neutral'
}

function formatColumnDelta(delta: number): string {
  if (delta === 0) return '0'
  if (delta < 0) {
    const abs = formatNumber(Math.abs(delta))
    return `-${abs} (${abs} terisi)`
  }
  const abs = formatNumber(delta)
  return `+${abs} (${abs} jadi kosong)`
}
</script>

<style scoped>
.qs-card {
  display: grid;
  gap: 10px;
  margin: 12px 0;
  padding: 12px;
  border: 1px solid var(--warna-garis);
  border-radius: 10px;
  background: #f8fbfe;
}

.qs-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.qs-title {
  margin: 0;
  color: #263a4e;
  font-size: 13px;
  font-weight: 700;
}

.qs-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 650;
}

.qs-badge-skipped {
  border: 1px solid #ecdca4;
  color: #74591c;
  background: #fff9e6;
}

.qs-row-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.qs-row-item {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid #e1ebf4;
  border-radius: 8px;
  background: #fff;
}

.qs-row-item > span {
  color: var(--warna-redup);
  font-size: 11px;
}

.qs-row-item > strong {
  color: #263a4e;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.qs-arrow {
  margin: 0 4px;
  color: var(--warna-redup);
  font-weight: 400;
}

.qs-note,
.qs-empty-note {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid #ecdca4;
  border-radius: 8px;
  color: #74591c;
  background: #fff9e6;
  font-size: 12px;
  line-height: 1.4;
}

.qs-empty-note {
  border-color: #e1ebf4;
  color: var(--warna-redup);
  background: #fff;
}

.qs-table-wrap {
  max-height: 220px;
  overflow: auto;
  border: 1px solid var(--warna-garis);
  border-radius: 8px;
  background: #fff;
}

.qs-table {
  width: 100%;
  min-width: 440px;
  border-collapse: collapse;
  font-size: 12px;
}

.qs-table th,
.qs-table td {
  padding: 7px 9px;
  border-bottom: 1px solid #edf2f7;
  text-align: left;
  vertical-align: middle;
}

.qs-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: #526479;
  background: #f3f7fb;
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

.qs-table tbody tr:last-child > td {
  border-bottom: 0;
}

.qs-col-name code {
  font-size: 11.5px;
  overflow-wrap: anywhere;
}

.qs-num {
  text-align: right !important;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.qs-delta {
  display: inline-block;
  font-weight: 600;
}

.qs-delta-improved {
  color: #255a30;
}

.qs-delta-cleaned {
  color: #24507a;
}

.qs-delta-removed {
  color: #375875;
}

.qs-delta-added {
  color: #24507a;
}

.qs-delta-neutral {
  color: var(--warna-redup);
  font-weight: 400;
}

@media (max-width: 560px) {
  .qs-row-stats {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
