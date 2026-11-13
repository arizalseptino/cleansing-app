import { findCleansingFeature } from '../../features'
import { recordCleansingHistory } from '../../features/cleansing-history'
import type { FeatureApplySummary } from '../../features/types'
import { useClickHouse } from '../../utils/clickhouse'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function fieldString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'Terjadi kesalahan saat menerapkan cleansing.'
}

function errorStatus(error: unknown): { statusCode: number; statusMessage: string } {
  if (error && typeof error === 'object') {
    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500
    const statusMessage = 'statusMessage' in error && typeof error.statusMessage === 'string'
      ? error.statusMessage
      : 'Penerapan cleansing gagal'
    return { statusCode, statusMessage }
  }
  return { statusCode: 500, statusMessage: 'Penerapan cleansing gagal' }
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  let featureId = ''
  let parameters: Record<string, unknown> = {}
  let sourceDatabase = ''
  let sourceTable = ''
  let resultTableName = ''
  let result: FeatureApplySummary | undefined
  let failure: unknown
  let client: ReturnType<typeof useClickHouse> | undefined

  try {
    const body: unknown = await readBody(event)
    if (!isRecord(body)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Permintaan penerapan tidak valid',
        message: 'Isi permintaan harus berupa objek fitur dan parameter.',
      })
    }

    featureId = fieldString(body.featureId)
    resultTableName = fieldString(body.resultTableName)
    if (isRecord(body.parameters)) {
      parameters = body.parameters
      sourceDatabase = fieldString(parameters.sourceDatabase)
      sourceTable = fieldString(parameters.sourceTable)
    }

    if (!featureId.trim()) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Fitur wajib dipilih',
        message: 'Pilih fitur cleansing yang ingin diterapkan.',
      })
    }
    const feature = findCleansingFeature(featureId)
    if (!feature) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Fitur tidak ditemukan',
        message: 'Fitur cleansing yang dipilih tidak tersedia.',
      })
    }
    if (!feature.apply) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Fitur belum mendukung penerapan',
        message: 'Fitur cleansing ini belum mendukung penerapan ke tabel baru.',
      })
    }
    if (!isRecord(body.parameters)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Parameter fitur tidak valid',
        message: 'Parameter untuk fitur cleansing wajib dikirim sebagai objek.',
      })
    }
    if (typeof body.resultTableName !== 'string') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nama tabel hasil wajib diisi',
        message: 'Masukkan nama tabel hasil yang baru.',
      })
    }
    if (body.saveOriginal !== undefined && typeof body.saveOriginal !== 'boolean') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Pilihan nilai lama tidak valid',
        message: 'Pilihan untuk menyimpan nilai lama harus berupa ya atau tidak.',
      })
    }

    client = useClickHouse()
    result = await feature.apply(
      client,
      parameters,
      resultTableName,
      body.saveOriginal === undefined ? true : body.saveOriginal,
    )
  } catch (error) {
    failure = error
  }

  let historyWarning: string | null
  try {
    client ??= useClickHouse()
    historyWarning = await recordCleansingHistory(client, {
      featureId,
      sourceDatabase,
      sourceTable,
      resultTable: result?.tableName ?? resultTableName,
      parameters,
      sourceRows: result?.rowCount ?? 0,
      filledRows: result?.filledRows ?? 0,
      ambiguousRows: result?.ambiguousRowsLeftEmpty ?? 0,
      durationMs: result?.durationMs ?? Date.now() - startedAt,
      status: failure ? 'gagal' : 'sukses',
      message: failure ? errorMessage(failure) : null,
      startedAt,
    })
  } catch (error) {
    console.warn('Gagal menyiapkan pencatatan riwayat penerapan cleansing.', error)
    historyWarning = 'Riwayat penerapan tidak dapat dicatat.'
  }

  if (failure) {
    if (historyWarning) {
      const { statusCode, statusMessage } = errorStatus(failure)
      throw createError({
        statusCode,
        statusMessage,
        message: `${errorMessage(failure)} ${historyWarning}`,
      })
    }
    throw failure
  }

  if (!result) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Penerapan cleansing gagal',
      message: 'Penerapan tidak menghasilkan ringkasan.',
    })
  }

  return { ...result, historyWarning }
})
