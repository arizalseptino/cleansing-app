import { randomUUID } from 'node:crypto'
import { recordCleansingHistory } from '../../features/cleansing-history'
import {
  cleanupTempFile,
  createChunkedReadable,
  ensureTableDoesNotExist,
  type IngestRequestPayload,
  insertCsvFileWithClickHouseClient,
  insertCsvBatchHttp,
  inspectCsvFile,
  inspectCsvPayload,
  isHttpError,
  pingClickHouseHttp,
  readIngestPayload,
  releaseStagedUpload,
  sanitizeIngestErrorMessage,
  streamCsvBatchesFromBuffer,
  streamCsvBatchesFromFile,
  type SupportedColumnType,
  validateNewTableName,
  validateTargetColumnTypes,
  validateTargetColumns,
} from '../../features/ingest-csv'
import { createMergeTreeTableSafe, quoteIdentifier } from '../../features/metadata'
import { buildClickHouseQuerySettings } from '../../utils/clickhouse'

function buildSafeTypedSelectExpr(colSql: string, colType: SupportedColumnType): string {
  if (colType === 'Nullable(String)') {
    return `${colSql} AS ${colSql}`
  }
  if (colType === 'String') {
    return `ifNull(${colSql}, '') AS ${colSql}`
  }

  const rawTextExpr = `trimBoth(ifNull(${colSql}, ''))`
  const isEmptyOrNullExpr = `lowerUTF8(${rawTextExpr}) IN ('', '-', 'null')`

  if (colType === 'Nullable(Int64)') {
    return `if(${isEmptyOrNullExpr}, CAST(NULL, 'Nullable(Int64)'), toInt64OrNull(${rawTextExpr})) AS ${colSql}`
  }
  if (colType === 'Int64') {
    return `ifNull(if(${isEmptyOrNullExpr}, CAST(NULL, 'Nullable(Int64)'), toInt64OrNull(${rawTextExpr})), toInt64(0)) AS ${colSql}`
  }
  if (colType === 'Nullable(Float64)') {
    return `if(${isEmptyOrNullExpr}, CAST(NULL, 'Nullable(Float64)'), toFloat64OrNull(${rawTextExpr})) AS ${colSql}`
  }
  if (colType === 'Float64') {
    return `ifNull(if(${isEmptyOrNullExpr}, CAST(NULL, 'Nullable(Float64)'), toFloat64OrNull(${rawTextExpr})), toFloat64(0)) AS ${colSql}`
  }
  if (colType === 'Nullable(Date)') {
    return `if(${isEmptyOrNullExpr}, CAST(NULL, 'Nullable(Date)'), ifNull(toDateOrNull(${rawTextExpr}), toDate(parseDateTimeBestEffortOrNull(${rawTextExpr})))) AS ${colSql}`
  }
  return `ifNull(if(${isEmptyOrNullExpr}, CAST(NULL, 'Nullable(Date)'), ifNull(toDateOrNull(${rawTextExpr}), toDate(parseDateTimeBestEffortOrNull(${rawTextExpr})))), toDate('1970-01-01')) AS ${colSql}`
}

async function checkClickHouseAlive(
  client: ReturnType<typeof useClickHouse>,
  clickhouseUrl?: string,
): Promise<{ alive: boolean; note: string }> {
  await new Promise((r) => setTimeout(r, 250))
  if (clickhouseUrl && clickhouseUrl.trim()) {
    return pingClickHouseHttp(clickhouseUrl)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    await client.query({
      query: 'SELECT 1',
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 5 },
      abort_signal: controller.signal,
    })
    return { alive: true, note: 'Server ClickHouse masih merespons normal' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { alive: false, note: `Server ClickHouse tidak merespons (${msg})` }
  } finally {
    clearTimeout(timer)
  }
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  const config = useRuntimeConfig()
  const client = useClickHouse()
  const hasRealClickHouse = Boolean(config.clickhouseUrl && config.clickhouseUrl.trim())

  let payload: IngestRequestPayload | null = null
  let mode: 'file' | 'text' = 'file'
  let sourceLabel = 'unggahan'
  let targetDatabase = ''
  let tableName = ''
  let delimiter = ','
  let targetColumns: string[] = []
  let targetColumnTypes: SupportedColumnType[] = []
  let expectedRowCount = 0
  let verifiedRowCount = 0
  let createdStagingTable = false
  let createdFinalStagingTable = false
  let renamedToFinalTable = false
  let quotedDb = ''
  let quotedTable = ''
  let quotedStagingTable = ''
  let quotedFinalStagingTable = ''
  let currentStage = 'membaca_permintaan'
  let batchIndex = 0

  let status: 'sukses' | 'gagal' = 'gagal'
  let failureMessage: string | null = null

  try {
    currentStage = 'membaca_permintaan'
    payload = await readIngestPayload(event)
    mode = payload.mode
    sourceLabel = payload.sourceLabel
    targetDatabase = payload.targetDatabase.trim()

    if (!targetDatabase) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Database tujuan wajib dipilih.',
        message: 'Database tujuan wajib dipilih.',
      })
    }

    currentStage = 'cek_tabel_ada'
    tableName = validateNewTableName(payload.tableName)
    await ensureTableDoesNotExist(client, targetDatabase, tableName)

    currentStage = 'periksa_csv'
    const inspection = payload.mode === 'file'
      ? await inspectCsvFile(payload.filePath, payload.delimiterOption, payload.sourceLabel)
      : inspectCsvPayload(payload.textNoBom, payload.delimiterOption)

    delimiter = inspection.delimiter
    expectedRowCount = inspection.rowCount

    targetColumns = validateTargetColumns(
      payload.columns ?? inspection.suggestedColumns,
      inspection.columnCount,
    )
    targetColumnTypes = validateTargetColumnTypes(
      payload.columnTypes ?? inspection.suggestedTypes,
      inspection.columnCount,
    )

    const stagingTableName = `__tmp_ingest_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    const finalStagingTableName = `__tmp_ingest_typed_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    quotedDb = quoteIdentifier(targetDatabase)
    quotedTable = quoteIdentifier(tableName)
    quotedStagingTable = quoteIdentifier(stagingTableName)
    quotedFinalStagingTable = quoteIdentifier(finalStagingTableName)
    const quotedColumns = targetColumns.map(quoteIdentifier)
    // Keep CSV empty values as strings while avoiding ClickHouse's unsafe disabled-setting path.
    const stagingColumnDefault = hasRealClickHouse ? " DEFAULT ''" : ''
    const columnDefinitions = quotedColumns
      .map((colSql) => `${colSql} Nullable(String)${stagingColumnDefault}`)
      .join(', ')

    currentStage = 'buat_tabel_sementara'
    await createMergeTreeTableSafe(
      client,
      `CREATE TABLE ${quotedDb}.${quotedStagingTable} (${columnDefinitions}) ENGINE = MergeTree ORDER BY tuple()`,
      60,
    )
    createdStagingTable = true

    const csvInsertSettings = {
      format_csv_delimiter: delimiter,
      input_format_csv_skip_first_lines: 0,
      input_format_csv_detect_header: 0,
      format_csv_allow_double_quotes: 1,
      format_csv_allow_single_quotes: 0,
      input_format_allow_errors_num: 0,
      input_format_allow_errors_ratio: 0,
      input_format_csv_allow_variable_number_of_columns: 0,
      input_format_csv_use_default_on_bad_values: 0,
      input_format_csv_empty_as_default: 0,
      format_csv_null_representation: '\\N',
      input_format_csv_skip_trailing_empty_lines: 1,
      input_format_parallel_parsing: 0,
      async_insert: 0,
      max_threads: 1,
      max_insert_threads: 1,
      max_memory_usage: 536870912,
      max_execution_time: 600,
    }

    const insertBatch = async (batchBuf: Buffer) => {
      batchIndex += 1
      currentStage = `kirim_batch_${batchIndex}`
      if (hasRealClickHouse) {
        await insertCsvBatchHttp({
          clickhouseUrl: config.clickhouseUrl,
          clickhouseUser: config.clickhouseUser,
          clickhousePassword: config.clickhousePassword,
          table: `${quotedDb}.${quotedStagingTable}`,
          columns: quotedColumns,
          batchBuffer: batchBuf,
          clickhouseSettings: {
            ...csvInsertSettings,
            input_format_csv_empty_as_default: 1,
          },
        })
      } else {
        await client.insert({
          table: `${quotedDb}.${quotedStagingTable}`,
          columns: quotedColumns,
          values: createChunkedReadable(batchBuf),
          format: 'CSV',
          clickhouse_settings: csvInsertSettings,
        })
      }
    }

    if (expectedRowCount > 0) {
      if (payload.mode === 'file') {
        if (hasRealClickHouse) {
          currentStage = 'kirim_csv_clickhouse_client'
          const insertedWithClient = await insertCsvFileWithClickHouseClient({
            clickhouseUrl: config.clickhouseUrl,
            clickhouseUser: config.clickhouseUser,
            clickhousePassword: config.clickhousePassword,
            filePath: payload.filePath,
            delimiter: inspection.delimiter,
            table: `${quotedDb}.${quotedStagingTable}`,
            columns: quotedColumns,
            clickhouseSettings: csvInsertSettings,
          })
          if (!insertedWithClient) {
            await streamCsvBatchesFromFile(payload.filePath, inspection.delimiter, insertBatch)
          }
        } else {
          await streamCsvBatchesFromFile(payload.filePath, inspection.delimiter, insertBatch)
        }
      } else {
        await streamCsvBatchesFromBuffer(payload.rawBufferNoBom, inspection.delimiter, insertBatch)
      }
    }

    currentStage = 'verifikasi_baris'
    const integrityExpr = quotedColumns
      .map((colSql) => `length(ifNull(${colSql}, ''))`)
      .join(' + ')
    const countResult = await client.query({
      query: `SELECT count() AS total, sum(${integrityExpr}) AS checked_bytes FROM ${quotedDb}.${quotedStagingTable}`,
      format: 'JSONEachRow',
      clickhouse_settings: { readonly: 1, max_execution_time: 120 },
    })
    const countRows = await countResult.json<{ total: number | string; checked_bytes?: number | string }[]>()
    const actualCount = Number(countRows[0]?.total)

    if (!Number.isSafeInteger(actualCount) || actualCount !== expectedRowCount) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Verifikasi jumlah baris gagal.',
        message: `Jumlah baris pada tabel baru (${actualCount.toLocaleString('id-ID')}) tidak sama dengan data sumber (${expectedRowCount.toLocaleString('id-ID')}).`,
      })
    }

    currentStage = 'finalisasi_tabel'
    const allNullableString = targetColumnTypes.every((colType) => colType === 'Nullable(String)')

    if (allNullableString) {
      if (hasRealClickHouse) {
        await client.command({
          query: `ALTER TABLE ${quotedDb}.${quotedStagingTable} ${quotedColumns.map((colSql) => `MODIFY COLUMN ${colSql} REMOVE DEFAULT`).join(', ')}`,
          clickhouse_settings: { max_execution_time: 60 },
        })
      }
      await ensureTableDoesNotExist(client, targetDatabase, tableName)
      await client.command({
        query: `RENAME TABLE ${quotedDb}.${quotedStagingTable} TO ${quotedDb}.${quotedTable}`,
        clickhouse_settings: { max_execution_time: 60 },
      })
      renamedToFinalTable = true
    } else {
      currentStage = 'konversi_skema_tabel'
      const typedColumnDefinitions = quotedColumns
        .map((colSql, idx) => `${colSql} ${targetColumnTypes[idx]}`)
        .join(', ')

      await createMergeTreeTableSafe(
        client,
        `CREATE TABLE ${quotedDb}.${quotedFinalStagingTable} (${typedColumnDefinitions}) ENGINE = MergeTree ORDER BY tuple()`,
        120,
      )
      createdFinalStagingTable = true

      const selectExprs = quotedColumns.map((colSql, idx) =>
        buildSafeTypedSelectExpr(colSql, targetColumnTypes[idx]!),
      )

      await client.command({
        query: `INSERT INTO ${quotedDb}.${quotedFinalStagingTable} (${quotedColumns.join(', ')}) SELECT ${selectExprs.join(', ')} FROM ${quotedDb}.${quotedStagingTable}`,
        clickhouse_settings: buildClickHouseQuerySettings({ max_execution_time: 900 }),
      })

      const typedCountResult = await client.query({
        query: `SELECT count() AS total FROM ${quotedDb}.${quotedFinalStagingTable}`,
        format: 'JSONEachRow',
        clickhouse_settings: { readonly: 1, max_execution_time: 120 },
      })
      const typedCountRows = await typedCountResult.json<{ total: number | string }[]>()
      const typedActualCount = Number(typedCountRows[0]?.total)
      if (!Number.isSafeInteger(typedActualCount) || typedActualCount !== expectedRowCount) {
        throw createError({
          statusCode: 500,
          statusMessage: 'Verifikasi jumlah baris setelah konversi tipe gagal.',
          message: `Jumlah baris pada tabel hasil konversi (${typedActualCount.toLocaleString('id-ID')}) tidak sama dengan data sumber (${expectedRowCount.toLocaleString('id-ID')}).`,
        })
      }

      await client.command({
        query: `DROP TABLE IF EXISTS ${quotedDb}.${quotedStagingTable}`,
        clickhouse_settings: { max_execution_time: 60 },
      })
      createdStagingTable = false

      await ensureTableDoesNotExist(client, targetDatabase, tableName)
      await client.command({
        query: `RENAME TABLE ${quotedDb}.${quotedFinalStagingTable} TO ${quotedDb}.${quotedTable}`,
        clickhouse_settings: { max_execution_time: 60 },
      })
      renamedToFinalTable = true
    }

    verifiedRowCount = actualCount
    status = 'sukses'

    const durationMs = Date.now() - startedAt
    const historyWarning = await recordCleansingHistory(client, {
      featureId: 'ingest',
      sourceDatabase: targetDatabase,
      sourceTable: sourceLabel,
      resultTable: tableName,
      parameters: {
        mode,
        sourceLabel,
        delimiter,
        targetDatabase,
        tableName,
        columns: targetColumns,
        columnTypes: targetColumnTypes,
        columnCount: targetColumns.length,
      },
      sourceRows: expectedRowCount,
      filledRows: verifiedRowCount,
      ambiguousRows: 0,
      durationMs,
      status: 'sukses',
      message: null,
      startedAt,
    })

    return {
      database: targetDatabase,
      table: tableName,
      sourceLabel,
      delimiter,
      columns: targetColumns,
      columnTypes: targetColumnTypes,
      rows: verifiedRowCount,
      durationMs,
      verification: `Terverifikasi ${verifiedRowCount} dari ${expectedRowCount} baris data berhasil dimuat ke ${targetDatabase}.${tableName}.`,
      historyWarning,
    }
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message.toLowerCase() : ''
    const isConnError = rawMsg.includes('socket hang up')
      || rawMsg.includes('econnreset')
      || rawMsg.includes('econnrefused')
      || rawMsg.includes('timeout')

    let livenessNote = ''
    if (isConnError) {
      const health = await checkClickHouseAlive(client, config.clickhouseUrl)
      livenessNote = health.note
    }

    if (createdStagingTable && !renamedToFinalTable && quotedDb && quotedStagingTable) {
      try {
        await client.command({
          query: `DROP TABLE IF EXISTS ${quotedDb}.${quotedStagingTable}`,
          clickhouse_settings: { max_execution_time: 30 },
        })
      } catch (dropErr) {
        console.warn('Gagal membersihkan tabel sementara setelah pemuatan batal.', dropErr)
      }
    }

    if (createdFinalStagingTable && !renamedToFinalTable && quotedDb && quotedFinalStagingTable) {
      try {
        await client.command({
          query: `DROP TABLE IF EXISTS ${quotedDb}.${quotedFinalStagingTable}`,
          clickhouse_settings: { max_execution_time: 30 },
        })
      } catch (dropErr) {
        console.warn('Gagal membersihkan tabel konversi sementara setelah pemuatan batal.', dropErr)
      }
    }

    const baseMessage = sanitizeIngestErrorMessage(
      error,
      'Gagal memuat data ke tabel baru ClickHouse. Perubahan pada tabel baru telah dibatalkan.',
    )
    const diagParts = [`tahap: ${currentStage}`]
    if (livenessNote) {
      diagParts.push(livenessNote)
    }
    const safeMessage = isHttpError(error)
      ? baseMessage
      : `${baseMessage} [${diagParts.join('; ')}]`
    failureMessage = safeMessage

    if (!isHttpError(error)) {
      console.error(`[ingest/commit] ClickHouse error at stage=${currentStage}`, error)
    }

    if (targetDatabase && tableName) {
      await recordCleansingHistory(client, {
        featureId: 'ingest',
        sourceDatabase: targetDatabase,
        sourceTable: sourceLabel,
        resultTable: tableName,
        parameters: {
          mode,
          sourceLabel,
          delimiter,
          targetDatabase,
          tableName,
          columns: targetColumns,
          columnTypes: targetColumnTypes,
        },
        sourceRows: expectedRowCount,
        filledRows: 0,
        ambiguousRows: 0,
        durationMs: Date.now() - startedAt,
        status: 'gagal',
        message: failureMessage,
        startedAt,
      })
    }

    if (isHttpError(error)) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: safeMessage,
        message: safeMessage,
      })
    }

    throw createError({
      statusCode: 500,
      statusMessage: safeMessage,
      message: safeMessage,
    })
  } finally {
    if (payload?.mode === 'file') {
      if (payload.ownsTempFile) {
        cleanupTempFile(payload.filePath)
      } else if (status === 'sukses' && payload.stagedUploadId) {
        releaseStagedUpload(payload.stagedUploadId)
      }
    }
  }
})
