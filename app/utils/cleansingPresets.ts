export type PresetColumn = {
  name: string
  type: string
}

export type PresetStepTemplate = {
  op: string
  params: Record<string, unknown>
}

export type QuickPresetId =
  | 'sipka_peserta'
  | 'sipka_2015'
  | 'smartbangkom_peserta'
  | 'standardisasi_umum'

export type QuickPresetDefinition = {
  id: QuickPresetId
  label: string
  recipeName: string
  buildSteps: (columns: PresetColumn[]) => PresetStepTemplate[]
}

export type RecipeTemplatePayload = {
  version: 1
  name: string
  createdAt: string
  steps: PresetStepTemplate[]
  saveOptions: {
    engine: 'MergeTree' | 'ReplacingMergeTree'
    orderBy: string[]
    saveOriginal: boolean
  }
}

export function isPresetTextColumn(column: PresetColumn): boolean {
  const type = column.type.replace(/Nullable\s*\(/g, '').replace(/LowCardinality\s*\(/g, '')
  return /^\s*String\s*\)*\s*$/.test(type)
}

const MINISTRY_REPLACE_PAIRS: Array<{ old: string; new: string }> = [
  { old: '-', new: '' },
  { old: '0', new: '' },
  { old: 'NULL', new: '' },
  { old: 'KEMENDAGRI', new: 'KEMENTERIAN DALAM NEGERI' },
  { old: 'KEMENKES', new: 'KEMENTERIAN KESEHATAN' },
  { old: 'KEMENDIKBUD', new: 'KEMENTERIAN PENDIDIKAN, KEBUDAYAAN, RISET DAN TEKNOLOGI' },
  { old: 'KEMENAG', new: 'KEMENTERIAN AGAMA' },
  { old: 'KEMENKEU', new: 'KEMENTERIAN KEUANGAN' },
]

const SIPKA_PESERTA_STEPS: PresetStepTemplate[] = [
  {
    op: 'deduplicate',
    params: {
      keyColumns: ['id'],
      strategy: 'most_complete',
      orderColumn: 'id',
      emptyValues: ['NULL', '', '-'],
    },
  },
  {
    op: 'trim_text',
    params: {
      column: 'asal_instansi',
      operations: ['trim', 'collapse_spaces', 'empty_to_null', 'upper'],
    },
  },
  {
    op: 'trim_text',
    params: {
      column: 'provinsi_instansi',
      operations: ['trim', 'collapse_spaces', 'empty_to_null', 'upper'],
    },
  },
  {
    op: 'trim_text',
    params: {
      column: 'kabkot_instansi',
      operations: ['trim', 'collapse_spaces', 'empty_to_null', 'upper'],
    },
  },
  {
    op: 'trim_text',
    params: {
      column: 'alamat_kantor',
      operations: ['collapse_spaces', 'trim', 'empty_to_null'],
    },
  },
  {
    op: 'replace_values',
    params: {
      column: 'asal_instansi',
      pairs: MINISTRY_REPLACE_PAIRS,
      ignoreCase: true,
      ignoreTrim: true,
    },
  },
  {
    op: 'extract_and_route',
    params: {
      sourceColumn: 'asal_instansi',
      patternType: 'regex',
      pattern: '^(DINAS|BADAN|KANTOR|INSPEKTORAT|SEKRETARIAT|KECAMATAN|KELURAHAN|PUSKESMAS|RSUD|SD|SMP|SMA|SMK)\\b.*(KAB\\.|KABUPATEN|KOTA)\\b',
      ignoreCase: true,
      action: 'copy',
      createTarget: false,
      targetColumn: 'alamat_kantor',
      onlyIfTargetEmpty: true,
    },
  },
  {
    op: 'extract_and_route',
    params: {
      sourceColumn: 'asal_instansi',
      patternType: 'regex',
      pattern: '\\b((?:KAB\\.|KABUPATEN)\\s+[A-Za-z][A-Za-z\\s\\.\\-]*?)(?:\\s*$|\\s*[,\\(\\/])',
      ignoreCase: true,
      action: 'extract',
      captureGroup: 1,
      createTarget: true,
      targetColumn: '',
      newTargetName: 'kab_ekstrak',
      onlyIfTargetEmpty: true,
      clearSourceAfterExtract: false,
    },
  },
  {
    op: 'extract_and_route',
    params: {
      sourceColumn: 'asal_instansi',
      patternType: 'regex',
      pattern: '\\b(KOTA\\s+[A-Za-z][A-Za-z\\s\\.\\-]*?)(?:\\s*$|\\s*[,\\(\\/])',
      ignoreCase: true,
      action: 'extract',
      captureGroup: 1,
      createTarget: true,
      targetColumn: '',
      newTargetName: 'kota_ekstrak',
      onlyIfTargetEmpty: true,
      clearSourceAfterExtract: false,
    },
  },
  {
    op: 'conditional_rule',
    params: {
      rules: [
        {
          conditions: [
            { column: 'kab_ekstrak', operator: 'not_empty', value: '', values: [''], ignoreCase: false, ignoreTrim: false },
          ],
          targetColumn: 'asal_instansi',
          action: 'copy_column',
          value: '',
          sourceColumn: 'kab_ekstrak',
        },
        {
          conditions: [
            { column: 'kota_ekstrak', operator: 'not_empty', value: '', values: [''], ignoreCase: false, ignoreTrim: false },
          ],
          targetColumn: 'asal_instansi',
          action: 'copy_column',
          value: '',
          sourceColumn: 'kota_ekstrak',
        },
      ],
    },
  },
  {
    op: 'fuzzy_match_master',
    params: {
      sourceColumn: 'asal_instansi',
      createTarget: false,
      targetColumn: 'asal_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_instansi_bkn',
      masterColumn: 'nama',
      mode: 'similarity',
      algorithm: 'jaro_winkler',
      threshold: 0.9,
      normalization: ['lowercase', 'trim', 'collapse_spaces'],
      routeUnmatched: true,
      unmatchedColumn: 'alamat_kantor',
    },
  },
  {
    op: 'fill_from_master',
    params: {
      sourceColumn: 'alamat_kantor',
      targetColumn: 'provinsi_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_provinsi',
      masterKeyColumn: 'nama_provinsi',
      masterValueColumn: 'nama_provinsi',
    },
  },
  {
    op: 'fill_from_master',
    params: {
      sourceColumn: 'asal_instansi',
      targetColumn: 'provinsi_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_provinsi',
      masterKeyColumn: 'nama_provinsi',
      masterValueColumn: 'nama_provinsi',
    },
  },
  {
    op: 'fill_from_master',
    params: {
      sourceColumn: 'alamat_kantor',
      targetColumn: 'kabkot_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_kabkot',
      masterKeyColumn: 'nama_kabkota',
      masterValueColumn: 'nama_kabkota',
    },
  },
  {
    op: 'fill_from_master',
    params: {
      sourceColumn: 'asal_instansi',
      targetColumn: 'kabkot_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_kabkot',
      masterKeyColumn: 'nama_kabkota',
      masterValueColumn: 'nama_kabkota',
    },
  },
  {
    op: 'conditional_rule',
    params: {
      rules: [
        {
          conditions: [
            { column: 'provinsi_instansi', operator: 'equals', value: 'DKI JAKARTA', values: [''], ignoreCase: true, ignoreTrim: true },
          ],
          targetColumn: 'kabkot_instansi',
          action: 'set_null',
          value: '',
          sourceColumn: '',
        },
      ],
    },
  },
]

const SIPKA_2015_STEPS: PresetStepTemplate[] = [
  {
    op: 'deduplicate',
    params: {
      keyColumns: ['id'],
      strategy: 'most_complete',
      orderColumn: 'id',
      emptyValues: ['NULL', '', '-'],
    },
  },
  {
    op: 'trim_text',
    params: {
      column: 'asal_instansi',
      operations: ['trim', 'collapse_spaces', 'empty_to_null', 'upper'],
    },
  },
  {
    op: 'trim_text',
    params: {
      column: 'provinsi_instansi',
      operations: ['trim', 'collapse_spaces', 'empty_to_null', 'upper'],
    },
  },
  {
    op: 'trim_text',
    params: {
      column: 'kabkot_instansi',
      operations: ['trim', 'collapse_spaces', 'empty_to_null', 'upper'],
    },
  },
  {
    op: 'trim_text',
    params: {
      column: 'alamat_kantor',
      operations: ['trim', 'collapse_spaces', 'empty_to_null', 'upper'],
    },
  },
  {
    op: 'conditional_rule',
    params: {
      rules: [
        {
          conditions: [
            { column: 'asal_instansi', operator: 'empty', value: '', values: [''], ignoreCase: false, ignoreTrim: false },
          ],
          targetColumn: 'asal_instansi',
          action: 'copy_column',
          value: '',
          sourceColumn: 'alamat_kantor',
        },
      ],
    },
  },
  {
    op: 'fuzzy_match_master',
    params: {
      sourceColumn: 'asal_instansi',
      createTarget: false,
      targetColumn: 'asal_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_instansi_bkn',
      masterColumn: 'nama',
      mode: 'similarity',
      algorithm: 'jaro_winkler',
      threshold: 0.9,
      normalization: ['lowercase', 'trim', 'collapse_spaces'],
      routeUnmatched: false,
    },
  },
  {
    op: 'fill_from_master',
    params: {
      sourceColumn: 'alamat_kantor',
      targetColumn: 'provinsi_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_provinsi',
      masterKeyColumn: 'nama_provinsi',
      masterValueColumn: 'nama_provinsi',
    },
  },
  {
    op: 'fill_from_master',
    params: {
      sourceColumn: 'asal_instansi',
      targetColumn: 'provinsi_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_provinsi',
      masterKeyColumn: 'nama_provinsi',
      masterValueColumn: 'nama_provinsi',
    },
  },
  {
    op: 'fill_from_master',
    params: {
      sourceColumn: 'alamat_kantor',
      targetColumn: 'kabkot_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_kabkot',
      masterKeyColumn: 'nama_kabkota',
      masterValueColumn: 'nama_kabkota',
    },
  },
  {
    op: 'fill_from_master',
    params: {
      sourceColumn: 'asal_instansi',
      targetColumn: 'kabkot_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_kabkot',
      masterKeyColumn: 'nama_kabkota',
      masterValueColumn: 'nama_kabkota',
    },
  },
]

const SMARTBANGKOM_PESERTA_STEPS: PresetStepTemplate[] = [
  {
    op: 'deduplicate',
    params: {
      keyColumns: ['id'],
      strategy: 'most_complete',
      orderColumn: 'id',
      emptyValues: ['NULL', '', '-'],
    },
  },
  {
    op: 'trim_text',
    params: {
      column: 'nama_peserta',
      operations: ['trim', 'collapse_spaces', 'empty_to_null'],
    },
  },
  {
    op: 'trim_text',
    params: {
      column: 'asal_instansi',
      operations: ['trim', 'collapse_spaces', 'empty_to_null', 'upper'],
    },
  },
  {
    op: 'replace_values',
    params: {
      column: 'asal_instansi',
      pairs: MINISTRY_REPLACE_PAIRS,
      ignoreCase: true,
      ignoreTrim: true,
    },
  },
  {
    op: 'fuzzy_match_master',
    params: {
      sourceColumn: 'asal_instansi',
      createTarget: false,
      targetColumn: 'asal_instansi',
      masterDatabase: 'db_sipka_peserta',
      masterTable: 'master_instansi_bkn',
      masterColumn: 'nama',
      mode: 'similarity',
      algorithm: 'jaro_winkler',
      threshold: 0.9,
      normalization: ['lowercase', 'trim', 'collapse_spaces'],
      routeUnmatched: false,
    },
  },
]

export const QUICK_PRESETS: QuickPresetDefinition[] = [
  {
    id: 'sipka_peserta',
    label: 'SIPKA Peserta',
    recipeName: 'SIPKA Peserta',
    buildSteps: () => structuredClone(SIPKA_PESERTA_STEPS),
  },
  {
    id: 'sipka_2015',
    label: 'SIPKA 2015',
    recipeName: 'SIPKA 2015',
    buildSteps: () => structuredClone(SIPKA_2015_STEPS),
  },
  {
    id: 'smartbangkom_peserta',
    label: 'Smartbangkom Peserta',
    recipeName: 'Smartbangkom Peserta',
    buildSteps: () => structuredClone(SMARTBANGKOM_PESERTA_STEPS),
  },
  {
    id: 'standardisasi_umum',
    label: 'Standardisasi Umum',
    recipeName: 'Standardisasi Umum',
    buildSteps: (columns) => {
      const steps: PresetStepTemplate[] = []
      const firstColumn = columns[0]?.name
      if (firstColumn) {
        steps.push({
          op: 'deduplicate',
          params: {
            keyColumns: [firstColumn],
            strategy: 'most_complete',
            emptyValues: ['NULL', '', '-'],
          },
        })
      }
      const textCols = columns.filter(isPresetTextColumn).slice(0, 49)
      for (const col of textCols) {
        steps.push({
          op: 'trim_text',
          params: {
            column: col.name,
            operations: ['trim', 'collapse_spaces', 'empty_to_null'],
          },
        })
      }
      return steps
    },
  },
]

export function filterCompatiblePresetSteps(
  rawSteps: PresetStepTemplate[],
  activeColumns: PresetColumn[],
  getOpLabel: (op: string) => string,
): {
  compatibleSteps: PresetStepTemplate[]
  skippedCount: number
  skippedDetails: string[]
} {
  const colMap = new Map<string, PresetColumn>(activeColumns.map((col) => [col.name, col]))
  const extractCreated = new Set<string>()
  const compatibleSteps: PresetStepTemplate[] = []
  const skippedDetails: string[] = []
  let skippedCount = 0

  const hasCol = (name: unknown): name is string => typeof name === 'string' && colMap.has(name)
  const isTextCol = (name: unknown): name is string => {
    if (!hasCol(name)) return false
    const col = colMap.get(name)
    return Boolean(col && isPresetTextColumn(col))
  }

  for (const rawStep of rawSteps) {
    const op = rawStep.op
    const opLabel = getOpLabel(op)
    const params = { ...(rawStep.params ?? {}) }

    if (op === 'deduplicate') {
      const keyCols = Array.isArray(params.keyColumns) ? params.keyColumns : []
      const missingKeys = keyCols.filter((col) => !hasCol(col))
      if (keyCols.length === 0 || missingKeys.length > 0) {
        skippedCount += 1
        skippedDetails.push(`${opLabel}: kolom kunci (${missingKeys.join(', ') || '-'}) tidak ada di tabel aktif.`)
        continue
      }
      const orderCol = typeof params.orderColumn === 'string' ? params.orderColumn : ''
      if (orderCol && !hasCol(orderCol)) {
        if (params.strategy === 'most_complete') {
          delete params.orderColumn
        } else {
          skippedCount += 1
          skippedDetails.push(`${opLabel}: kolom pengurut (${orderCol}) tidak ada di tabel aktif.`)
          continue
        }
      }
      compatibleSteps.push({ op, params })
      continue
    }

    if (op === 'trim_text' || op === 'replace_values') {
      const column = params.column
      if (!hasCol(column)) {
        skippedCount += 1
        skippedDetails.push(`${opLabel} (${String(column ?? '')}): kolom tidak ada di tabel aktif.`)
        continue
      }
      if (!isTextCol(column)) {
        skippedCount += 1
        skippedDetails.push(`${opLabel} (${column}): kolom bukan bertipe teks.`)
        continue
      }
      compatibleSteps.push({ op, params })
      continue
    }

    if (op === 'extract_and_route') {
      const src = params.sourceColumn
      if (!isTextCol(src)) {
        skippedCount += 1
        skippedDetails.push(`${opLabel}: kolom sumber ${String(src ?? '')} tidak tersedia atau bukan teks.`)
        continue
      }
      if (params.createTarget === true) {
        const newName = typeof params.newTargetName === 'string' ? params.newTargetName.trim() : ''
        if (!newName) {
          skippedCount += 1
          skippedDetails.push(`${opLabel}: nama kolom target baru kosong.`)
          continue
        }
        if (colMap.has(newName) && !extractCreated.has(newName)) {
          if (isTextCol(newName) && newName !== src) {
            compatibleSteps.push({
              op,
              params: { ...params, createTarget: false, targetColumn: newName, newTargetName: '' },
            })
          } else {
            skippedCount += 1
            skippedDetails.push(`${opLabel}: kolom target ${newName} sudah ada dan tidak kompatibel.`)
          }
          continue
        }
        colMap.set(newName, { name: newName, type: 'Nullable(String)' })
        extractCreated.add(newName)
        compatibleSteps.push({ op, params })
        continue
      }
      const tgt = params.targetColumn
      if (!isTextCol(tgt) || src === tgt) {
        skippedCount += 1
        skippedDetails.push(`${opLabel} (${src} -> ${String(tgt ?? '')}): kolom tujuan tidak tersedia atau bukan teks.`)
        continue
      }
      compatibleSteps.push({ op, params })
      continue
    }

    if (op === 'conditional_rule') {
      const rules = Array.isArray(params.rules) ? params.rules as Array<Record<string, unknown>> : []
      const validRules: Array<Record<string, unknown>> = []
      const missingRefs = new Set<string>()

      for (const rule of rules) {
        const target = rule.targetColumn
        if (!hasCol(target)) {
          if (typeof target === 'string' && target) missingRefs.add(target)
          continue
        }
        if (rule.action === 'copy_column' && !hasCol(rule.sourceColumn)) {
          if (typeof rule.sourceColumn === 'string' && rule.sourceColumn) missingRefs.add(rule.sourceColumn)
          continue
        }
        const conditions = Array.isArray(rule.conditions) ? rule.conditions as Array<Record<string, unknown>> : []
        let conditionsValid = conditions.length > 0
        for (const cond of conditions) {
          const condCol = cond.column
          if (!hasCol(condCol)) {
            if (typeof condCol === 'string' && condCol) missingRefs.add(condCol)
            conditionsValid = false
            break
          }
          if ((cond.operator === 'contains' || cond.operator === 'starts_with') && !isTextCol(condCol)) {
            missingRefs.add(condCol)
            conditionsValid = false
            break
          }
        }
        if (conditionsValid) validRules.push(rule)
      }

      if (validRules.length === 0) {
        skippedCount += 1
        skippedDetails.push(`${opLabel}: kolom (${[...missingRefs].join(', ') || '-'}) tidak ada di tabel aktif.`)
        continue
      }
      if (validRules.length < rules.length) {
        skippedDetails.push(`${opLabel}: sebagian aturan dilewati karena kolom (${[...missingRefs].join(', ')}) tidak ada.`)
      }
      compatibleSteps.push({ op, params: { ...params, rules: validRules } })
      continue
    }

    if (op === 'fuzzy_match_master') {
      const src = params.sourceColumn
      if (!isTextCol(src)) {
        skippedCount += 1
        skippedDetails.push(`${opLabel}: kolom sumber ${String(src ?? '')} tidak tersedia atau bukan teks.`)
        continue
      }
      if (params.createTarget !== true && params.targetColumn && !isTextCol(params.targetColumn)) {
        skippedCount += 1
        skippedDetails.push(`${opLabel}: kolom hasil ${String(params.targetColumn)} tidak tersedia atau bukan teks.`)
        continue
      }
      if (params.routeUnmatched === true) {
        const unmatched = params.unmatchedColumn
        const effectiveTarget = params.createTarget === true ? params.newTargetName : (params.targetColumn || src)
        if (!isTextCol(unmatched) || unmatched === effectiveTarget) {
          params.routeUnmatched = false
          delete params.unmatchedColumn
          skippedDetails.push(`${opLabel}: rute nilai tidak cocok ke ${String(unmatched ?? '')} dinonaktifkan karena kolom tidak ada.`)
        }
      }
      if (params.createTarget === true && typeof params.newTargetName === 'string' && params.newTargetName.trim()) {
        colMap.set(params.newTargetName.trim(), { name: params.newTargetName.trim(), type: 'Nullable(String)' })
      }
      compatibleSteps.push({ op, params })
      continue
    }

    if (op === 'fill_from_master') {
      const src = params.sourceColumn
      const tgt = params.targetColumn
      if (!isTextCol(src) || !isTextCol(tgt) || src === tgt) {
        skippedCount += 1
        skippedDetails.push(`${opLabel} (${String(src ?? '')} -> ${String(tgt ?? '')}): kolom tidak ada di tabel aktif atau bukan teks.`)
        continue
      }
      compatibleSteps.push({ op, params })
      continue
    }

    compatibleSteps.push({ op, params })
  }

  return { compatibleSteps, skippedCount, skippedDetails }
}
