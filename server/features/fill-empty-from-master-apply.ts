import type { useClickHouse } from '../utils/clickhouse'
import {
  quoteIdentifier,
  validateTextColumn,
} from './metadata'
import {
  buildFillEmptyPlan,
  getFillEmptyStatistics,
} from './fill-empty-from-master-query'
import type { FeatureApplySummary } from './types'

const applySettings = { max_execution_time: 300 }
const verifySettings = { readonly: 1, max_execution_time: 60 }

function badRequest(message: string): never {
  throw createError({ statusCode: 400, statusMessage: message, message })
}

function conflict(message: string): never {
  throw createError({ statusCode: 409, statusMessage: message, message })
}

function isHttpError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'statusCode' in error
    && typeof error.statusCode === 'number',
  )
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 320) : ''
}

function numberValue(value: number | string | undefined, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Verifikasi hasil tidak valid',
      message: `ClickHouse mengembalikan ${label} yang tidak valid.`,
    })
  }
  return parsed
}

export async function applyFillEmptyFromMasterText(
  client: ReturnType<typeof useClickHouse>,
  rawParameters: Record<string, unknown>,
  resultTableName: string,
  saveOriginal: boolean,
): Promise<FeatureApplySummary> {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(resultTableName)) {
    badRequest('Nama tabel hasil harus diawali huruf dan hanya berisi huruf, angka, atau garis bawah (maksimal 64 karakter).')
  }

  const startedAt = Date.now()
  const plan = await buildFillEmptyPlan(client, rawParameters)
  if (!plan.sourceMetadata.engine.endsWith('MergeTree')) {
    badRequest('Penerapan hanya mendukung tabel sumber dengan engine keluarga MergeTree.')
  }
  if (plan.targetDefaultKind === 'ALIAS' || plan.targetDefaultKind === 'MATERIALIZED') {
    badRequest('Kolom target dihitung otomatis oleh ClickHouse dan tidak dapat diisi langsung.')
  }

  const targetOriginalName = `${plan.targetColumn}_asli`
  if (saveOriginal && plan.sourceColumns.some(({ name }) => name === targetOriginalName)) {
    conflict('Kolom untuk menyimpan nilai lama sudah ada pada tabel sumber.')
  }

  let existingTables: { name: string }[]
  try {
    const result = await client.query({
      query: `
        SELECT name
        FROM system.tables
        WHERE database = {database:String} AND name = {table:String}
        LIMIT 1
      `,
      query_params: {
        database: plan.sourceDatabase,
        table: resultTableName,
      },
      format: 'JSONEachRow',
      clickhouse_settings: verifySettings,
    })
    existingTables = await result.json<{ name: string }[]>()
  } catch {
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal memeriksa nama tabel hasil',
      message: 'Keberadaan tabel hasil tidak dapat diperiksa melalui ClickHouse.',
    })
  }
  if (existingTables.length > 0) {
    conflict('Nama tabel hasil sudah digunakan. Pilih nama tabel lain; tabel yang ada tidak diubah.')
  }

  const expected = await getFillEmptyStatistics(client, plan, plan.sourceIdentifier, undefined, 60)
  const destinationIdentifier = `${quoteIdentifier(plan.sourceDatabase)}.${quoteIdentifier(resultTableName)}`
  const originalColumnIdentifier = quoteIdentifier(targetOriginalName)
  let createdByRequest = false

  try {
    await client.command({
      query: `CREATE TABLE ${destinationIdentifier} AS ${plan.sourceIdentifier}`,
      clickhouse_settings: applySettings,
    })
    createdByRequest = true

    if (saveOriginal) {
      await client.command({
        query: `ALTER TABLE ${destinationIdentifier} ADD COLUMN ${originalColumnIdentifier} ${plan.targetType}`,
        clickhouse_settings: applySettings,
      })
    }

    const insertableColumns = plan.sourceColumns.filter(({ default_kind }) => (
      default_kind !== 'ALIAS' && default_kind !== 'MATERIALIZED'
    ))
    const insertColumns = [
      ...insertableColumns.map(({ name }) => quoteIdentifier(name)),
      ...(saveOriginal ? [originalColumnIdentifier] : []),
    ]
    const selectedColumns = insertableColumns.map(({ name }) => {
      if (name !== plan.targetColumn) return quoteIdentifier(name)
      return `
        if(
          ${quoteIdentifier(plan.aliases.targetEmpty)}
            AND ${quoteIdentifier(plan.aliases.category)} = 'fillable',
          ${quoteIdentifier(plan.aliases.suggestion)},
          ${quoteIdentifier(name)}
        ) AS ${quoteIdentifier(name)}
      `
    })
    if (saveOriginal) {
      selectedColumns.push(
        `${quoteIdentifier(plan.aliases.targetBefore)} AS ${originalColumnIdentifier}`,
      )
    }

    await client.command({
      query: `
        INSERT INTO ${destinationIdentifier} (${insertColumns.join(', ')})
        WITH ${plan.masterValues} AS master_values
        SELECT ${selectedColumns.join(',\n          ')}
        FROM (${plan.classifyRows(plan.sourceIdentifier, quoteIdentifier(plan.targetColumn))})
      `,
      clickhouse_settings: applySettings,
    })

    const targetEmptyInResult = `(isNull(${quoteIdentifier(plan.targetColumn)}) OR trimBoth(ifNull(${quoteIdentifier(plan.targetColumn)}, '')) = '')`
    let verificationQuery: string
    if (saveOriginal) {
      const resultRows = plan.classifyRows(destinationIdentifier, originalColumnIdentifier)
      verificationQuery = `
        WITH ${plan.masterValues} AS master_values
        SELECT
          count() AS rowCount,
          countIf(
            ${quoteIdentifier(plan.aliases.category)} = 'fillable'
            AND ${quoteIdentifier(plan.targetColumn)} = ${quoteIdentifier(plan.aliases.suggestion)}
          ) AS filledRows,
          countIf(
            ${quoteIdentifier(plan.aliases.category)} = 'ambiguous'
            AND ${targetEmptyInResult}
          ) AS ambiguousRowsLeftEmpty
        FROM (${resultRows})
      `
    } else {
      verificationQuery = `
        SELECT
          count() AS rowCount,
          countIf(${targetEmptyInResult}) AS targetEmptyRows
        FROM ${destinationIdentifier}${plan.sourceFinal}
      `
    }

    const verificationResult = await client.query({
      query: verificationQuery,
      format: 'JSONEachRow',
      clickhouse_settings: verifySettings,
    })
    const [verification] = await verificationResult.json<Record<string, number | string>>()
    if (!verification) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Verifikasi hasil tidak tersedia',
        message: 'ClickHouse tidak mengembalikan hasil verifikasi.',
      })
    }
    const rowCount = numberValue(verification.rowCount, 'jumlah baris hasil')
    if (rowCount !== expected.sourceRows) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Jumlah baris hasil tidak sesuai',
        message: 'Jumlah baris tabel hasil berbeda dari jumlah baris sumber; tabel hasil akan dibersihkan.',
      })
    }

    const filledRows = saveOriginal
      ? numberValue(verification.filledRows, 'jumlah baris terisi')
      : expected.fillableRows
    const nonEmptyFillsObserved = saveOriginal
      ? filledRows
      : expected.targetEmptyRows - numberValue(verification.targetEmptyRows, 'jumlah target kosong')
    if (saveOriginal && filledRows !== expected.fillableRows) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Jumlah baris terisi tidak sesuai',
        message: 'Jumlah baris terisi berbeda dari hasil pratinjau; tabel hasil akan dibersihkan.',
      })
    }
    if (!saveOriginal && nonEmptyFillsObserved !== expected.nonEmptyFillableRows) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Jumlah baris terisi tidak sesuai',
        message: 'Jumlah nilai target yang terisi berbeda dari hasil pratinjau; tabel hasil akan dibersihkan.',
      })
    }

    const ambiguousRowsLeftEmpty = saveOriginal
      ? numberValue(verification.ambiguousRowsLeftEmpty, 'jumlah baris ambigu')
      : expected.ambiguousRows
    if (ambiguousRowsLeftEmpty !== expected.ambiguousRows) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Verifikasi baris ambigu gagal',
        message: 'Jumlah baris ambigu yang dibiarkan kosong tidak sesuai; tabel hasil akan dibersihkan.',
      })
    }

    return {
      database: plan.sourceDatabase,
      tableName: resultTableName,
      rowCount,
      filledRows,
      ambiguousRowsLeftEmpty,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    if (createdByRequest) {
      try {
        await client.command({
          query: `DROP TABLE ${destinationIdentifier}`,
          clickhouse_settings: applySettings,
        })
      } catch (cleanupError) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Penerapan dan pembersihan tabel hasil gagal',
          message: `Penerapan gagal dan tabel hasil milik permintaan ini tidak dapat dibersihkan. Detail: ${errorDetail(cleanupError) || 'kesalahan ClickHouse.'}`,
        })
      }
    }

    if (isHttpError(error)) throw error
    if (/already exists|TABLE_ALREADY_EXISTS|Code: 57/i.test(errorDetail(error))) {
      conflict('Nama tabel hasil sudah digunakan. Tabel yang sudah ada tidak diubah.')
    }
    throw createError({
      statusCode: 500,
      statusMessage: 'Gagal menerapkan cleansing',
      message: errorDetail(error)
        ? `Penerapan gagal; tabel hasil yang dibuat oleh permintaan ini telah dibersihkan. Detail ClickHouse: ${errorDetail(error)}`
        : 'Penerapan gagal; tabel hasil yang dibuat oleh permintaan ini telah dibersihkan.',
    })
  }
}

