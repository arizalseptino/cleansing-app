import {
  quoteIdentifier,
  validateDatabase,
  validateTable,
  validateTextColumn,
} from '../../features/metadata'
import type { OperationContext, OperationDefinition } from '../types'
import { buildInputSql, ensureTextColumn, normalizeColumnName } from '../utils'

/**
 * Batas maksimum kombinasi perbandingan nilai unik (sumber × master).
 * Server ClickHouse lokal berjalan di filesystem Linux asli (ext4) dengan ClickHouse LTS v26.8.40.8,
 * sehingga cross-join string pendek skala menengah (mis. ~53.000 sumber × 654 master = ~34,6 juta kombinasi)
 * dapat dieksekusi dengan aman dan cepat tanpa kendala memori atau I/O mount NTFS.
 */
export const MAX_FUZZY_PAIR_COMPARISONS = 100_000_000
export const FUZZY_MODES = ['similarity', 'keyword'] as const
export const FUZZY_ALGORITHMS = ['jaro_winkler', 'edit_distance'] as const
export const FUZZY_NORMALIZATIONS = ['lowercase', 'trim', 'collapse_spaces', 'remove_punctuation'] as const

export type FuzzyMode = (typeof FUZZY_MODES)[number]
export type FuzzyAlgorithm = (typeof FUZZY_ALGORITHMS)[number]
export type FuzzyNormalization = (typeof FUZZY_NORMALIZATIONS)[number]

export type ParsedFuzzyParams = {
  sourceColumn: string
  targetColumn: string
  createTarget: boolean
  masterDatabase: string
  masterTable: string
  masterColumn: string
  mode: FuzzyMode
  algorithm: FuzzyAlgorithm
  threshold: number
  normalizations: FuzzyNormalization[]
  routeUnmatched: boolean
  unmatchedColumn: string
}

function fail(message: string, statusCode = 400): never {
  throw createError({
    statusCode,
    statusMessage: 'Parameter pencocokan master tidak valid',
    message,
  })
}

function baseType(type: string): string {
  let value = type.trim()
  while (/^(Nullable|LowCardinality)\(/.test(value)) {
    value = value.slice(value.indexOf('(') + 1, -1)
  }
  return value || 'String'
}

function typeLiteral(type: string): string {
  return `'${type.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function allocateAlias(base: string, used: Set<string>): string {
  let name = base
  let suffix = 1
  while (used.has(name)) {
    name = `${base}_${suffix}`
    suffix += 1
  }
  used.add(name)
  return name
}

export function buildNormalizedTextExpr(
  rawExpr: string,
  mode: FuzzyMode,
  normalizations: FuzzyNormalization[],
): string {
  let expr = `ifNull(toString(${rawExpr}), '')`
  if (mode === 'keyword') {
    return `lowerUTF8(trimBoth(${expr}))`
  }
  const normSet = new Set(normalizations)
  if (normSet.has('lowercase')) {
    expr = `lowerUTF8(${expr})`
  }
  if (normSet.has('remove_punctuation')) {
    expr = `replaceRegexpAll(${expr}, '\\p{P}+', '')`
  }
  if (normSet.has('collapse_spaces')) {
    expr = `replaceRegexpAll(${expr}, '\\s+', ' ')`
  }
  if (normSet.has('trim')) {
    expr = `trimBoth(${expr})`
  }
  return expr
}

export function buildSimilarityScoreExpr(
  leftExpr: string,
  rightExpr: string,
  algorithm: FuzzyAlgorithm,
): string {
  if (algorithm === 'edit_distance') {
    return `(toFloat64(1) - (toFloat64(editDistanceUTF8(${leftExpr}, ${rightExpr})) / toFloat64(greatest(lengthUTF8(${leftExpr}), lengthUTF8(${rightExpr}), 1))))`
  }
  return `toFloat64(jaroWinklerSimilarity(${leftExpr}, ${rightExpr}))`
}

export function checkFuzzyPairBudget(
  uniqueSourceCount: number,
  uniqueMasterCount: number,
  limit = MAX_FUZZY_PAIR_COMPARISONS,
): void {
  const totalPairs = uniqueSourceCount * uniqueMasterCount
  if (!Number.isFinite(totalPairs) || totalPairs > limit) {
    const formattedSrc = new Intl.NumberFormat('id-ID').format(uniqueSourceCount)
    const formattedMaster = new Intl.NumberFormat('id-ID').format(uniqueMasterCount)
    const formattedLimit = new Intl.NumberFormat('id-ID').format(limit)
    fail(
      `Jumlah kombinasi perbandingan nilai unik (${formattedSrc} nilai unik sumber × ${formattedMaster} nilai unik master) melebihi batas aman ${formattedLimit}. Kurangi data terlebih dahulu dengan menghapus duplikat, menyaring baris, atau merapikan teks sebelum menjalankan pencocokan.`,
    )
  }
}

export function parseFuzzyParams(
  context: Pick<OperationContext, 'schema' | 'params'>,
): ParsedFuzzyParams {
  if (typeof context.params.sourceColumn !== 'string' || !context.params.sourceColumn.trim()) {
    fail('Pilih kolom sumber teks yang akan disamakan.')
  }
  const sourceColumn = ensureTextColumn(context.schema, context.params.sourceColumn, 'kolom sumber teks')

  if (context.params.createTarget !== undefined && typeof context.params.createTarget !== 'boolean') {
    fail('Pilihan membuat kolom hasil baru tidak valid.')
  }
  const createTarget = context.params.createTarget === true

  let targetColumn = sourceColumn
  if (createTarget) {
    const newName = normalizeColumnName(context.params.newTargetName)
    if (context.schema.some((col) => col.name === newName)) {
      fail(`Nama kolom hasil baru "${newName}" sudah digunakan pada skema tabel.`, 409)
    }
    targetColumn = newName
  } else if (context.params.targetColumn !== undefined && context.params.targetColumn !== null && context.params.targetColumn !== '') {
    if (typeof context.params.targetColumn !== 'string') {
      fail('Kolom hasil harus berupa nama kolom teks yang valid.')
    }
    targetColumn = ensureTextColumn(context.schema, context.params.targetColumn, 'kolom hasil')
  }

  const masterDatabase = typeof context.params.masterDatabase === 'string' ? context.params.masterDatabase.trim() : ''
  const masterTable = typeof context.params.masterTable === 'string' ? context.params.masterTable.trim() : ''
  const masterColumn = typeof context.params.masterColumn === 'string' ? context.params.masterColumn.trim() : ''
  if (!masterDatabase) fail('Database master wajib dipilih.')
  if (!masterTable) fail('Tabel master wajib dipilih.')
  if (!masterColumn) fail('Kolom nama pada tabel master wajib dipilih.')

  const rawMode = context.params.mode === undefined || context.params.mode === '' ? 'similarity' : context.params.mode
  if (typeof rawMode !== 'string' || !FUZZY_MODES.includes(rawMode as FuzzyMode)) {
    fail('Mode pencocokan harus berupa "similarity" (kemiripan) atau "keyword" (kata kunci).')
  }
  const mode = rawMode as FuzzyMode

  const rawAlgorithm = context.params.algorithm === undefined || context.params.algorithm === '' ? 'jaro_winkler' : context.params.algorithm
  if (typeof rawAlgorithm !== 'string' || !FUZZY_ALGORITHMS.includes(rawAlgorithm as FuzzyAlgorithm)) {
    fail('Algoritma kemiripan harus berupa "jaro_winkler" atau "edit_distance".')
  }
  const algorithm = rawAlgorithm as FuzzyAlgorithm

  let threshold = 0.9
  if (mode === 'similarity' && context.params.threshold !== undefined && context.params.threshold !== '') {
    const num = Number(context.params.threshold)
    if (!Number.isFinite(num) || num < 0.5 || num > 1.0) {
      fail('Ambang kemiripan harus berupa angka antara 0,50 dan 1,00.')
    }
    threshold = num
  }

  let normalizations: FuzzyNormalization[] = ['lowercase', 'trim', 'collapse_spaces']
  if (context.params.normalization !== undefined) {
    if (!Array.isArray(context.params.normalization) || context.params.normalization.some((item) => typeof item !== 'string')) {
      fail('Opsi normalisasi harus berupa daftar teks yang valid.')
    }
    const invalid = context.params.normalization.find((item) => !FUZZY_NORMALIZATIONS.includes(item as FuzzyNormalization))
    if (invalid) {
      fail(`Opsi normalisasi "${String(invalid)}" tidak dikenal.`)
    }
    normalizations = [...new Set(context.params.normalization as FuzzyNormalization[])]
  }

  if (context.params.routeUnmatched !== undefined && typeof context.params.routeUnmatched !== 'boolean') {
    fail('Opsi rutekan yang tidak cocok harus berupa ya atau tidak.')
  }
  const routeUnmatched = context.params.routeUnmatched === true

  let unmatchedColumn = ''
  if (routeUnmatched) {
    if (typeof context.params.unmatchedColumn !== 'string' || !context.params.unmatchedColumn.trim()) {
      fail('Pilih kolom sekunder untuk menampung nilai yang tidak cocok.')
    }
    unmatchedColumn = ensureTextColumn(context.schema, context.params.unmatchedColumn, 'kolom tujuan nilai tidak cocok')
    if (unmatchedColumn === targetColumn) {
      fail('Kolom tujuan nilai tidak cocok harus berbeda dari kolom hasil.')
    }
  }

  return {
    sourceColumn,
    targetColumn,
    createTarget,
    masterDatabase,
    masterTable,
    masterColumn,
    mode,
    algorithm,
    threshold,
    normalizations,
    routeUnmatched,
    unmatchedColumn,
  }
}

export function buildFuzzyMappingSql(options: {
  inputSql: string
  sourceColumn: string
  masterIdentifier: string
  masterFinal: string
  masterColumn: string
  mode: FuzzyMode
  algorithm: FuzzyAlgorithm
  normalizations: FuzzyNormalization[]
  thresholdParamName: string
  aliases: {
    sNorm: string
    master: string
    status: string
    score: string
  }
}): string {
  const srcField = quoteIdentifier(options.sourceColumn)
  const masterField = quoteIdentifier(options.masterColumn)
  const srcNormExpr = buildNormalizedTextExpr(srcField, options.mode, options.normalizations)
  const masterNormExpr = buildNormalizedTextExpr(`assumeNotNull(${masterField})`, options.mode, options.normalizations)
  const srcNonEmpty = `(${srcField} IS NOT NULL AND trimBoth(ifNull(toString(${srcField}), '')) != '' AND ${srcNormExpr} != '')`
  const masterNonEmpty = `(${masterField} IS NOT NULL AND trimBoth(toString(assumeNotNull(${masterField}))) != '' AND ${masterNormExpr} != '')`

  const uniqueSourceSubquery = `
    SELECT DISTINCT ${srcNormExpr} AS s_norm
    FROM ${options.inputSql}
    WHERE ${srcNonEmpty}
  `
  const uniqueMasterSubquery = `
    SELECT DISTINCT
      toString(assumeNotNull(${masterField})) AS m_orig,
      ${masterNormExpr} AS m_norm,
      lengthUTF8(trimBoth(toString(assumeNotNull(${masterField})))) AS m_len
    FROM ${options.masterIdentifier}${options.masterFinal}
    WHERE ${masterNonEmpty}
  `

  let pairScoreExpr: string
  let pairFilterClause: string
  if (options.mode === 'keyword') {
    pairScoreExpr = `if(
      src_u.s_norm = mst_u.m_norm,
      toFloat64(1),
      least(toFloat64(mst_u.m_len) / toFloat64(greatest(lengthUTF8(src_u.s_norm), 1)), toFloat64(0.999999))
    )`
    pairFilterClause = 'WHERE src_u.s_norm = mst_u.m_norm OR position(src_u.s_norm, mst_u.m_norm) > 0'
  } else {
    const simExpr = buildSimilarityScoreExpr('src_u.s_norm', 'mst_u.m_norm', options.algorithm)
    pairScoreExpr = `if(
      src_u.s_norm = mst_u.m_norm,
      toFloat64(1),
      least(${simExpr}, toFloat64(0.999999))
    )`
    pairFilterClause = `WHERE pair_exact = 1 OR pair_score >= {${options.thresholdParamName}:Float64}`
  }

  return `
    SELECT
      u_src.s_norm AS ${quoteIdentifier(options.aliases.sNorm)},
      if(ifNull(matched_u.best_cnt, 0) = 1, ifNull(matched_u.first_master, ''), '') AS ${quoteIdentifier(options.aliases.master)},
      multiIf(
        ifNull(matched_u.best_cnt, 0) = 0, 'unmatched',
        ifNull(matched_u.best_cnt, 0) > 1, 'ambiguous',
        ifNull(matched_u.best_exact, 0) = 1, 'exact',
        'fuzzy'
      ) AS ${quoteIdentifier(options.aliases.status)},
      ifNull(matched_u.best_score, toFloat64(0)) AS ${quoteIdentifier(options.aliases.score)}
    FROM (${uniqueSourceSubquery}) AS u_src
    LEFT JOIN (
      SELECT
        s_norm,
        best_exact,
        best_score,
        length(best_masters) AS best_cnt,
        arrayElement(best_masters, 1) AS first_master
      FROM (
        SELECT
          s_norm,
          best_exact,
          best_score,
          arrayDistinct(
            arrayMap(
              x -> tupleElement(x, 3),
              arrayFilter(
                x -> tupleElement(x, 1) = best_exact AND tupleElement(x, 2) = best_score,
                all_pairs
              )
            )
          ) AS best_masters
        FROM (
          SELECT
            s_norm,
            max(pair_exact) AS best_exact,
            max(pair_score) AS best_score,
            groupUniqArray((pair_exact, pair_score, m_orig)) AS all_pairs
          FROM (
            SELECT
              src_u.s_norm AS s_norm,
              mst_u.m_orig AS m_orig,
              if(src_u.s_norm = mst_u.m_norm, toUInt8(1), toUInt8(0)) AS pair_exact,
              ${pairScoreExpr} AS pair_score
            FROM (${uniqueSourceSubquery}) AS src_u
            CROSS JOIN (${uniqueMasterSubquery}) AS mst_u
            ${options.mode === 'keyword' ? pairFilterClause : ''}
          )
          ${options.mode === 'similarity' ? pairFilterClause : ''}
          GROUP BY s_norm
        )
      )
    ) AS matched_u
    ON u_src.s_norm = matched_u.s_norm
  `
}

const fuzzyMatchMaster: OperationDefinition = {
  id: 'fuzzy_match_master',
  name: 'Samakan nilai dengan tabel master',
  description: 'Menyamakan nilai kolom teks terhadap nilai unik tabel master dengan mode kata kunci atau kemiripan teks.',
  params: [
    {
      key: 'sourceColumn',
      label: 'Kolom sumber teks',
      description: 'Kolom teks yang nilainya akan disamakan dengan tabel master.',
      type: 'column',
      required: true,
    },
    {
      key: 'targetColumn',
      label: 'Kolom hasil',
      description: 'Kolom tujuan hasil pencocokan (bawaan: kolom sumber yang sama). Boleh kolom teks lain atau kolom baru.',
      type: 'column',
      required: false,
      allowNew: true,
    },
    {
      key: 'newTargetName',
      label: 'Nama kolom hasil baru',
      description: 'Nama kolom baru jika memilih membuat kolom hasil baru.',
      type: 'text',
      required: false,
    },
    {
      key: 'masterDatabase',
      label: 'Database master',
      description: 'Database yang menyimpan tabel master referensi.',
      type: 'table-ref',
      required: true,
    },
    {
      key: 'masterTable',
      label: 'Tabel master',
      description: 'Tabel master yang berisi daftar nilai acuan.',
      type: 'table-ref',
      required: true,
    },
    {
      key: 'masterColumn',
      label: 'Kolom nama master',
      description: 'Kolom teks pada tabel master yang dijadikan acuan. Nilai NULL atau kosong diabaikan.',
      type: 'column',
      required: true,
    },
    {
      key: 'mode',
      label: 'Mode pencocokan',
      description: 'Pilih pencocokan kemiripan teks atau kata kunci (potongan teks terpanjang menang).',
      type: 'select',
      required: true,
      defaultValue: 'similarity',
      options: ['similarity', 'keyword'],
    },
    {
      key: 'algorithm',
      label: 'Algoritma kemiripan',
      description: 'Jaro-Winkler cocok untuk variasi ejaan/awalan; jarak edit ternormalisasi mengukur selisih karakter.',
      type: 'select',
      required: false,
      defaultValue: 'jaro_winkler',
      options: ['jaro_winkler', 'edit_distance'],
    },
    {
      key: 'threshold',
      label: 'Ambang kemiripan',
      description: 'Nilai minimum kemiripan dari 0,50 sampai 1,00 (bawaan 0,90). Nilai 1,00 hanya menerima cocok persis.',
      type: 'number',
      required: false,
      defaultValue: 0.9,
      min: 0.5,
      max: 1.0,
      step: 0.01,
    },
    {
      key: 'normalization',
      label: 'Normalisasi sebelum membandingkan',
      description: 'Standarisasi sementara hanya untuk perbandingan; nilai master tetap dikembalikan dalam bentuk aslinya.',
      type: 'multiselect',
      required: false,
      defaultValue: ['lowercase', 'trim', 'collapse_spaces'],
      options: ['lowercase', 'trim', 'collapse_spaces', 'remove_punctuation'],
    },
    {
      key: 'routeUnmatched',
      label: 'Rutekan yang tidak cocok',
      description: 'Jika nilai tidak cocok, pindahkan nilai asli ke kolom sekunder (hanya jika kosong) dan kosongkan kolom hasil.',
      type: 'boolean',
      required: false,
      defaultValue: false,
    },
    {
      key: 'unmatchedColumn',
      label: 'Kolom tujuan nilai tidak cocok',
      description: 'Kolom teks sekunder untuk menampung nilai yang tidak cocok (nilai ambigu tidak dipindahkan).',
      type: 'column',
      required: false,
    },
  ],

  async validate(context) {
    const parsed = parseFuzzyParams(context)

    await validateDatabase(context.client, parsed.masterDatabase)
    const masterMeta = await validateTable(context.client, parsed.masterDatabase, parsed.masterTable)
    await validateTextColumn(
      context.client,
      parsed.masterDatabase,
      parsed.masterTable,
      parsed.masterColumn,
      'nama master',
    )

    const inputSql = context.inputSql ?? buildInputSql(context.source)
    const inputParams = context.inputParams ?? {}
    const srcField = quoteIdentifier(parsed.sourceColumn)
    const srcNormExpr = buildNormalizedTextExpr(srcField, parsed.mode, parsed.normalizations)
    const srcNonEmpty = `(${srcField} IS NOT NULL AND trimBoth(ifNull(toString(${srcField}), '')) != '' AND ${srcNormExpr} != '')`

    const masterIdentifier = `${quoteIdentifier(parsed.masterDatabase)}.${quoteIdentifier(parsed.masterTable)}`
    const masterFinal = /^(?:Replicated)?ReplacingMergeTree$/.test(masterMeta.engine) ? ' FINAL' : ''
    const masterField = quoteIdentifier(parsed.masterColumn)
    const masterNormExpr = buildNormalizedTextExpr(`assumeNotNull(${masterField})`, parsed.mode, parsed.normalizations)
    const masterNonEmpty = `(${masterField} IS NOT NULL AND trimBoth(toString(assumeNotNull(${masterField}))) != '' AND ${masterNormExpr} != '')`

    const [srcCountRes, mstCountRes] = await Promise.all([
      context.client.query({
        query: `SELECT uniqExact(${srcNormExpr}) AS total FROM (${inputSql}) WHERE ${srcNonEmpty}`,
        query_params: inputParams,
        format: 'JSONEachRow',
        clickhouse_settings: { readonly: 1, max_execution_time: 60 },
      }),
      context.client.query({
        query: `SELECT uniqExact(toString(assumeNotNull(${masterField}))) AS total FROM ${masterIdentifier}${masterFinal} WHERE ${masterNonEmpty}`,
        format: 'JSONEachRow',
        clickhouse_settings: { readonly: 1, max_execution_time: 30 },
      }),
    ])

    const [srcCountRow] = await srcCountRes.json<{ total: number | string }[]>()
    const [mstCountRow] = await mstCountRes.json<{ total: number | string }[]>()
    const uniqueSourceCount = Number(srcCountRow?.total ?? 0)
    const uniqueMasterCount = Number(mstCountRow?.total ?? 0)

    checkFuzzyPairBudget(uniqueSourceCount, uniqueMasterCount)
  },

  async compile(context) {
    const parsed = parseFuzzyParams(context)
    const masterMeta = await validateTable(context.client, parsed.masterDatabase, parsed.masterTable)
    const masterIdentifier = `${quoteIdentifier(parsed.masterDatabase)}.${quoteIdentifier(parsed.masterTable)}`
    const masterFinal = /^(?:Replicated)?ReplacingMergeTree$/.test(masterMeta.engine) ? ' FINAL' : ''

    const usedAliases = new Set(context.schema.map((c) => c.name))
    const keyAlias = allocateAlias('__wb_fuzz_key', usedAliases)
    const origSrcAlias = allocateAlias('__wb_fuzz_orig_src', usedAliases)
    const normAlias = allocateAlias('__wb_fuzz_s_norm', usedAliases)
    const masterAlias = allocateAlias('__wb_fuzz_master', usedAliases)
    const statusAlias = allocateAlias('__wb_fuzz_status', usedAliases)
    const scoreAlias = allocateAlias('__wb_fuzz_score', usedAliases)

    const mappingSql = buildFuzzyMappingSql({
      inputSql: '__INPUT__',
      sourceColumn: parsed.sourceColumn,
      masterIdentifier,
      masterFinal,
      masterColumn: parsed.masterColumn,
      mode: parsed.mode,
      algorithm: parsed.algorithm,
      normalizations: parsed.normalizations,
      thresholdParamName: 'threshold',
      aliases: {
        sNorm: normAlias,
        master: masterAlias,
        status: statusAlias,
        score: scoreAlias,
      },
    })

    const srcQuoted = quoteIdentifier(parsed.sourceColumn)
    const targetQuoted = quoteIdentifier(parsed.targetColumn)
    const keyQuoted = quoteIdentifier(keyAlias)
    const origSrcQuoted = quoteIdentifier(origSrcAlias)
    const normQuoted = quoteIdentifier(normAlias)
    const masterValQuoted = quoteIdentifier(masterAlias)
    const statusQuoted = quoteIdentifier(statusAlias)
    const scoreQuoted = quoteIdentifier(scoreAlias)

    const srcNormExpr = buildNormalizedTextExpr(srcQuoted, parsed.mode, parsed.normalizations)
    const matchedCond = `(ifNull(${statusQuoted}, '') IN ('exact', 'fuzzy'))`

    const sourceType = context.schema.find((c) => c.name === parsed.sourceColumn)?.type ?? 'String'
    const targetType = parsed.createTarget
      ? sourceType
      : (context.schema.find((c) => c.name === parsed.targetColumn)?.type ?? 'String')

    const fallbackTargetExpr = parsed.createTarget ? origSrcQuoted : targetQuoted
    let resultExpr: string

    const replacements: string[] = []
    if (parsed.routeUnmatched) {
      const unmatchedQuoted = quoteIdentifier(parsed.unmatchedColumn)
      const unmatchedEmpty = `(isNull(${unmatchedQuoted}) OR trimBoth(ifNull(toString(${unmatchedQuoted}), '')) = '')`
      const routeCond = `(ifNull(${statusQuoted}, '') = 'unmatched' AND ${unmatchedEmpty})`
      const nullLiteral = `CAST(NULL, ${typeLiteral(`Nullable(${baseType(targetType)})`)})`
      resultExpr = `multiIf(${matchedCond}, ifNull(${masterValQuoted}, ''), ${routeCond}, ${nullLiteral}, ${fallbackTargetExpr})`
      const unmatchedExpr = `if(${routeCond}, ${origSrcQuoted}, ${unmatchedQuoted})`
      replacements.push(`${unmatchedExpr} AS ${unmatchedQuoted}`)
    } else {
      resultExpr = `if(${matchedCond}, ifNull(${masterValQuoted}, ''), ${fallbackTargetExpr})`
    }

    if (!parsed.createTarget) {
      replacements.unshift(`${resultExpr} AS ${targetQuoted}`)
    }

    const exceptColumns = [keyQuoted, origSrcQuoted, normQuoted, masterValQuoted, statusQuoted, scoreQuoted].join(', ')
    const replaceClause = replacements.length ? ` REPLACE (${replacements.join(', ')})` : ''
    const addClause = parsed.createTarget ? `, ${resultExpr} AS ${targetQuoted}` : ''

    const sql = `
      SELECT * EXCEPT (${exceptColumns})${replaceClause}${addClause}
      FROM (
        SELECT *, ${srcNormExpr} AS ${keyQuoted}, ${srcQuoted} AS ${origSrcQuoted}
        FROM __INPUT__
      ) AS __wb_fuzz_src
      LEFT JOIN (${mappingSql}) AS __wb_fuzz_map
      ON __wb_fuzz_src.${keyQuoted} = __wb_fuzz_map.${normQuoted}
    `

    const params: Record<string, unknown> = {}
    if (parsed.mode === 'similarity') {
      params.threshold = parsed.threshold
    }

    const touchedColumns = parsed.createTarget
      ? (parsed.routeUnmatched ? [parsed.unmatchedColumn] : [])
      : [...new Set([parsed.targetColumn, ...(parsed.routeUnmatched ? [parsed.unmatchedColumn] : [])])]
    const addedColumns = parsed.createTarget ? [parsed.targetColumn] : []
    const beforeColumns = [...touchedColumns]

    return {
      sql,
      params,
      touchedColumns,
      addedColumns,
      beforeColumns,
    }
  },
}

export default fuzzyMatchMaster
