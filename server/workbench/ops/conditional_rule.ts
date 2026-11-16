import type { OperationDefinition, OperationContext } from '../types'
import { ensureColumnExists, ensureTextColumn, quoteIdentifier } from '../utils'

type RuleCondition = {
  column?: unknown
  operator?: unknown
  value?: unknown
  values?: unknown
  ignoreCase?: unknown
  ignoreTrim?: unknown
}

type ConditionalRule = {
  conditions?: unknown
  targetColumn?: unknown
  action?: unknown
  value?: unknown
  sourceColumn?: unknown
}

function fail(message: string): never {
  throw createError({ statusCode: 400, statusMessage: 'Aturan bersyarat tidak valid', message })
}

function rulesFrom(value: unknown): ConditionalRule[] {
  if (!Array.isArray(value) || value.some((rule) => !rule || typeof rule !== 'object' || Array.isArray(rule))) {
    fail('Daftar aturan harus berupa daftar aturan yang valid.')
  }
  return value as ConditionalRule[]
}

function conditionsFrom(value: unknown, ruleNumber: number): RuleCondition[] {
  if (!Array.isArray(value) || value.some((condition) => !condition || typeof condition !== 'object' || Array.isArray(condition))) {
    fail(`Kondisi pada aturan ${ruleNumber} harus berupa daftar kondisi yang valid.`)
  }
  return value as RuleCondition[]
}

function baseType(type: string): string {
  let value = type.trim()
  while (/^(Nullable|LowCardinality)\(/.test(value)) value = value.slice(value.indexOf('(') + 1, -1)
  return value
}

function typeLiteral(type: string): string {
  return `'${type.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

async function validateSetValue(context: OperationContext, value: unknown, type: string): Promise<void> {
  if (typeof value !== 'string' && typeof value !== 'number') fail('Nilai tindakan ATUR harus berupa teks atau angka.')
  const raw = String(value)
  if (raw.length > 2000) fail('Nilai tindakan maksimal 2.000 karakter.')
  const result = await context.client.query({
    query: `SELECT accurateCastOrNull({value:String}, ${typeLiteral(baseType(type))}) AS converted`,
    query_params: { value: raw },
    format: 'JSONEachRow',
    clickhouse_settings: { readonly: 1, max_execution_time: 15 },
  })
  const [row] = await result.json<{ converted: unknown }[]>()
  if (!row || row.converted === null) {
    fail(`Nilai "${raw}" tidak dapat dikonversi ke tipe kolom target (${type}).`)
  }
}

const conditionalRule: OperationDefinition = {
  id: 'conditional_rule',
  name: 'Aturan bersyarat lintas kolom',
  description: 'Menerapkan aturan berurutan pada beberapa kolom target. Kondisi dalam satu aturan digabungkan dengan DAN.',
  params: [
    { key: 'rules', label: 'Daftar aturan', description: 'Aturan dievaluasi berurutan; aturan pertama yang cocok untuk tiap target digunakan. Maksimal 20 aturan.', type: 'rules', required: true },
  ],
  async validate(context) {
    const rules = rulesFrom(context.params.rules)
    if (rules.length < 1 || rules.length > 20) fail('Isi 1 sampai 20 aturan bersyarat.')
    for (const [ruleIndex, rule] of rules.entries()) {
      const conditions = conditionsFrom(rule.conditions, ruleIndex + 1)
      if (conditions.length < 1 || conditions.length > 3) {
        fail(`Aturan ${ruleIndex + 1} harus memiliki 1 sampai 3 kondisi.`)
      }

      for (const [conditionIndex, condition] of conditions.entries()) {
        const label = `Kondisi ${conditionIndex + 1} pada aturan ${ruleIndex + 1}`
        if (typeof condition.column !== 'string') fail(`${label} harus memilih kolom.`)
        const column = ensureColumnExists(context.schema, String(condition.column ?? ''), `${label}: kolom`)
        const operator = String(condition.operator ?? '')
        if (condition.ignoreCase !== undefined && typeof condition.ignoreCase !== 'boolean') fail(`${label}: opsi abaikan kapitalisasi tidak valid.`)
        if (condition.ignoreTrim !== undefined && typeof condition.ignoreTrim !== 'boolean') fail(`${label}: opsi abaikan spasi tidak valid.`)
        if (!['equals', 'not_equals', 'contains', 'starts_with', 'empty', 'not_empty', 'in'].includes(operator)) {
          fail(`${label} memiliki operator yang tidak dikenal.`)
        }
        if (operator === 'contains' || operator === 'starts_with') {
          ensureTextColumn(context.schema, column, `${label}: kolom teks`)
        }
        if (operator === 'in') {
          const values = Array.isArray(condition.values) ? condition.values : []
          if (!values.length || values.length > 100 || values.some((value) => typeof value !== 'string' || value.length > 200)) {
            fail(`${label}: operator termasuk dalam daftar memerlukan 1 sampai 100 nilai teks (maksimal 200 karakter).`)
          }
        } else if (operator !== 'empty' && operator !== 'not_empty') {
          if (typeof condition.value !== 'string' && typeof condition.value !== 'number') {
            fail(`${label} harus memiliki nilai pembanding.`)
          }
          if (String(condition.value).length > 200) fail(`${label}: nilai pembanding maksimal 200 karakter.`)
        }
      }

      if (typeof rule.targetColumn !== 'string') fail(`Pilih kolom target pada aturan ${ruleIndex + 1}.`)
      const target = ensureColumnExists(context.schema, String(rule.targetColumn ?? ''), `kolom target aturan ${ruleIndex + 1}`)
      const targetMetadata = context.schema.find(({ name }) => name === target)
      const action = String(rule.action ?? '')
      if (!['set_value', 'set_null', 'copy_column'].includes(action)) {
        fail(`Pilih tindakan yang valid pada aturan ${ruleIndex + 1}.`)
      }
      if (action === 'set_value') {
        await validateSetValue(context, rule.value, targetMetadata?.type ?? '')
      }
      if (action === 'copy_column') {
        if (typeof rule.sourceColumn !== 'string') fail(`Pilih kolom salinan pada aturan ${ruleIndex + 1}.`)
        ensureColumnExists(context.schema, String(rule.sourceColumn ?? ''), `kolom salinan aturan ${ruleIndex + 1}`)
      }
    }
  },
  async compile(context) {
    const rules = rulesFrom(context.params.rules)
    const params: Record<string, unknown> = {}
    const clausesByTarget = new Map<string, string[]>()
    const nullableTargets = new Set<string>()
    let parameterIndex = 0

    for (const rule of rules) {
      const conditions = conditionsFrom(rule.conditions, 1)
      const conditionSql = conditions.map((condition) => {
        const column = ensureColumnExists(context.schema, String(condition.column ?? ''), 'kolom kondisi')
        const quoted = quoteIdentifier(column)
        const operator = String(condition.operator)
        if (operator === 'empty') {
          return `(isNull(${quoted}) OR trimBoth(ifNull(toString(${quoted}), '')) = '')`
        }
        if (operator === 'not_empty') {
          return `(NOT isNull(${quoted}) AND trimBoth(ifNull(toString(${quoted}), '')) != '')`
        }

        const ignoreCase = condition.ignoreCase === true
        const ignoreTrim = condition.ignoreTrim === true
        const valueExpr = `ifNull(toString(${quoted}), '')`
        const normalizedColumn = `${ignoreTrim ? `trimBoth(${valueExpr})` : valueExpr}`
        const comparedColumn = ignoreCase ? `lowerUTF8(${normalizedColumn})` : normalizedColumn
        const bind = (value: string): string => {
          const key = `condition${parameterIndex++}`
          params[key] = value
          return `{${key}:String}`
        }
        if (operator === 'in') {
          const key = `condition${parameterIndex++}`
          const values = Array.isArray(condition.values) ? condition.values.map(String) : []
          params[key] = ignoreCase ? values.map((value) => ignoreTrim ? value.trim() : value).map((value) => value.toLowerCase()) : values.map((value) => ignoreTrim ? value.trim() : value)
          return `${comparedColumn} IN ({${key}:Array(String)})`
        }
        const rawValue = String(condition.value ?? '')
        const normalizedValue = ignoreTrim ? rawValue.trim() : rawValue
        const comparedValue = bind(ignoreCase ? normalizedValue.toLowerCase() : normalizedValue)
        if (operator === 'contains') return `position(${comparedColumn}, ${comparedValue}) > 0`
        if (operator === 'starts_with') return `startsWith(${comparedColumn}, ${comparedValue})`
        return `${comparedColumn} ${operator === 'equals' ? '=' : '!='} ${comparedValue}`
      }).join(' AND ')

      const target = ensureColumnExists(context.schema, String(rule.targetColumn ?? ''), 'kolom target')
      const targetMetadata = context.schema.find(({ name }) => name === target)
      const action = String(rule.action)
      let actionSql: string
      if (action === 'set_null') {
        nullableTargets.add(target)
        actionSql = `CAST(NULL, ${typeLiteral(`Nullable(${baseType(targetMetadata?.type ?? 'String')})`)})`
      } else if (action === 'copy_column') {
        const source = ensureColumnExists(context.schema, String(rule.sourceColumn ?? ''), 'kolom salinan')
        actionSql = quoteIdentifier(source)
      } else {
        const key = `setValue${parameterIndex++}`
        params[key] = String(rule.value ?? '')
        actionSql = `CAST({${key}:String}, ${typeLiteral(baseType(targetMetadata?.type ?? 'String'))})`
      }
      const clauses = clausesByTarget.get(target) ?? []
      clauses.push(`WHEN ${conditionSql} THEN ${actionSql}`)
      clausesByTarget.set(target, clauses)
    }

    const replacements = [...clausesByTarget.entries()].map(([target, clauses]) => {
      const quoted = quoteIdentifier(target)
      const metadataType = context.schema.find(({ name }) => name === target)?.type ?? 'String'
      const original = nullableTargets.has(target)
        ? `CAST(${quoted}, ${typeLiteral(`Nullable(${baseType(metadataType)})`)})`
        : quoted
      const expression = `CASE ${clauses.join(' ')} ELSE ${original} END`
      return `${expression} AS ${quoted}`
    })
    const touchedColumns = [...clausesByTarget.keys()]
    return {
      sql: `SELECT * REPLACE (${replacements.join(', ')}) FROM __INPUT__`,
      params,
      touchedColumns,
      addedColumns: [],
      beforeColumns: touchedColumns,
    }
  },
}

export default conditionalRule
