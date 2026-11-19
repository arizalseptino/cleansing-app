import { getSaveTableJob } from '../../workbench/save-jobs'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const jobId = typeof query.jobId === 'string' ? query.jobId.trim() : ''

  if (!jobId || !/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Parameter jobId tidak valid',
      message: 'Parameter query jobId wajib diisi dengan format yang valid.',
    })
  }

  const job = getSaveTableJob(jobId)
  if (!job) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Job tidak ditemukan',
      message: 'Status proses pembuatan tabel tidak ditemukan atau sudah kedaluwarsa.',
    })
  }

  return {
    jobId: job.jobId,
    status: job.status,
    currentStep: job.currentStep,
    totalSteps: job.totalSteps,
    message: job.message,
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
  }
})
