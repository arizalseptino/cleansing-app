import { randomUUID } from 'node:crypto'
import type { ClickHouseLikeClient } from '../utils/clickhouse'
import { quoteIdentifier } from './metadata'

export type TempTableJenis = 'ingest' | 'save'
export type TempTableStatus = 'running' | 'done' | 'failed'

export type TempTableRegistryEntry = {
  jobId: string
  jenis: TempTableJenis
  database: string
  table: string
  status?: TempTableStatus
  createdAtMs?: number
}

const REGISTRY_DATABASE = 'bersihdata'
const REGISTRY_TABLE = 'tabel_sementara'
const SYSTEM_DATABASES = new Set(['system', 'information_schema', 'bersihdata'])

const PROCESS_ID_KEY = Symbol.for('bersihdata.tempTableRegistry.processId')
const CLEANUP_PROMISE_KEY = Symbol.for('bersihdata.tempTableRegistry.cleanupPromise')
const LAST_TS_KEY = Symbol.for('bersihdata.tempTableRegistry.lastTimestampMs')

const globalState = globalThis as Record<symbol, unknown>

function getOrCreateProcessId(): string {
  const existing = globalState[PROCESS_ID_KEY]
  if (typeof existing === 'string' && existing.length > 0) {
    return existing
  }
  const generated = randomUUID()
  globalState[PROCESS_ID_KEY] = generated
  return generated
}

export const SERVER_PROCESS_ID = getOrCreateProcessId()

function nextTimestampMs(): number {
  const prev = typeof globalState[LAST_TS_KEY] === 'number' ? (globalState[LAST_TS_KEY] as number) : 0
  const next = Math.max(Date.now(), prev + 1)
  globalState[LAST_TS_KEY] = next
  return next
}

function registryIdentifier(): string {
  return `${quoteIdentifier(REGISTRY_DATABASE)}.${quoteIdentifier(REGISTRY_TABLE)}`
}

export function isValidTempTableName(table: string): boolean {
  return table.startsWith('__tmp_') && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(table)
}

function isValidTargetDatabase(database: string): boolean {
  return Boolean(database.trim()) && !SYSTEM_DATABASES.has(database.trim().toLowerCase())
}

export async function ensureTempTableRegistry(client: ClickHouseLikeClient): Promise<void> {
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(REGISTRY_DATABASE)}`,
    clickhouse_settings: { max_execution_time: 30 },
  })
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${registryIdentifier()} (
        ${quoteIdentifier('id_job')} String,
        ${quoteIdentifier('jenis')} String,
        ${quoteIdentifier('nama_database')} String,
        ${quoteIdentifier('nama_tabel')} String,
        ${quoteIdentifier('status')} String,
        ${quoteIdentifier('id_proses')} String,
        ${quoteIdentifier('dibuat')} DateTime64(3),
        ${quoteIdentifier('diperbarui')} DateTime64(3)
      )
      ENGINE = ReplacingMergeTree(${quoteIdentifier('diperbarui')})
      ORDER BY (${quoteIdentifier('id_job')}, ${quoteIdentifier('nama_database')}, ${quoteIdentifier('nama_tabel')})
    `,
    clickhouse_settings: { max_execution_time: 30 },
  })
}

export async function recordTempTableStatus(
  client: ClickHouseLikeClient,
  input: {
    jobId: string
    jenis: TempTableJenis
    database: string
    table: string
    status: TempTableStatus
    processId?: string
    createdAtMs?: number
  },
): Promise<number> {
  if (!isValidTempTableName(input.table)) {
    throw new Error(`Nama tabel sementara tidak valid untuk registry: ${input.table}`)
  }
  if (!isValidTargetDatabase(input.database)) {
    throw new Error(`Database tabel sementara tidak valid untuk registry: ${input.database}`)
  }

  await ensureTempTableRegistry(client)
  const updatedMs = nextTimestampMs()
  const createdMs = input.createdAtMs ?? updatedMs

  await client.command({
    query: `
      INSERT INTO ${registryIdentifier()} (
        ${quoteIdentifier('id_job')},
        ${quoteIdentifier('jenis')},
        ${quoteIdentifier('nama_database')},
        ${quoteIdentifier('nama_tabel')},
        ${quoteIdentifier('status')},
        ${quoteIdentifier('id_proses')},
        ${quoteIdentifier('dibuat')},
        ${quoteIdentifier('diperbarui')}
      )
      VALUES (
        {idJob:String},
        {jenis:String},
        {namaDatabase:String},
        {namaTabel:String},
        {status:String},
        {idProses:String},
        fromUnixTimestamp64Milli({dibuatMs:Int64}),
        fromUnixTimestamp64Milli({diperbaruiMs:Int64})
      )
    `,
    query_params: {
      idJob: input.jobId,
      jenis: input.jenis,
      namaDatabase: input.database,
      namaTabel: input.table,
      status: input.status,
      idProses: input.processId ?? SERVER_PROCESS_ID,
      dibuatMs: Math.trunc(createdMs),
      diperbaruiMs: Math.trunc(updatedMs),
    },
    clickhouse_settings: { max_execution_time: 30 },
  })

  return createdMs
}

export function startTempTableHeartbeat(
  client: ClickHouseLikeClient,
  getActiveEntries: () => Array<{
    jobId: string
    jenis: TempTableJenis
    database: string
    table: string
    createdAtMs: number
  }>,
  intervalMs = 15_000,
): () => Promise<void> {
  let stopped = false
  let inFlight: Promise<void> | null = null

  const timer = setInterval(() => {
    if (stopped || inFlight) return
    const entries = getActiveEntries()
    if (entries.length === 0) return

    inFlight = (async () => {
      for (const entry of entries) {
        if (stopped) break
        try {
          await recordTempTableStatus(client, {
            jobId: entry.jobId,
            jenis: entry.jenis,
            database: entry.database,
            table: entry.table,
            status: 'running',
            createdAtMs: entry.createdAtMs,
          })
        } catch (err) {
          console.warn(
            `[temp-registry] Gagal memperbarui heartbeat untuk ${entry.database}.${entry.table}:`,
            err,
          )
        }
      }
    })().finally(() => {
      inFlight = null
    })
  }, intervalMs)

  timer.unref()

  return async () => {
    stopped = true
    clearInterval(timer)
    if (inFlight) {
      await inFlight.catch(() => {})
    }
  }
}

export async function isTempTableInRegistry(
  client: ClickHouseLikeClient,
  input: {
    jobId: string
    database: string
    table: string
  },
): Promise<boolean> {
  if (!isValidTempTableName(input.table) || !isValidTargetDatabase(input.database)) {
    return false
  }
  await ensureTempTableRegistry(client)
  const result = await client.query({
    query: `
      SELECT
        ${quoteIdentifier('id_job')},
        ${quoteIdentifier('nama_database')},
        ${quoteIdentifier('nama_tabel')}
      FROM ${registryIdentifier()} FINAL
      WHERE ${quoteIdentifier('id_job')} = {idJob:String}
        AND ${quoteIdentifier('nama_database')} = {namaDatabase:String}
        AND ${quoteIdentifier('nama_tabel')} = {namaTabel:String}
        AND startsWith(${quoteIdentifier('nama_tabel')}, '__tmp_')
      LIMIT 1
    `,
    query_params: {
      idJob: input.jobId,
      namaDatabase: input.database,
      namaTabel: input.table,
    },
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: 1, max_execution_time: 15 },
  })
  const rows = await result.json<Array<{ id_job: string; nama_database: string; nama_tabel: string }>>()
  const match = rows[0]
  return Boolean(
    match
    && match.id_job === input.jobId
    && match.nama_database === input.database
    && match.nama_tabel === input.table
    && match.nama_tabel.startsWith('__tmp_'),
  )
}

export async function dropRegisteredTempTable(
  client: ClickHouseLikeClient,
  input: {
    jobId: string
    database: string
    table: string
    maxExecutionTimeSec?: number
  },
): Promise<boolean> {
  if (!isValidTempTableName(input.table) || !isValidTargetDatabase(input.database)) {
    console.warn(`[temp-registry] Menolak DROP TABLE untuk target tidak valid: ${input.database}.${input.table}`)
    return false
  }

  const registered = await isTempTableInRegistry(client, {
    jobId: input.jobId,
    database: input.database,
    table: input.table,
  })
  if (!registered) {
    console.warn(`[temp-registry] Menolak DROP TABLE karena tidak tercatat di registry: ${input.database}.${input.table}`)
    return false
  }

  const existsQuery = await client.query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = {database:String}
        AND name = {table:String}
        AND startsWith(name, '__tmp_')
      LIMIT 1
    `,
    query_params: { database: input.database, table: input.table },
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: 1, max_execution_time: 15 },
  })
  const existing = await existsQuery.json<Array<{ name: string }>>()
  const existed = existing.some((row) => row.name === input.table)

  await client.command({
    query: `DROP TABLE IF EXISTS ${quoteIdentifier(input.database)}.${quoteIdentifier(input.table)}`,
    clickhouse_settings: { max_execution_time: input.maxExecutionTimeSec ?? 60 },
  })

  return existed
}

type OrphanedRow = {
  id_job: string
  jenis: string
  nama_database: string
  nama_tabel: string
  status: string
  id_proses: string
  dibuat_ms: number | string
}

export async function cleanupOrphanedTempTables(
  client: ClickHouseLikeClient,
  currentProcessId = SERVER_PROCESS_ID,
): Promise<{ cleanedTables: number; markedFailed: number }> {
  await ensureTempTableRegistry(client)

  const orphanResult = await client.query({
    query: `
      SELECT *
      FROM (
        SELECT
          ${quoteIdentifier('id_job')},
          argMax(${quoteIdentifier('jenis')}, ${quoteIdentifier('diperbarui')}) AS jenis,
          ${quoteIdentifier('nama_database')},
          ${quoteIdentifier('nama_tabel')},
          argMax(${quoteIdentifier('status')}, ${quoteIdentifier('diperbarui')}) AS status,
          argMax(${quoteIdentifier('id_proses')}, ${quoteIdentifier('diperbarui')}) AS id_proses,
          toInt64(toUnixTimestamp64Milli(min(${quoteIdentifier('dibuat')}))) AS dibuat_ms
        FROM ${registryIdentifier()} FINAL
        GROUP BY
          ${quoteIdentifier('id_job')},
          ${quoteIdentifier('nama_database')},
          ${quoteIdentifier('nama_tabel')}
      )
      WHERE status = 'running' AND id_proses != {currentProcessId:String}
    `,
    query_params: { currentProcessId },
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: 1, max_execution_time: 30 },
  })

  const orphans = await orphanResult.json<OrphanedRow[]>()
  let cleanedTables = 0
  let markedFailed = 0

  for (const orphan of orphans) {
    const tableName = String(orphan.nama_tabel ?? '')
    const dbName = String(orphan.nama_database ?? '')
    const jobId = String(orphan.id_job ?? '')
    const jenis: TempTableJenis = orphan.jenis === 'ingest' ? 'ingest' : 'save'
    const createdAtMs = Number(orphan.dibuat_ms)
    const validCreatedAtMs = Number.isFinite(createdAtMs) && createdAtMs > 0 ? createdAtMs : undefined

    if (!isValidTempTableName(tableName) || !isValidTargetDatabase(dbName) || !jobId) {
      continue
    }

    try {
      await recordTempTableStatus(client, {
        jobId,
        jenis,
        database: dbName,
        table: tableName,
        status: 'failed',
        processId: String(orphan.id_proses || currentProcessId),
        createdAtMs: validCreatedAtMs,
      })
      markedFailed += 1

      const dropped = await dropRegisteredTempTable(client, {
        jobId,
        database: dbName,
        table: tableName,
        maxExecutionTimeSec: 60,
      })
      if (dropped) {
        cleanedTables += 1
      }
    } catch (err) {
      console.warn(
        `[temp-registry] Gagal membersihkan tabel sementara yatim ${dbName}.${tableName} (job ${jobId}):`,
        err,
      )
    }
  }

  return { cleanedTables, markedFailed }
}

export function triggerStartupTempTableCleanup(client: ClickHouseLikeClient): void {
  if (globalState[CLEANUP_PROMISE_KEY]) {
    return
  }

  const run = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      cleanupOrphanedTempTables(client)
        .then(({ cleanedTables, markedFailed }) => {
          console.log(
            `[temp-registry] Pembersihan startup selesai: ${cleanedTables} tabel sementara dibersihkan (${markedFailed} job yatim diperbarui).`,
          )
        })
        .catch((err) => {
          console.warn('[temp-registry] Pembersihan tabel sementara saat startup gagal:', err)
        })
        .finally(() => {
          globalState[CLEANUP_PROMISE_KEY] = null
          resolve()
        })
    }, 0)
    timer.unref()
  })

  globalState[CLEANUP_PROMISE_KEY] = run
}
