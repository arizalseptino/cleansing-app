import { createSaveTableJob, updateSaveTableJob } from '../../workbench/save-jobs'
import {
  executeStagedSaveTable,
  messageFromSaveError,
  parseSaveTableRequest,
} from '../../workbench/save-table-runner'

export default defineEventHandler(async (event) => {
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: 'Payload tidak valid',
      message: 'Body harus berupa JSON yang valid.',
    })
  }

  const parsed = parseSaveTableRequest(body)
  const client = useClickHouse()
  const job = createSaveTableJob(parsed.pipeline.steps.length)

  void (async () => {
    try {
      const result = await executeStagedSaveTable(client, job.jobId, parsed, (progress) => {
        updateSaveTableJob(job.jobId, {
          status: 'running',
          currentStep: progress.currentStep,
          totalSteps: progress.totalSteps,
          message: progress.message,
        })
      })
      updateSaveTableJob(job.jobId, {
        status: 'done',
        currentStep: parsed.pipeline.steps.length,
        totalSteps: parsed.pipeline.steps.length,
        message: 'Tabel hasil berhasil dibuat.',
        result,
      })
    } catch (error) {
      updateSaveTableJob(job.jobId, {
        status: 'error',
        message: messageFromSaveError(error),
        error: messageFromSaveError(error),
      })
    }
  })()

  return {
    jobId: job.jobId,
    status: job.status,
    currentStep: job.currentStep,
    totalSteps: job.totalSteps,
    message: job.message,
  }
})
