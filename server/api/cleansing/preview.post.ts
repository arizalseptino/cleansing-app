import { findCleansingFeature } from '../../features'

export default defineEventHandler(async (event) => {
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Isi permintaan tidak valid',
      message: 'Permintaan pratinjau harus berisi JSON yang valid.',
    })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Permintaan pratinjau tidak valid',
      message: 'Isi permintaan harus berupa objek fitur dan parameter.',
    })
  }

  const { featureId, parameters } = body as { featureId?: unknown; parameters?: unknown }
  if (typeof featureId !== 'string' || !featureId.trim()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Fitur wajib dipilih',
      message: 'Pilih fitur cleansing yang ingin dipratinjau.',
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
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Parameter fitur tidak valid',
      message: 'Parameter untuk fitur cleansing wajib dikirim sebagai objek.',
    })
  }

  return feature.preview(useClickHouse(), parameters as Record<string, unknown>)
})
