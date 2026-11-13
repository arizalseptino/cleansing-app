import { randomUUID } from 'node:crypto'
import type { useClickHouse } from '../utils/clickhouse'
import { quoteIdentifier } from './metadata'

const historyDatabase = 'bersihdata'
const historyTable = 'riwayat_cleansing'

export type CleansingHistoryInput = {
  featureId: string
  sourceDatabase: string
  sourceTable: string
  resultTable: string
  parameters: Record<string, unknown>
  sourceRows: number
  filledRows: number
  ambiguousRows: number
  durationMs: number
  status: 'sukses' | 'gagal'
  message: string | null
  startedAt: number
}

function historyIdentifier(): string {
  return `${quoteIdentifier(historyDatabase)}.${quoteIdentifier(historyTable)}`
}

export async function ensureCleansingHistoryTable(
  client: ReturnType<typeof useClickHouse>,
): Promise<void> {
  const database = quoteIdentifier(historyDatabase)
  const table = historyIdentifier()
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${database}`,
    clickhouse_settings: { max_execution_time: 30 },
  })
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS ${table} (
        ${quoteIdentifier('id')} UUID,
        ${quoteIdentifier('waktu_mulai')} DateTime,
        ${quoteIdentifier('durasi_ms')} UInt32,
        ${quoteIdentifier('fitur_id')} String,
        ${quoteIdentifier('database_sumber')} String,
        ${quoteIdentifier('tabel_sumber')} String,
        ${quoteIdentifier('tabel_hasil')} String,
        ${quoteIdentifier('parameter')} String,
        ${quoteIdentifier('baris_sumber')} UInt64,
        ${quoteIdentifier('baris_terisi')} UInt64,
        ${quoteIdentifier('baris_ambigu')} UInt64,
        ${quoteIdentifier('status')} String,
        ${quoteIdentifier('pesan')} Nullable(String)
      )
      ENGINE = MergeTree
      ORDER BY ${quoteIdentifier('waktu_mulai')}
    `,
    clickhouse_settings: { max_execution_time: 30 },
  })
}

function jsonParameters(parameters: Record<string, unknown>): string {
  try {
    return JSON.stringify(parameters) ?? '{}'
  } catch {
    return '{}'
  }
}

export async function recordCleansingHistory(
  client: ReturnType<typeof useClickHouse>,
  entry: CleansingHistoryInput,
): Promise<string | null> {
  try {
    await ensureCleansingHistoryTable(client)
    await client.command({
      query: `
        INSERT INTO ${historyIdentifier()} (
          ${quoteIdentifier('id')},
          ${quoteIdentifier('waktu_mulai')},
          ${quoteIdentifier('durasi_ms')},
          ${quoteIdentifier('fitur_id')},
          ${quoteIdentifier('database_sumber')},
          ${quoteIdentifier('tabel_sumber')},
          ${quoteIdentifier('tabel_hasil')},
          ${quoteIdentifier('parameter')},
          ${quoteIdentifier('baris_sumber')},
          ${quoteIdentifier('baris_terisi')},
          ${quoteIdentifier('baris_ambigu')},
          ${quoteIdentifier('status')},
          ${quoteIdentifier('pesan')}
        )
        VALUES (
          {id:UUID},
          toDateTime({startedAt:UInt32}),
          {durationMs:UInt32},
          {featureId:String},
          {sourceDatabase:String},
          {sourceTable:String},
          {resultTable:String},
          {parameters:String},
          {sourceRows:UInt64},
          {filledRows:UInt64},
          {ambiguousRows:UInt64},
          {status:String},
          {message:Nullable(String)}
        )
      `,
      query_params: {
        id: randomUUID(),
        startedAt: Math.floor(entry.startedAt / 1000),
        durationMs: Math.min(0xFFFFFFFF, Math.max(0, Math.floor(entry.durationMs))),
        featureId: entry.featureId,
        sourceDatabase: entry.sourceDatabase,
        sourceTable: entry.sourceTable,
        resultTable: entry.resultTable,
        parameters: jsonParameters(entry.parameters),
        sourceRows: entry.sourceRows,
        filledRows: entry.filledRows,
        ambiguousRows: entry.ambiguousRows,
        status: entry.status,
        message: entry.message,
      },
      clickhouse_settings: { max_execution_time: 30 },
    })
    return null
  } catch (error) {
    console.warn('Gagal mencatat riwayat penerapan cleansing.', error)
    return 'Riwayat penerapan tidak dapat dicatat.'
  }
}
