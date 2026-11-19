import { randomUUID } from 'node:crypto'

export type SaveTableResult = {
  status: 'ok'
  database: string
  table: string
  engine: 'MergeTree' | 'ReplacingMergeTree'
  rows: number
  saveOriginal: boolean
  originalColumns: string[]
  steps: number
  durationMs: number
  verification: string
}

export type SaveTableJobStatus = {
  jobId: string
  status: 'running' | 'done' | 'error'
  currentStep: number
  totalSteps: number
  message: string
  startedAt: number
  updatedAt: number
  result?: SaveTableResult
  error?: string
}

const JOB_TTL_MS = 60 * 60 * 1000
const MAX_JOBS = 100
const jobs = new Map<string, SaveTableJobStatus>()

function pruneOldJobs(): void {
  const now = Date.now()
  for (const [id, job] of jobs.entries()) {
    if (job.status !== 'running' && now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id)
    }
  }
  if (jobs.size > MAX_JOBS) {
    const sorted = [...jobs.entries()]
      .filter(([, job]) => job.status !== 'running')
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
    for (const [id] of sorted) {
      if (jobs.size <= MAX_JOBS) break
      jobs.delete(id)
    }
  }
}

export function createSaveTableJob(totalSteps: number): SaveTableJobStatus {
  pruneOldJobs()
  const jobId = randomUUID().replace(/-/g, '').slice(0, 12)
  const now = Date.now()
  const job: SaveTableJobStatus = {
    jobId,
    status: 'running',
    currentStep: 0,
    totalSteps,
    message: 'Memulai proses pembuatan tabel...',
    startedAt: now,
    updatedAt: now,
  }
  jobs.set(jobId, job)
  return job
}

export function updateSaveTableJob(
  jobId: string,
  patch: Partial<Omit<SaveTableJobStatus, 'jobId' | 'startedAt'>>,
): void {
  const existing = jobs.get(jobId)
  if (!existing) return
  jobs.set(jobId, {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  })
}

export function getSaveTableJob(jobId: string): SaveTableJobStatus | null {
  return jobs.get(jobId) ?? null
}
