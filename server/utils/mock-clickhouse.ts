import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import Papa from 'papaparse'

export type MockColumn = {
  name: string
  type: string
  default_kind?: string
}

type MockTable = {
  name: string
  engine: string
  sorting_key: string
  columns: MockColumn[]
  rows: Record<string, unknown>[]
}

type QueryInput = {
  query: string
  query_params?: Record<string, unknown>
  format?: string
  clickhouse_settings?: Record<string, unknown>
  abort_signal?: AbortSignal
  query_id?: string
}

type CommandInput = {
  query: string
  query_params?: Record<string, unknown>
  clickhouse_settings?: Record<string, unknown>
  abort_signal?: AbortSignal
  query_id?: string
}

type ExecInput = {
  query: string
  query_params?: Record<string, unknown>
  clickhouse_settings?: Record<string, unknown>
  abort_signal?: AbortSignal
  query_id?: string
}

type InsertInput = {
  table: string
  values: Readable | Buffer | string
  format?: string
  columns?: string[]
  clickhouse_settings?: Record<string, unknown>
}

type Token =
  | { type: 'ident'; value: string; quoted: boolean }
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'param'; name: string; paramType: string }
  | { type: 'op'; value: string }
  | { type: 'punct'; value: string }

type ExprNode =
  | { kind: 'literal'; value: unknown }
  | { kind: 'ident'; name: string; qualifier?: string }
  | { kind: 'call'; name: string; args: ExprNode[]; over?: { partitionBy: ExprNode[]; orderBy: OrderItem[] } }
  | { kind: 'unary'; op: string; expr: ExprNode }
  | { kind: 'binary'; op: string; left: ExprNode; right: ExprNode }
  | { kind: 'in'; left: ExprNode; values: ExprNode[]; subquery?: QueryNode; not?: boolean }
  | { kind: 'case'; branches: Array<{ when: ExprNode; then: ExprNode }>; elseExpr: ExprNode | null }
  | { kind: 'lambda'; params: string[]; body: ExprNode }
  | { kind: 'array'; items: ExprNode[] }
  | { kind: 'tuple'; items: ExprNode[] }
  | { kind: 'isNull'; expr: ExprNode; not: boolean }

type OrderItem = {
  expr: ExprNode
  desc: boolean
}

type SelectProjection =
  | { kind: 'star'; qualifier?: string; except: string[]; replace: Array<{ expr: ExprNode; alias: string }> }
  | { kind: 'expr'; expr: ExprNode; alias: string }

type FromSource =
  | { kind: 'table'; database: string; table: string; alias?: string }
  | { kind: 'subquery'; query: QueryNode; alias?: string }

type JoinClause = {
  type: 'LEFT' | 'CROSS' | 'INNER'
  source: FromSource
  on?: ExprNode
}

type SelectQuery = {
  kind: 'select'
  distinct?: boolean
  withCte?: { expr: SelectQuery; alias: string }
  projections: SelectProjection[]
  from?: FromSource
  joins?: JoinClause[]
  where?: ExprNode
  groupBy?: ExprNode[]
  having?: ExprNode
  qualify?: ExprNode
  orderBy?: OrderItem[]
  limit?: number
  limitBy?: ExprNode[]
  offset?: number
}

type QueryNode =
  | SelectQuery
  | { kind: 'union'; queries: SelectQuery[] }

type EvalResult = {
  columns: MockColumn[]
  rows: Record<string, unknown>[]
}

function createInitialDatabases(): Map<string, Map<string, MockTable>> {
  const dbs = new Map<string, Map<string, MockTable>>()

  const sampleTables = new Map<string, MockTable>()
  sampleTables.set('pelanggan_kotor', {
    name: 'pelanggan_kotor',
    engine: 'MergeTree',
    sorting_key: 'id',
    columns: [
      { name: 'id', type: 'UInt32' },
      { name: 'nama', type: 'String' },
      { name: 'kota', type: 'Nullable(String)' },
      { name: 'alamat', type: 'Nullable(String)' },
      { name: 'email', type: 'Nullable(String)' },
      { name: 'status', type: 'String' },
      { name: 'catatan', type: 'Nullable(String)' },
    ],
    rows: [
      { id: 1, nama: '  budi   santoso  ', kota: 'bandung', alamat: 'Jl. Asia Afrika No. 12, Bandung', email: 'BUDI@EXAMPLE.COM', status: 'aktif', catatan: 'VIP: prioritas' },
      { id: 2, nama: 'Siti  Rahayu', kota: null, alamat: 'Jl. Sudirman No. 45, Jakarta', email: 'siti.rahayu@example.com', status: 'AKTIF', catatan: '' },
      { id: 2, nama: 'Siti Rahayu', kota: 'Jakarta', alamat: 'Jl. Sudirman No. 45, Jakarta', email: null, status: 'Aktif', catatan: 'REG-02: verifikasi' },
      { id: 3, nama: '  agus wijaya', kota: '', alamat: 'Jl. Tunjungan No. 8, Surabaya', email: 'agus@example.com', status: 'nonaktif', catatan: '-' },
      { id: 4, nama: 'Dewi Lestari  ', kota: 'Yogyakarta', alamat: 'Jl. Malioboro No. 21', email: 'DEWI.L@EXAMPLE.COM', status: 'aktif', catatan: 'VIP: member lama' },
      { id: 5, nama: 'ANDI PRATAMA', kota: 'Semarang', alamat: null, email: '', status: 'non-aktif', catatan: null },
      { id: 6, nama: 'Rina   Kusuma', kota: '-', alamat: 'Jl. Merdeka No. 99, Medan', email: 'rina@example.com', status: 'Aktif', catatan: 'REG-05: promo' },
      { id: 7, nama: 'Hendra Gunawan', kota: 'Bandung', alamat: 'Jl. Dago No. 17', email: 'hendra@example.com', status: 'aktif', catatan: null },
      { id: 7, nama: 'Hendra Gunawan', kota: 'Bandung', alamat: '', email: 'hendra@example.com', status: 'aktif', catatan: 'VIP: repeat' },
      { id: 8, nama: '  Maya   Putri  ', kota: 'jakarta', alamat: 'Jl. Thamrin No. 5', email: 'maya.putri@example.com', status: 'AKTIF', catatan: '' },
      { id: 9, nama: 'Dian Permata', kota: null, alamat: 'Jl. Diponegoro No. 3, Semarang', email: 'dian@example.com', status: 'aktif', catatan: 'REG-09: baru' },
      { id: 10, nama: 'Rizky Ramadhan', kota: 'SURABAYA', alamat: 'Jl. Darmo No. 14', email: null, status: 'nonaktif', catatan: 'VIP: corporate' },
    ],
  })

  sampleTables.set('master_kota', {
    name: 'master_kota',
    engine: 'MergeTree',
    sorting_key: 'kode',
    columns: [
      { name: 'kode', type: 'String' },
      { name: 'nama_kota', type: 'String' },
      { name: 'provinsi', type: 'String' },
    ],
    rows: [
      { kode: 'BDG', nama_kota: 'Bandung', provinsi: 'Jawa Barat' },
      { kode: 'JKT', nama_kota: 'Jakarta', provinsi: 'DKI Jakarta' },
      { kode: 'SBY', nama_kota: 'Surabaya', provinsi: 'Jawa Timur' },
      { kode: 'YGY', nama_kota: 'Yogyakarta', provinsi: 'DI Yogyakarta' },
      { kode: 'SMG', nama_kota: 'Semarang', provinsi: 'Jawa Tengah' },
      { kode: 'MDN', nama_kota: 'Medan', provinsi: 'Sumatera Utara' },
    ],
  })

  sampleTables.set('transaksi_penjualan', {
    name: 'transaksi_penjualan',
    engine: 'MergeTree',
    sorting_key: 'trx_id',
    columns: [
      { name: 'trx_id', type: 'String' },
      { name: 'tanggal', type: 'String' },
      { name: 'pelanggan', type: 'String' },
      { name: 'kategori', type: 'Nullable(String)' },
      { name: 'nominal', type: 'Float64' },
      { name: 'keterangan', type: 'Nullable(String)' },
    ],
    rows: [
      { trx_id: 'TRX-001', tanggal: '2026-02-01', pelanggan: '  budi santoso ', kategori: 'elektronik', nominal: 1250000, keterangan: 'INV: lunas' },
      { trx_id: 'TRX-002', tanggal: '2026-02-02', pelanggan: 'Siti Rahayu', kategori: null, nominal: 450000, keterangan: '-' },
      { trx_id: 'TRX-002', tanggal: '2026-02-02', pelanggan: 'Siti Rahayu', kategori: 'Rumah Tangga', nominal: 450000, keterangan: 'INV: lunas' },
      { trx_id: 'TRX-003', tanggal: '2026-02-03', pelanggan: 'DEWI LESTARI', kategori: 'Fashion', nominal: 320000, keterangan: '' },
      { trx_id: 'TRX-004', tanggal: '2026-02-04', pelanggan: '  agus   wijaya', kategori: 'ELEKTRONIK', nominal: 890000, keterangan: 'COD: pending' },
      { trx_id: 'TRX-005', tanggal: '2026-02-05', pelanggan: 'Rina Kusuma', kategori: '', nominal: 215000, keterangan: null },
    ],
  })

  dbs.set('sampel_data', sampleTables)

  const appTables = new Map<string, MockTable>()
  appTables.set('riwayat_cleansing', {
    name: 'riwayat_cleansing',
    engine: 'MergeTree',
    sorting_key: 'waktu_mulai',
    columns: [
      { name: 'id', type: 'UUID' },
      { name: 'waktu_mulai', type: 'DateTime' },
      { name: 'durasi_ms', type: 'UInt32' },
      { name: 'fitur_id', type: 'String' },
      { name: 'database_sumber', type: 'String' },
      { name: 'tabel_sumber', type: 'String' },
      { name: 'tabel_hasil', type: 'String' },
      { name: 'parameter', type: 'String' },
      { name: 'baris_sumber', type: 'UInt64' },
      { name: 'baris_terisi', type: 'UInt64' },
      { name: 'baris_ambigu', type: 'UInt64' },
      { name: 'status', type: 'String' },
      { name: 'pesan', type: 'Nullable(String)' },
    ],
    rows: [
      {
        id: randomUUID(),
        waktu_mulai: new Date(Date.now() - 3600_000).toISOString(),
        durasi_ms: 42,
        fitur_id: 'workbench',
        database_sumber: 'sampel_data',
        tabel_sumber: 'pelanggan_kotor',
        tabel_hasil: 'pelanggan_bersih_contoh',
        parameter: JSON.stringify({
          source: { database: 'sampel_data', table: 'pelanggan_kotor' },
          steps: [
            { id: 's1', op: 'trim_text', params: { column: 'nama', operations: ['trim', 'collapse_spaces', 'title'] } },
            { id: 's2', op: 'deduplicate', params: { keyColumns: ['id'], strategy: 'most_complete' } },
          ],
        }),
        baris_sumber: 12,
        baris_terisi: 10,
        baris_ambigu: 0,
        status: 'sukses',
        pesan: null,
      },
    ],
  })
  dbs.set('bersihdata', appTables)

  return dbs
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const len = sql.length

  while (i < len) {
    const ch = sql[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }

    if (ch === '-' && sql[i + 1] === '-') {
      while (i < len && sql[i] !== '\n') i += 1
      continue
    }

    if (ch === '`') {
      i += 1
      let val = ''
      while (i < len) {
        if (sql[i] === '\\' && i + 1 < len) {
          val += sql[i + 1]
          i += 2
        } else if (sql[i] === '`') {
          i += 1
          break
        } else {
          val += sql[i]
          i += 1
        }
      }
      tokens.push({ type: 'ident', value: val, quoted: true })
      continue
    }

    if (ch === "'") {
      i += 1
      let val = ''
      while (i < len) {
        if (sql[i] === '\\' && i + 1 < len) {
          const next = sql[i + 1]
          if (next === 'n') val += '\n'
          else if (next === 't') val += '\t'
          else if (next === 'r') val += '\r'
          else if (next === '\\' || next === "'") val += next
          else val += `\\${next}`
          i += 2
        } else if (sql[i] === "'" && sql[i + 1] === "'") {
          val += "'"
          i += 2
        } else if (sql[i] === "'") {
          i += 1
          break
        } else {
          val += sql[i]
          i += 1
        }
      }
      tokens.push({ type: 'string', value: val })
      continue
    }

    if (ch === '{') {
      const close = sql.indexOf('}', i + 1)
      if (close !== -1) {
        const inside = sql.slice(i + 1, close)
        const colon = inside.indexOf(':')
        if (colon > 0) {
          tokens.push({
            type: 'param',
            name: inside.slice(0, colon).trim(),
            paramType: inside.slice(colon + 1).trim(),
          })
          i = close + 1
          continue
        }
      }
    }

    if (ch === '-' && sql[i + 1] === '>') {
      tokens.push({ type: 'op', value: '->' })
      i += 2
      continue
    }

    if ((ch === '!' || ch === '<' || ch === '>') && sql[i + 1] === '=') {
      tokens.push({ type: 'op', value: ch + '=' })
      i += 2
      continue
    }

    if (ch === '<' && sql[i + 1] === '>') {
      tokens.push({ type: 'op', value: '!=' })
      i += 2
      continue
    }

    if ('=<>+-*/'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i += 1
      continue
    }

    if ('(),.[];'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch })
      i += 1
      continue
    }

    if (/\d/.test(ch)) {
      let num = ''
      while (i < len && /[\d.]/.test(sql[i])) {
        num += sql[i]
        i += 1
      }
      tokens.push({ type: 'number', value: Number(num) })
      continue
    }

    if (/[A-Za-z_]/.test(ch)) {
      let word = ''
      while (i < len && /[A-Za-z0-9_]/.test(sql[i])) {
        word += sql[i]
        i += 1
      }
      tokens.push({ type: 'ident', value: word, quoted: false })
      continue
    }

    i += 1
  }

  return tokens
}

class SqlParser {
  private pos = 0
  constructor(
    private readonly tokens: Token[],
    private readonly params: Record<string, unknown>,
  ) {}

  peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  next(): Token | undefined {
    const t = this.tokens[this.pos]
    this.pos += 1
    return t
  }

  isKeyword(kw: string, offset = 0): boolean {
    const t = this.peek(offset)
    return Boolean(t && t.type === 'ident' && !t.quoted && t.value.toUpperCase() === kw.toUpperCase())
  }

  matchKeyword(kw: string): boolean {
    if (this.isKeyword(kw)) {
      this.pos += 1
      return true
    }
    return false
  }

  matchPunct(ch: string): boolean {
    const t = this.peek()
    if (t && t.type === 'punct' && t.value === ch) {
      this.pos += 1
      return true
    }
    return false
  }

  matchOp(op: string): boolean {
    const t = this.peek()
    if (t && t.type === 'op' && t.value === op) {
      this.pos += 1
      return true
    }
    return false
  }

  expectPunct(ch: string): void {
    if (!this.matchPunct(ch)) {
      throw new Error(`Expected "${ch}" in SQL`)
    }
  }

  parseQuery(): QueryNode {
    const first = this.parseSelect()
    const queries = [first]
    while (this.isKeyword('UNION')) {
      this.next()
      this.matchKeyword('ALL')
      queries.push(this.parseSelect())
    }
    return queries.length === 1 ? first : { kind: 'union', queries }
  }

  private parseFromSource(): FromSource {
    let source: FromSource
    if (this.matchPunct('(')) {
      const sub = this.parseQuery()
      this.expectPunct(')')
      source = { kind: 'subquery', query: sub }
    } else {
      const firstTok = this.next()
      const firstName = firstTok?.type === 'ident' ? firstTok.value : ''
      if (this.matchPunct('.')) {
        const secondTok = this.next()
        const secondName = secondTok?.type === 'ident' ? secondTok.value : ''
        source = { kind: 'table', database: firstName, table: secondName }
      } else {
        source = { kind: 'table', database: 'default', table: firstName }
      }
    }
    this.matchKeyword('FINAL')
    if (this.matchKeyword('AS')) {
      const aliasTok = this.next()
      if (aliasTok?.type === 'ident') source.alias = aliasTok.value
    } else {
      const next = this.peek()
      const stopWords = ['WHERE', 'LEFT', 'RIGHT', 'INNER', 'CROSS', 'JOIN', 'ON', 'GROUP', 'HAVING', 'QUALIFY', 'ORDER', 'LIMIT', 'OFFSET', 'UNION', 'FINAL']
      if (next?.type === 'ident' && (next.quoted || !stopWords.includes(next.value.toUpperCase()))) {
        this.next()
        source.alias = next.value
      }
    }
    return source
  }

  parseSelect(): SelectQuery {
    let withCte: { expr: SelectQuery; alias: string } | undefined
    if (this.matchKeyword('WITH')) {
      if (this.matchPunct('(')) {
        const expr = this.parseSelect()
        this.expectPunct(')')
        this.matchKeyword('AS')
        const aliasTok = this.next()
        withCte = { expr, alias: aliasTok?.type === 'ident' ? aliasTok.value : 'cte' }
      }
    }

    if (!this.matchKeyword('SELECT')) {
      throw new Error('Expected SELECT')
    }

    const distinct = this.matchKeyword('DISTINCT')

    const projections: SelectProjection[] = []
    do {
      const isQualifiedStar = this.peek()?.type === 'ident'
        && this.peek(1)?.type === 'punct' && this.peek(1)?.value === '.'
        && this.peek(2)?.type === 'op' && this.peek(2)?.value === '*'
      if (isQualifiedStar || this.matchOp('*')) {
        let qualifier: string | undefined
        if (isQualifiedStar) {
          qualifier = (this.next() as { value: string }).value
          this.next()
          this.next()
        }
        const except: string[] = []
        const replace: Array<{ expr: ExprNode; alias: string }> = []
        while (this.isKeyword('EXCEPT') || this.isKeyword('REPLACE')) {
          if (this.matchKeyword('EXCEPT')) {
            this.expectPunct('(')
            do {
              const tok = this.next()
              if (tok?.type === 'ident') except.push(tok.value)
            } while (this.matchPunct(','))
            this.expectPunct(')')
          } else if (this.matchKeyword('REPLACE')) {
            this.expectPunct('(')
            do {
              const expr = this.parseExpr()
              this.matchKeyword('AS')
              const aliasTok = this.next()
              if (aliasTok?.type === 'ident') {
                replace.push({ expr, alias: aliasTok.value })
              }
            } while (this.matchPunct(','))
            this.expectPunct(')')
          }
        }
        projections.push({ kind: 'star', qualifier, except, replace })
      } else {
        const startPos = this.pos
        const expr = this.parseExpr()
        let alias = ''
        if (this.matchKeyword('AS')) {
          const aliasTok = this.next()
          if (aliasTok?.type === 'ident') alias = aliasTok.value
        } else if (expr.kind === 'ident') {
          alias = expr.name
        } else {
          alias = `col_${startPos}`
        }
        projections.push({ kind: 'expr', expr, alias })
      }
    } while (this.matchPunct(','))

    let from: FromSource | undefined
    const joins: JoinClause[] = []
    if (this.matchKeyword('FROM')) {
      from = this.parseFromSource()
      while (this.isKeyword('LEFT') || this.isKeyword('CROSS') || this.isKeyword('INNER') || this.isKeyword('JOIN')) {
        let type: JoinClause['type'] = 'INNER'
        if (this.matchKeyword('LEFT')) {
          this.matchKeyword('OUTER')
          type = 'LEFT'
        } else if (this.matchKeyword('CROSS')) {
          type = 'CROSS'
        } else if (this.matchKeyword('INNER')) {
          type = 'INNER'
        }
        this.matchKeyword('JOIN')
        const source = this.parseFromSource()
        let on: ExprNode | undefined
        if (this.matchKeyword('ON')) {
          on = this.parseExpr()
        }
        joins.push({ type, source, on })
      }
    }

    let where: ExprNode | undefined
    if (this.matchKeyword('WHERE')) {
      where = this.parseExpr()
    }

    let groupBy: ExprNode[] | undefined
    if (this.matchKeyword('GROUP')) {
      this.matchKeyword('BY')
      groupBy = []
      do {
        groupBy.push(this.parseExpr())
      } while (this.matchPunct(','))
    }

    let having: ExprNode | undefined
    if (this.matchKeyword('HAVING')) {
      having = this.parseExpr()
    }

    let qualify: ExprNode | undefined
    if (this.matchKeyword('QUALIFY')) {
      qualify = this.parseExpr()
    }

    let orderBy: OrderItem[] | undefined
    if (this.matchKeyword('ORDER')) {
      this.matchKeyword('BY')
      orderBy = []
      do {
        const expr = this.parseExpr()
        let desc = false
        if (this.matchKeyword('DESC')) desc = true
        else this.matchKeyword('ASC')
        orderBy.push({ expr, desc })
      } while (this.matchPunct(','))
    }

    let limit: number | undefined
    let limitBy: ExprNode[] | undefined
    if (this.matchKeyword('LIMIT')) {
      const limExpr = this.parseExpr()
      limit = limExpr.kind === 'literal' ? Number(limExpr.value) : 0
      if (this.matchKeyword('BY')) {
        limitBy = []
        do {
          limitBy.push(this.parseExpr())
        } while (this.matchPunct(','))
      }
    }

    let offset: number | undefined
    if (this.matchKeyword('OFFSET')) {
      const offExpr = this.parseExpr()
      offset = offExpr.kind === 'literal' ? Number(offExpr.value) : 0
    }

    return {
      kind: 'select',
      distinct,
      withCte,
      projections,
      from,
      joins,
      where,
      groupBy,
      having,
      qualify,
      orderBy,
      limit,
      limitBy,
      offset,
    }
  }

  parseExpr(): ExprNode {
    return this.parseOr()
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd()
    while (this.matchKeyword('OR')) {
      const right = this.parseAnd()
      left = { kind: 'binary', op: 'OR', left, right }
    }
    return left
  }

  private parseAnd(): ExprNode {
    let left = this.parseNot()
    while (this.matchKeyword('AND')) {
      const right = this.parseNot()
      left = { kind: 'binary', op: 'AND', left, right }
    }
    return left
  }

  private parseNot(): ExprNode {
    if (this.matchKeyword('NOT')) {
      return { kind: 'unary', op: 'NOT', expr: this.parseNot() }
    }
    return this.parseComparison()
  }

  private parseComparison(): ExprNode {
    let left = this.parseAddSub()
    while (true) {
      if (this.matchOp('=') || this.matchOp('!=') || this.matchOp('<') || this.matchOp('>') || this.matchOp('<=') || this.matchOp('>=')) {
        const op = (this.tokens[this.pos - 1] as { value: string }).value
        const right = this.parseAddSub()
        left = { kind: 'binary', op, left, right }
      } else if (this.isKeyword('IS')) {
        this.next()
        const not = this.matchKeyword('NOT')
        if (this.matchKeyword('NULL')) {
          left = { kind: 'isNull', expr: left, not }
        }
      } else if (this.isKeyword('NOT') && this.isKeyword('IN', 1)) {
        this.next()
        this.next()
        const { values, subquery } = this.parseInList()
        left = { kind: 'in', left, values, subquery, not: true }
      } else if (this.matchKeyword('IN')) {
        const { values, subquery } = this.parseInList()
        left = { kind: 'in', left, values, subquery, not: false }
      } else {
        break
      }
    }
    return left
  }

  private parseInList(): { values: ExprNode[]; subquery?: QueryNode } {
    this.expectPunct('(')
    if (this.isKeyword('SELECT') || this.isKeyword('WITH')) {
      const subquery = this.parseQuery()
      this.expectPunct(')')
      return { values: [], subquery }
    }
    const values: ExprNode[] = []
    if (!this.matchPunct(')')) {
      do {
        values.push(this.parseExpr())
      } while (this.matchPunct(','))
      this.expectPunct(')')
    }
    return { values }
  }

  private parseAddSub(): ExprNode {
    let left = this.parseMulDiv()
    while (this.matchOp('+') || this.matchOp('-')) {
      const op = (this.tokens[this.pos - 1] as { value: string }).value
      const right = this.parseMulDiv()
      left = { kind: 'binary', op, left, right }
    }
    return left
  }

  private parseMulDiv(): ExprNode {
    let left = this.parseUnary()
    while (this.matchOp('*') || this.matchOp('/')) {
      const op = (this.tokens[this.pos - 1] as { value: string }).value
      const right = this.parseUnary()
      left = { kind: 'binary', op, left, right }
    }
    return left
  }

  private parseUnary(): ExprNode {
    if (this.matchOp('-')) {
      return { kind: 'unary', op: '-', expr: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ExprNode {
    const t = this.peek()
    if (!t) throw new Error('Unexpected end of SQL expression')

    if (t.type === 'number') {
      this.next()
      return { kind: 'literal', value: t.value }
    }

    if (t.type === 'string') {
      this.next()
      return { kind: 'literal', value: t.value }
    }

    if (t.type === 'param') {
      this.next()
      return { kind: 'literal', value: resolveParamValue(this.params[t.name], t.paramType) }
    }

    if (t.type === 'punct' && t.value === '[') {
      this.next()
      const items: ExprNode[] = []
      if (!this.matchPunct(']')) {
        do {
          items.push(this.parseExpr())
        } while (this.matchPunct(','))
        this.expectPunct(']')
      }
      return { kind: 'array', items }
    }

    if (t.type === 'punct' && t.value === '(') {
      this.next()
      if (this.matchPunct(')')) {
        return { kind: 'tuple', items: [] }
      }
      const first = this.parseExpr()
      if (this.matchPunct(',')) {
        const items = [first]
        do {
          items.push(this.parseExpr())
        } while (this.matchPunct(','))
        this.expectPunct(')')
        return { kind: 'tuple', items }
      }
      this.expectPunct(')')
      return first
    }

    if (this.matchKeyword('NULL')) {
      return { kind: 'literal', value: null }
    }
    if (this.matchKeyword('TRUE')) {
      return { kind: 'literal', value: 1 }
    }
    if (this.matchKeyword('FALSE')) {
      return { kind: 'literal', value: 0 }
    }

    if (this.matchKeyword('CASE')) {
      const branches: Array<{ when: ExprNode; then: ExprNode }> = []
      while (this.matchKeyword('WHEN')) {
        const when = this.parseExpr()
        this.matchKeyword('THEN')
        const then = this.parseExpr()
        branches.push({ when, then })
      }
      let elseExpr: ExprNode | null = null
      if (this.matchKeyword('ELSE')) {
        elseExpr = this.parseExpr()
      }
      this.matchKeyword('END')
      return { kind: 'case', branches, elseExpr }
    }

    if (t.type === 'ident') {
      this.next()
      if (!t.quoted && this.peek()?.type === 'op' && (this.peek() as { value: string }).value === '->') {
        this.next()
        const body = this.parseExpr()
        return { kind: 'lambda', params: [t.value], body }
      }
      if (!t.quoted && this.matchPunct('(')) {
        const args: ExprNode[] = []
        if (!this.matchPunct(')')) {
          do {
            args.push(this.parseExpr())
          } while (this.matchPunct(','))
          this.expectPunct(')')
        }
        let over: { partitionBy: ExprNode[]; orderBy: OrderItem[] } | undefined
        if (this.matchKeyword('OVER')) {
          this.expectPunct('(')
          const partitionBy: ExprNode[] = []
          const orderBy: OrderItem[] = []
          if (this.matchKeyword('PARTITION')) {
            this.matchKeyword('BY')
            do {
              partitionBy.push(this.parseExpr())
            } while (this.matchPunct(','))
          }
          if (this.matchKeyword('ORDER')) {
            this.matchKeyword('BY')
            do {
              const expr = this.parseExpr()
              let desc = false
              if (this.matchKeyword('DESC')) desc = true
              else this.matchKeyword('ASC')
              orderBy.push({ expr, desc })
            } while (this.matchPunct(','))
          }
          this.expectPunct(')')
          over = { partitionBy, orderBy }
        }
        return { kind: 'call', name: t.value, args, over }
      }
      if (this.matchPunct('.')) {
        const colTok = this.next()
        return { kind: 'ident', qualifier: t.value, name: colTok?.type === 'ident' ? colTok.value : '' }
      }
      return { kind: 'ident', name: t.value }
    }

    throw new Error(`Unexpected token in SQL expression: ${JSON.stringify(t)}`)
  }
}

function resolveParamValue(value: unknown, paramType: string): unknown {
  if (value === undefined) return null
  if (/^Array\(/i.test(paramType)) {
    return Array.isArray(value) ? value : []
  }
  if (/^U?Int\d+$|^Float\d+$/i.test(paramType)) {
    return Number(value)
  }
  if (/^String$/i.test(paramType)) {
    return value === null ? null : String(value)
  }
  return value
}

function toBool(val: unknown): boolean {
  if (val === null || val === undefined || val === false || val === 0 || val === '') return false
  return true
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.min(a.length, b.length)
    for (let i = 0; i < len; i += 1) {
      const cmp = compareValues(a[i], b[i])
      if (cmp !== 0) return cmp
    }
    return a.length - b.length
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false
  if (typeof a === 'number' && typeof b === 'number') return a === b
  return String(a) === String(b)
}

function compileRegex(pattern: string, caseInsensitive = false): RegExp {
  let pat = pattern
  let flags = caseInsensitive ? 'i' : ''
  if (pat.startsWith('(?i)')) {
    pat = pat.slice(4)
    if (!flags.includes('i')) flags += 'i'
  }
  try {
    return new RegExp(pat, flags)
  } catch (err) {
    throw new Error(`Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function castValue(value: unknown, targetType: string, strict: boolean): unknown {
  const base = targetType.replace(/^(Nullable|LowCardinality)\((.*)\)$/i, '$2').trim()
  if (/^Array\(/i.test(base) && Array.isArray(value)) {
    return value
  }
  if (value === null || value === undefined) {
    return /^Nullable\(/i.test(targetType) ? null : strict ? null : ''
  }
  const str = String(value)
  if (/^(UInt|Int)\d+$/i.test(base)) {
    if (!/^-?\d+$/.test(str.trim())) return strict ? null : 0
    const num = Number(str.trim())
    if (!Number.isSafeInteger(num)) return strict ? null : 0
    if (/^UInt/i.test(base) && num < 0) return strict ? null : 0
    return num
  }
  if (/^Float\d+$/i.test(base)) {
    if (!str.trim() || Number.isNaN(Number(str.trim()))) return strict ? null : 0
    return Number(str.trim())
  }
  if (/^Bool/i.test(base)) {
    const low = str.trim().toLowerCase()
    if (['true', '1'].includes(low)) return true
    if (['false', '0'].includes(low)) return false
    return strict ? null : false
  }
  if (/^Date$/i.test(base)) {
    const parsed = parseMockIsoDate(str)
    if (parsed) return parsed
    return strict ? null : '1970-01-01'
  }
  if (/^DateTime/i.test(base)) {
    const d = new Date(str)
    if (Number.isNaN(d.getTime())) return strict ? null : str
    return d.toISOString()
  }
  return str
}

function parseMockIsoDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!s) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(s)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null
  }
  const iso = `${match[1]}-${match[2]}-${match[3]}`
  return iso >= '1970-01-01' && iso <= '2149-06-06' ? iso : null
}

function parseMockDateTimeBestEffort(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!s) return null
  const iso = parseMockIsoDate(s)
  if (iso) return `${iso} 00:00:00`

  const slashYmd = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (slashYmd) {
    const candidate = `${slashYmd[1]}-${slashYmd[2].padStart(2, '0')}-${slashYmd[3].padStart(2, '0')}`
    const valid = parseMockIsoDate(candidate)
    return valid ? `${valid} 00:00:00` : null
  }

  const dmy = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(s)
  if (dmy) {
    const dayNum = Number(dmy[1])
    const monthNum = Number(dmy[2])
    const yearNum = Number(dmy[3])
    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      const candidate = `${String(yearNum).padStart(4, '0')}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
      const valid = parseMockIsoDate(candidate)
      return valid ? `${valid} 00:00:00` : null
    }
  }

  if (/[A-Za-z]/.test(s)) {
    const parsed = new Date(s)
    if (!Number.isNaN(parsed.getTime())) {
      const isoPart = parsed.toISOString().slice(0, 10)
      if (isoPart >= '1970-01-01' && isoPart <= '2149-06-06') {
        return `${isoPart} 00:00:00`
      }
    }
  }
  return null
}

function defaultValueForMockType(type: string): unknown {
  if (/^(Nullable|LowCardinality)\(/i.test(type)) {
    if (/^Nullable\(/i.test(type)) return null
  }
  const base = type.replace(/^(Nullable|LowCardinality)\((.*)\)$/i, '$2').trim()
  if (/^(UInt|Int)\d+$/i.test(base) || /^Float\d+$/i.test(base)) return 0
  if (/^Date$/i.test(base)) return '1970-01-01'
  if (/^Bool/i.test(base)) return false
  return ''
}

function inferExprType(expr: ExprNode, inputColumns: MockColumn[]): string {
  if (expr.kind === 'ident') {
    return inputColumns.find((c) => c.name === expr.name)?.type ?? 'String'
  }
  if (expr.kind === 'literal') {
    if (expr.value === null) return 'Nullable(Nothing)'
    if (typeof expr.value === 'number') return Number.isInteger(expr.value) ? 'Int64' : 'Float64'
    return 'String'
  }
  if (expr.kind === 'call') {
    const fn = expr.name.toLowerCase()
    if (fn === 'row_number' || fn === 'count' || fn === 'countif' || fn === 'uniq' || fn === 'uniqexact' || fn === 'editdistanceutf8' || fn === 'editdistance' || fn === 'touint64') return 'UInt64'
    if (fn === 'toint64') return 'Int64'
    if (fn === 'toint64ornull') return 'Nullable(Int64)'
    if (fn === 'tofloat64ornull') return 'Nullable(Float64)'
    if (fn === 'todateornull') return 'Nullable(Date)'
    if (fn === 'parsedatetimebesteffortornull') return 'Nullable(DateTime)'
    if (fn === 'todate') {
      const argType = expr.args[0] ? inferExprType(expr.args[0], inputColumns) : 'String'
      return argType.startsWith('Nullable(') ? 'Nullable(Date)' : 'Date'
    }
    if (fn === 'isnull' || fn === 'notempty' || fn === 'empty' || fn === 'startswith' || fn === 'match' || fn === 'touint8') return 'UInt8'
    if (fn === 'position' || fn === 'positioncaseinsensitiveutf8' || fn === 'lengthutf8' || fn === 'length') return 'UInt64'
    if (fn === 'jarowinklersimilarity' || fn === 'tofloat64' || fn === 'greatest' || fn === 'least') return 'Float64'
    if (fn === 'cast' && expr.args[1]?.kind === 'literal') return String(expr.args[1].value)
    if (fn === 'ifnull' && expr.args.length >= 2) {
      const t2 = inferExprType(expr.args[1], inputColumns)
      return t2
    }
    if (fn === 'if' && expr.args.length >= 3) {
      const t1 = inferExprType(expr.args[1], inputColumns)
      const t2 = inferExprType(expr.args[2], inputColumns)
      if (t1 === 'Nullable(Nothing)') return t2.startsWith('Nullable(') ? t2 : `Nullable(${t2})`
      if (t2 === 'Nullable(Nothing)') return t1.startsWith('Nullable(') ? t1 : `Nullable(${t1})`
      if (t1.startsWith('Nullable(')) return t1
      if (t2.startsWith('Nullable(')) return t2
      return t1
    }
    if (fn === 'trimboth' || fn === 'upperutf8' || fn === 'lowerutf8' || fn === 'initcap' || fn === 'replaceregexpall' || fn === 'any') {
      return expr.args[0] ? inferExprType(expr.args[0], inputColumns) : 'String'
    }
    if ((fn === 'max' || fn === 'min') && expr.args[0]) {
      return inferExprType(expr.args[0], inputColumns)
    }
  }
  if (expr.kind === 'case') {
    for (const branch of expr.branches) {
      const t = inferExprType(branch.then, inputColumns)
      if (t !== 'Nullable(Nothing)') return t
    }
    if (expr.elseExpr) return inferExprType(expr.elseExpr, inputColumns)
  }
  return 'String'
}

function jaroWinklerSimilarity(rawA: string, rawB: string): number {
  const a = [...rawA]
  const b = [...rawB]
  const lenA = a.length
  const lenB = b.length
  if (lenA === 0 && lenB === 0) return 1
  if (lenA === 0 || lenB === 0) return 0

  const matchDistance = Math.max(0, Math.floor(Math.max(lenA, lenB) / 2) - 1)
  const aMatched = new Array<boolean>(lenA).fill(false)
  const bMatched = new Array<boolean>(lenB).fill(false)

  let matches = 0
  for (let i = 0; i < lenA; i += 1) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, lenB)
    for (let j = start; j < end; j += 1) {
      if (bMatched[j] || a[i] !== b[j]) continue
      aMatched[i] = true
      bMatched[j] = true
      matches += 1
      break
    }
  }

  if (matches === 0) return 0

  let transpositions = 0
  let k = 0
  for (let i = 0; i < lenA; i += 1) {
    if (!aMatched[i]) continue
    while (!bMatched[k]) k += 1
    if (a[i] !== b[k]) transpositions += 1
    k += 1
  }

  const jaro = (matches / lenA + matches / lenB + (matches - transpositions / 2) / matches) / 3
  let prefix = 0
  const maxPrefix = Math.min(4, lenA, lenB)
  while (prefix < maxPrefix && a[prefix] === b[prefix]) {
    prefix += 1
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

function editDistanceUtf8(rawA: string, rawB: string): number {
  const a = [...rawA]
  const b = [...rawB]
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j += 1) prev[j] = j

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[n]
}

export class MockClickHouseClient {
  private databases = createInitialDatabases()
  private rowScopes = new WeakMap<Record<string, unknown>, Map<string, Record<string, unknown>>>()
  private projectedSourceFallback = new WeakMap<Record<string, unknown>, Record<string, unknown>>()
  private activeQueries = new Map<string, AbortController>()

  private getSystemRows(table: string): Record<string, unknown>[] {
    if (table === 'databases') {
      return [...this.databases.keys()].map((name) => ({ name }))
    }
    if (table === 'tables') {
      const rows: Record<string, unknown>[] = []
      for (const [dbName, tblMap] of this.databases.entries()) {
        for (const tbl of tblMap.values()) {
          rows.push({
            database: dbName,
            name: tbl.name,
            engine: tbl.engine,
            sorting_key: tbl.sorting_key,
          })
        }
      }
      return rows
    }
    if (table === 'columns') {
      const rows: Record<string, unknown>[] = []
      for (const [dbName, tblMap] of this.databases.entries()) {
        for (const tbl of tblMap.values()) {
          tbl.columns.forEach((col, index) => {
            rows.push({
              database: dbName,
              table: tbl.name,
              name: col.name,
              type: col.type,
              default_kind: col.default_kind ?? '',
              position: index + 1,
            })
          })
        }
      }
      return rows
    }
    return []
  }

  private getTable(database: string, table: string): EvalResult {
    if (database.toLowerCase() === 'system') {
      const sysCols: Record<string, MockColumn[]> = {
        databases: [{ name: 'name', type: 'String' }],
        tables: [
          { name: 'database', type: 'String' },
          { name: 'name', type: 'String' },
          { name: 'engine', type: 'String' },
          { name: 'sorting_key', type: 'String' },
        ],
        columns: [
          { name: 'database', type: 'String' },
          { name: 'table', type: 'String' },
          { name: 'name', type: 'String' },
          { name: 'type', type: 'String' },
          { name: 'default_kind', type: 'String' },
          { name: 'position', type: 'UInt64' },
        ],
      }
      const key = table.toLowerCase()
      return {
        columns: sysCols[key] ?? [],
        rows: this.getSystemRows(key),
      }
    }

    const db = this.databases.get(database)
    const tbl = db?.get(table)
    if (!tbl) {
      throw new Error(`Table ${database}.${table} does not exist`)
    }
    return {
      columns: tbl.columns.map((c) => ({ ...c })),
      rows: tbl.rows.map((r) => ({ ...r })),
    }
  }

  private evalExpr(expr: ExprNode, row: Record<string, unknown>, ctes: Map<string, unknown>): unknown {
    switch (expr.kind) {
      case 'literal':
        return expr.value
      case 'ident': {
        if (expr.qualifier) {
          const scoped = this.rowScopes.get(row)?.get(expr.qualifier)
          if (scoped && expr.name in scoped) return scoped[expr.name]
        }
        if (expr.name in row) return row[expr.name]
        const sourceRow = this.projectedSourceFallback.get(row)
        if (sourceRow && expr.name in sourceRow) return sourceRow[expr.name]
        if (ctes.has(expr.name)) return ctes.get(expr.name)
        return undefined
      }
      case 'array':
        return expr.items.map((item) => this.evalExpr(item, row, ctes))
      case 'tuple':
        return expr.items.map((item) => this.evalExpr(item, row, ctes))
      case 'isNull': {
        const val = this.evalExpr(expr.expr, row, ctes)
        const isN = val === null || val === undefined
        return (expr.not ? !isN : isN) ? 1 : 0
      }
      case 'unary': {
        const v = this.evalExpr(expr.expr, row, ctes)
        if (expr.op === 'NOT') return toBool(v) ? 0 : 1
        if (expr.op === '-') return -Number(v ?? 0)
        return v
      }
      case 'binary': {
        if (expr.op === 'AND') {
          return toBool(this.evalExpr(expr.left, row, ctes)) && toBool(this.evalExpr(expr.right, row, ctes)) ? 1 : 0
        }
        if (expr.op === 'OR') {
          return toBool(this.evalExpr(expr.left, row, ctes)) || toBool(this.evalExpr(expr.right, row, ctes)) ? 1 : 0
        }
        const l = this.evalExpr(expr.left, row, ctes)
        const r = this.evalExpr(expr.right, row, ctes)
        switch (expr.op) {
          case '=': return valuesEqual(l, r) ? 1 : 0
          case '!=': return l === null || l === undefined || r === null || r === undefined ? 0 : (valuesEqual(l, r) ? 0 : 1)
          case '<': return l !== null && r !== null && compareValues(l, r) < 0 ? 1 : 0
          case '>': return l !== null && r !== null && compareValues(l, r) > 0 ? 1 : 0
          case '<=': return l !== null && r !== null && compareValues(l, r) <= 0 ? 1 : 0
          case '>=': return l !== null && r !== null && compareValues(l, r) >= 0 ? 1 : 0
          case '+': return Number(l ?? 0) + Number(r ?? 0)
          case '-': return Number(l ?? 0) - Number(r ?? 0)
          case '*': return Number(l ?? 0) * Number(r ?? 0)
          case '/': return Number(r) === 0 ? 0 : Number(l ?? 0) / Number(r)
          default: return 0
        }
      }
      case 'in': {
        const left = this.evalExpr(expr.left, row, ctes)
        let list: unknown[] = []
        if (expr.subquery) {
          const subRes = this.evalQuery(expr.subquery, ctes)
          const firstCol = subRes.columns[0]?.name
          list = firstCol ? subRes.rows.map((r) => r[firstCol]) : []
        } else if (expr.values.length === 1) {
          const single = this.evalExpr(expr.values[0], row, ctes)
          list = Array.isArray(single) ? single : [single]
        } else {
          list = expr.values.map((v) => this.evalExpr(v, row, ctes))
        }
        const found = list.some((item) => valuesEqual(left, item))
        return (expr.not ? !found : found) ? 1 : 0
      }
      case 'case': {
        for (const branch of expr.branches) {
          if (toBool(this.evalExpr(branch.when, row, ctes))) {
            return this.evalExpr(branch.then, row, ctes)
          }
        }
        return expr.elseExpr ? this.evalExpr(expr.elseExpr, row, ctes) : null
      }
      case 'call':
        return this.evalCall(expr.name, expr.args, row, ctes)
      case 'lambda':
        return expr
    }
  }

  private evalCall(name: string, args: ExprNode[], row: Record<string, unknown>, ctes: Map<string, unknown>): unknown {
    const fn = name.toLowerCase()
    if (fn === 'version') return '24.8.1-simulasi'
    if (fn === 'isnull') {
      const v = this.evalExpr(args[0], row, ctes)
      return v === null || v === undefined ? 1 : 0
    }
    if (fn === 'ifnull') {
      const v = this.evalExpr(args[0], row, ctes)
      return v !== null && v !== undefined ? v : this.evalExpr(args[1], row, ctes)
    }
    if (fn === 'assumenotnull') {
      return this.evalExpr(args[0], row, ctes)
    }
    if (fn === 'tostring') {
      const v = this.evalExpr(args[0], row, ctes)
      return v === null || v === undefined ? null : String(v)
    }
    if (fn === 'empty') {
      const v = this.evalExpr(args[0], row, ctes)
      return v === null || v === undefined || String(v).length === 0 ? 1 : 0
    }
    if (fn === 'notempty') {
      const v = this.evalExpr(args[0], row, ctes)
      return v !== null && v !== undefined && String(v).length > 0 ? 1 : 0
    }
    if (fn === 'trimboth') {
      const v = this.evalExpr(args[0], row, ctes)
      return v === null || v === undefined ? null : String(v).trim()
    }
    if (fn === 'upperutf8') {
      const v = this.evalExpr(args[0], row, ctes)
      return v === null || v === undefined ? null : String(v).toUpperCase()
    }
    if (fn === 'lowerutf8') {
      const v = this.evalExpr(args[0], row, ctes)
      return v === null || v === undefined ? null : String(v).toLowerCase()
    }
    if (fn === 'initcap') {
      const v = this.evalExpr(args[0], row, ctes)
      if (v === null || v === undefined) return null
      return String(v)
        .toLowerCase()
        .replace(/(^|\s)([^\p{L}\p{N}]*)(\p{L})/gu, (_, space: string, prefix: string, ch: string) => `${space}${prefix}${ch.toUpperCase()}`)
    }
    if (fn === 'replaceregexpall') {
      const v = this.evalExpr(args[0], row, ctes)
      if (v === null || v === undefined) return null
      const pat = String(this.evalExpr(args[1], row, ctes) ?? '')
      const rep = String(this.evalExpr(args[2], row, ctes) ?? '')
      const flags = /\\[pP]\{/.test(pat) ? 'gu' : 'g'
      return String(v).replace(new RegExp(pat, flags), rep)
    }
    if (fn === 'jarowinklersimilarity') {
      const a = this.evalExpr(args[0], row, ctes)
      const b = this.evalExpr(args[1], row, ctes)
      return jaroWinklerSimilarity(String(a ?? ''), String(b ?? ''))
    }
    if (fn === 'editdistanceutf8' || fn === 'editdistance') {
      const a = this.evalExpr(args[0], row, ctes)
      const b = this.evalExpr(args[1], row, ctes)
      return editDistanceUtf8(String(a ?? ''), String(b ?? ''))
    }
    if (fn === 'greatest') {
      const vals = args.map((a) => this.evalExpr(a, row, ctes)).filter((v) => v !== null && v !== undefined)
      if (vals.length === 0) return null
      return vals.reduce((acc, v) => (compareValues(v, acc) > 0 ? v : acc))
    }
    if (fn === 'least') {
      const vals = args.map((a) => this.evalExpr(a, row, ctes)).filter((v) => v !== null && v !== undefined)
      if (vals.length === 0) return null
      return vals.reduce((acc, v) => (compareValues(v, acc) < 0 ? v : acc))
    }
    if (fn === 'tofloat64') {
      const v = this.evalExpr(args[0], row, ctes)
      return v === null || v === undefined ? 0 : Number(v)
    }
    if (fn === 'tofloat64ornull') {
      const v = this.evalExpr(args[0], row, ctes)
      if (v === null || v === undefined) return null
      if (typeof v === 'number') return Number.isFinite(v) ? v : null
      const s = String(v).trim()
      if (!s || !/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null
      const n = Number(s)
      return Number.isFinite(n) ? n : null
    }
    if (fn === 'touint8' || fn === 'touint64' || fn === 'toint64') {
      const v = this.evalExpr(args[0], row, ctes)
      return v === null || v === undefined ? 0 : Math.trunc(Number(v))
    }
    if (fn === 'toint64ornull') {
      const v = this.evalExpr(args[0], row, ctes)
      if (v === null || v === undefined) return null
      if (typeof v === 'number') return Number.isSafeInteger(v) ? v : null
      const s = String(v).trim()
      if (!/^-?\d+$/.test(s)) return null
      try {
        const b = BigInt(s)
        if (b < -9223372036854775808n || b > 9223372036854775807n) return null
        return Number.isSafeInteger(Number(s)) ? Number(s) : s
      } catch {
        return null
      }
    }
    if (fn === 'abs') {
      const v = this.evalExpr(args[0], row, ctes)
      if (v === null || v === undefined) return null
      const n = Number(v)
      return Number.isFinite(n) ? Math.abs(n) : 0
    }
    if (fn === 'if') {
      return toBool(this.evalExpr(args[0], row, ctes))
        ? this.evalExpr(args[1], row, ctes)
        : this.evalExpr(args[2], row, ctes)
    }
    if (fn === 'multiif') {
      for (let i = 0; i + 1 < args.length; i += 2) {
        if (toBool(this.evalExpr(args[i], row, ctes))) {
          return this.evalExpr(args[i + 1], row, ctes)
        }
      }
      return args.length % 2 === 1 ? this.evalExpr(args[args.length - 1], row, ctes) : null
    }
    if (fn === 'startswith') {
      const s = this.evalExpr(args[0], row, ctes)
      const p = this.evalExpr(args[1], row, ctes)
      if (s === null || s === undefined || p === null || p === undefined) return 0
      return String(s).startsWith(String(p)) ? 1 : 0
    }
    if (fn === 'position' || fn === 'positioncaseinsensitiveutf8') {
      const h = this.evalExpr(args[0], row, ctes)
      const n = this.evalExpr(args[1], row, ctes)
      if (h === null || h === undefined || n === null || n === undefined) return 0
      const hs = fn === 'positioncaseinsensitiveutf8' ? String(h).toLowerCase() : String(h)
      const ns = fn === 'positioncaseinsensitiveutf8' ? String(n).toLowerCase() : String(n)
      const idx = hs.indexOf(ns)
      return idx === -1 ? 0 : idx + 1
    }
    if (fn === 'lengthutf8' || fn === 'length') {
      const v = this.evalExpr(args[0], row, ctes)
      if (Array.isArray(v)) return v.length
      if (v === null || v === undefined) return 0
      return [...String(v)].length
    }
    if (fn === 'substring') {
      const s = this.evalExpr(args[0], row, ctes)
      if (s === null || s === undefined) return ''
      const str = String(s)
      const pos = Math.max(1, Number(this.evalExpr(args[1], row, ctes) ?? 1))
      const start = pos - 1
      if (args.length >= 3) {
        const len = Math.max(0, Number(this.evalExpr(args[2], row, ctes) ?? 0))
        return str.slice(start, start + len)
      }
      return str.slice(start)
    }
    if (fn === 'concat') {
      return args.map((a) => String(this.evalExpr(a, row, ctes) ?? '')).join('')
    }
    if (fn === 'match') {
      const s = String(this.evalExpr(args[0], row, ctes) ?? '')
      const pat = String(this.evalExpr(args[1], row, ctes) ?? '')
      const re = compileRegex(pat)
      return re.test(s) ? 1 : 0
    }
    if (fn === 'extractallgroupsvertical') {
      const s = String(this.evalExpr(args[0], row, ctes) ?? '')
      const pat = String(this.evalExpr(args[1], row, ctes) ?? '')
      const baseRe = compileRegex(pat)
      const flags = baseRe.flags.includes('g') ? baseRe.flags : `${baseRe.flags}g`
      const re = new RegExp(baseRe.source, flags)
      const matches: string[][] = []
      let m: RegExpExecArray | null
      while ((m = re.exec(s)) !== null) {
        matches.push(m.slice(1).map((g) => g ?? ''))
        if (m[0] === '') re.lastIndex += 1
      }
      return matches
    }
    if (fn === 'cast') {
      const val = this.evalExpr(args[0], row, ctes)
      const targetType = String(this.evalExpr(args[1], row, ctes) ?? 'String')
      return castValue(val, targetType, false)
    }
    if (fn === 'accuratecastornull') {
      const val = this.evalExpr(args[0], row, ctes)
      const targetType = String(this.evalExpr(args[1], row, ctes) ?? 'String')
      return castValue(val, targetType, true)
    }
    if (fn === 'tuple') {
      return args.map((a) => this.evalExpr(a, row, ctes))
    }
    if (fn === 'tupleelement' || fn === 'arrayelement') {
      const arr = this.evalExpr(args[0], row, ctes)
      const idx = Number(this.evalExpr(args[1], row, ctes) ?? 1)
      if (!Array.isArray(arr) || idx < 1 || idx > arr.length) return fn === 'arrayelement' ? '' : null
      return arr[idx - 1]
    }
    if (fn === 'arraymap') {
      const lambda = args[0]
      const arr = this.evalExpr(args[1], row, ctes)
      if (!Array.isArray(arr) || lambda.kind !== 'lambda') return []
      return arr.map((item) => this.evalExpr(lambda.body, { ...row, [lambda.params[0]]: item }, ctes))
    }
    if (fn === 'arrayfilter') {
      const lambda = args[0]
      const arr = this.evalExpr(args[1], row, ctes)
      if (!Array.isArray(arr) || lambda.kind !== 'lambda') return []
      return arr.filter((item) => toBool(this.evalExpr(lambda.body, { ...row, [lambda.params[0]]: item }, ctes)))
    }
    if (fn === 'arraydistinct') {
      const arr = this.evalExpr(args[0], row, ctes)
      if (!Array.isArray(arr)) return []
      const seen = new Set<string>()
      return arr.filter((item) => {
        const key = JSON.stringify(item)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }
    if (fn === 'arraysort') {
      const hasLambda = args[0]?.kind === 'lambda'
      const arr = this.evalExpr(hasLambda ? args[1] : args[0], row, ctes)
      if (!Array.isArray(arr)) return []
      const copy = [...arr]
      if (hasLambda && args[0].kind === 'lambda') {
        const lambda = args[0]
        copy.sort((a, b) => {
          const ka = this.evalExpr(lambda.body, { ...row, [lambda.params[0]]: a }, ctes)
          const kb = this.evalExpr(lambda.body, { ...row, [lambda.params[0]]: b }, ctes)
          return compareValues(ka, kb)
        })
      }
      return copy
    }
    if (fn === 'arraystringconcat') {
      const arr = this.evalExpr(args[0], row, ctes)
      const sep = args[1] ? String(this.evalExpr(args[1], row, ctes) ?? '') : ''
      return Array.isArray(arr) ? arr.map((v) => String(v ?? '')).join(sep) : ''
    }
    if (fn === 'formatdatetime') {
      const val = this.evalExpr(args[0], row, ctes)
      const d = new Date(String(val ?? ''))
      if (Number.isNaN(d.getTime())) return String(val ?? '')
      return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
    }
    if (fn === 'todatetime') {
      const val = this.evalExpr(args[0], row, ctes)
      if (typeof val === 'number') return new Date(val * 1000).toISOString()
      return String(val ?? '')
    }
    if (fn === 'todateornull') {
      const val = this.evalExpr(args[0], row, ctes)
      return parseMockIsoDate(val)
    }
    if (fn === 'parsedatetimebesteffortornull') {
      const val = this.evalExpr(args[0], row, ctes)
      return parseMockDateTimeBestEffort(val)
    }
    if (fn === 'todate') {
      const val = this.evalExpr(args[0], row, ctes)
      if (val === null || val === undefined) return null
      if (val === 0) return '1970-01-01'
      return parseMockIsoDate(val) ?? '1970-01-01'
    }
    return null
  }

  private containsAggregate(expr: ExprNode): boolean {
    if (expr.kind === 'call') {
      const fn = expr.name.toLowerCase()
      if (['count', 'countif', 'sum', 'uniq', 'uniqexact', 'groupuniqarray', 'max', 'min', 'any', 'argmax'].includes(fn)) return true
      return expr.args.some((a) => this.containsAggregate(a))
    }
    if (expr.kind === 'binary') return this.containsAggregate(expr.left) || this.containsAggregate(expr.right)
    if (expr.kind === 'unary') return this.containsAggregate(expr.expr)
    if (expr.kind === 'case') {
      return expr.branches.some((b) => this.containsAggregate(b.when) || this.containsAggregate(b.then))
        || Boolean(expr.elseExpr && this.containsAggregate(expr.elseExpr))
    }
    return false
  }

  private evalAggregateExpr(expr: ExprNode, groupRows: Record<string, unknown>[], ctes: Map<string, unknown>): unknown {
    if (expr.kind === 'call') {
      const fn = expr.name.toLowerCase()
      if (fn === 'count') return groupRows.length
      if (fn === 'countif') {
        return groupRows.filter((r) => toBool(this.evalExpr(expr.args[0], r, ctes))).length
      }
      if (fn === 'sum') {
        return groupRows.reduce((acc, r) => acc + Number(this.evalExpr(expr.args[0], r, ctes) ?? 0), 0)
      }
      if (fn === 'max') {
        const vals = groupRows.map((r) => this.evalExpr(expr.args[0], r, ctes)).filter((v) => v !== null && v !== undefined)
        if (!vals.length) return null
        return vals.reduce((acc, v) => (compareValues(v, acc) > 0 ? v : acc))
      }
      if (fn === 'min') {
        const vals = groupRows.map((r) => this.evalExpr(expr.args[0], r, ctes)).filter((v) => v !== null && v !== undefined)
        if (!vals.length) return null
        return vals.reduce((acc, v) => (compareValues(v, acc) < 0 ? v : acc))
      }
      if (fn === 'any') {
        for (const r of groupRows) {
          const v = this.evalExpr(expr.args[0], r, ctes)
          if (v !== null && v !== undefined) return v
        }
        return groupRows[0] ? this.evalExpr(expr.args[0], groupRows[0], ctes) : null
      }
      if (fn === 'argmax') {
        if (!groupRows.length) return null
        let bestVal = this.evalExpr(expr.args[0], groupRows[0], ctes)
        let bestWeight = this.evalExpr(expr.args[1], groupRows[0], ctes)
        for (let i = 1; i < groupRows.length; i += 1) {
          const w = this.evalExpr(expr.args[1], groupRows[i], ctes)
          if (compareValues(w, bestWeight) > 0) {
            bestWeight = w
            bestVal = this.evalExpr(expr.args[0], groupRows[i], ctes)
          }
        }
        return bestVal
      }
      if (fn === 'uniqexact' || fn === 'uniq') {
        const seen = new Set(groupRows.map((r) => JSON.stringify(this.evalExpr(expr.args[0], r, ctes))))
        return seen.size
      }
      if (fn === 'groupuniqarray') {
        const seen = new Set<string>()
        const out: unknown[] = []
        for (const r of groupRows) {
          const v = this.evalExpr(expr.args[0], r, ctes)
          const k = JSON.stringify(v)
          if (!seen.has(k)) {
            seen.add(k)
            out.push(v)
          }
        }
        return out
      }
    }
    if (expr.kind === 'binary') {
      const l = this.evalAggregateExpr(expr.left, groupRows, ctes)
      const r = this.evalAggregateExpr(expr.right, groupRows, ctes)
      if (expr.op === '+') return Number(l ?? 0) + Number(r ?? 0)
      if (expr.op === '-') return Number(l ?? 0) - Number(r ?? 0)
      if (expr.op === '*') return Number(l ?? 0) * Number(r ?? 0)
      if (expr.op === '/') return Number(r) === 0 ? 0 : Number(l ?? 0) / Number(r)
      if (expr.op === 'AND') return toBool(l) && toBool(r) ? 1 : 0
      if (expr.op === 'OR') return toBool(l) || toBool(r) ? 1 : 0
      if (expr.op === '>') return compareValues(l, r) > 0 ? 1 : 0
      if (expr.op === '<') return compareValues(l, r) < 0 ? 1 : 0
      if (expr.op === '>=') return compareValues(l, r) >= 0 ? 1 : 0
      if (expr.op === '<=') return compareValues(l, r) <= 0 ? 1 : 0
      if (expr.op === '=') return valuesEqual(l, r) ? 1 : 0
      if (expr.op === '!=') return valuesEqual(l, r) ? 0 : 1
    }
    if (expr.kind === 'unary') {
      const v = this.evalAggregateExpr(expr.expr, groupRows, ctes)
      if (expr.op === 'NOT') return toBool(v) ? 0 : 1
      if (expr.op === '-') return -Number(v ?? 0)
    }
    if (expr.kind === 'call' && this.containsAggregate(expr)) {
      const evaluatedArgs: ExprNode[] = expr.args.map((a) =>
        this.containsAggregate(a)
          ? { kind: 'literal', value: this.evalAggregateExpr(a, groupRows, ctes) }
          : a,
      )
      return this.evalCall(expr.name, evaluatedArgs, groupRows[0] ?? {}, ctes)
    }
    if (expr.kind === 'case' && this.containsAggregate(expr)) {
      for (const branch of expr.branches) {
        if (toBool(this.evalAggregateExpr(branch.when, groupRows, ctes))) {
          return this.evalAggregateExpr(branch.then, groupRows, ctes)
        }
      }
      return expr.elseExpr ? this.evalAggregateExpr(expr.elseExpr, groupRows, ctes) : null
    }
    return groupRows[0] ? this.evalExpr(expr, groupRows[0], ctes) : null
  }

  private evalFromSource(source: FromSource, ctes: Map<string, unknown>): EvalResult {
    if (source.kind === 'table') {
      return this.getTable(source.database, source.table)
    }
    return this.evalQuery(source.query, ctes)
  }

  private evalSelect(select: SelectQuery, ctes = new Map<string, unknown>()): EvalResult {
    const localCtes = new Map(ctes)
    if (select.withCte) {
      const cteRes = this.evalSelect(select.withCte.expr, localCtes)
      const firstCol = cteRes.columns[0]?.name
      const cteVal = firstCol ? cteRes.rows[0]?.[firstCol] : null
      localCtes.set(select.withCte.alias, cteVal)
    }

    const columnsByScope = new Map<string, MockColumn[]>()
    let input: EvalResult
    if (!select.from) {
      input = { columns: [], rows: [{}] }
    } else {
      const baseRes = this.evalFromSource(select.from, localCtes)
      const baseAlias = select.from.alias ?? (select.from.kind === 'table' ? select.from.table : undefined)
      if (baseAlias) columnsByScope.set(baseAlias, baseRes.columns)
      let currentColumns = [...baseRes.columns]
      let currentRows = baseRes.rows.map((r) => {
        const copy = { ...r }
        if (baseAlias) {
          const map = new Map<string, Record<string, unknown>>()
          map.set(baseAlias, r)
          this.rowScopes.set(copy, map)
        }
        return copy
      })

      for (const join of select.joins ?? []) {
        const rightRes = this.evalFromSource(join.source, localCtes)
        const rightAlias = join.source.alias ?? (join.source.kind === 'table' ? join.source.table : undefined)
        if (rightAlias) columnsByScope.set(rightAlias, rightRes.columns)
        const nullRightRow: Record<string, unknown> = {}
        for (const col of rightRes.columns) {
          nullRightRow[col.name] = null
        }

        const nextRows: Record<string, unknown>[] = []
        for (const leftRow of currentRows) {
          const leftScope = this.rowScopes.get(leftRow)
          let matchedAny = false

          for (const rightRow of rightRes.rows) {
            const combined: Record<string, unknown> = { ...leftRow, ...rightRow }
            const nextScope = new Map(leftScope ?? [])
            if (rightAlias) nextScope.set(rightAlias, rightRow)
            this.rowScopes.set(combined, nextScope)

            if (join.type === 'CROSS' || !join.on || toBool(this.evalExpr(join.on, combined, localCtes))) {
              matchedAny = true
              nextRows.push(combined)
            }
          }

          if (join.type === 'LEFT' && !matchedAny) {
            const combined: Record<string, unknown> = { ...leftRow, ...nullRightRow }
            const nextScope = new Map(leftScope ?? [])
            if (rightAlias) nextScope.set(rightAlias, nullRightRow)
            this.rowScopes.set(combined, nextScope)
            nextRows.push(combined)
          }
        }

        currentColumns = [...currentColumns, ...rightRes.columns]
        currentRows = nextRows
      }

      input = { columns: currentColumns, rows: currentRows }
    }

    let rows = input.rows
    if (select.where) {
      rows = rows.filter((r) => toBool(this.evalExpr(select.where!, r, localCtes)))
    }

    const dedupeOutputRows = (columns: MockColumn[], list: Record<string, unknown>[]): Record<string, unknown>[] => {
      if (!select.distinct) return list
      const seen = new Set<string>()
      const unique: Record<string, unknown>[] = []
      for (const r of list) {
        const k = JSON.stringify(columns.map((c) => r[c.name] ?? null))
        if (!seen.has(k)) {
          seen.add(k)
          unique.push(r)
        }
      }
      return unique
    }

    const hasWindow = select.projections.some((p) => p.kind === 'expr' && p.expr.kind === 'call' && p.expr.over)
    const hasAgg = Boolean(select.groupBy?.length) || select.projections.some((p) => p.kind === 'expr' && this.containsAggregate(p.expr))

    if (hasAgg) {
      const groups = new Map<string, Record<string, unknown>[]>()
      if (select.groupBy?.length) {
        for (const r of rows) {
          const key = JSON.stringify(select.groupBy.map((g) => this.evalExpr(g, r, localCtes)))
          const list = groups.get(key) ?? []
          list.push(r)
          groups.set(key, list)
        }
      } else {
        groups.set('__all__', rows)
      }

      const outColumns: MockColumn[] = []
      const outRows: Record<string, unknown>[] = []
      for (const proj of select.projections) {
        if (proj.kind === 'expr') {
          outColumns.push({ name: proj.alias, type: inferExprType(proj.expr, input.columns) })
        }
      }
      for (const groupRows of groups.values()) {
        const outRow: Record<string, unknown> = {}
        for (const proj of select.projections) {
          if (proj.kind === 'expr') {
            outRow[proj.alias] = this.evalAggregateExpr(proj.expr, groupRows, localCtes)
          }
        }
        if (select.having) {
          const enrichedGroup = groupRows.length ? groupRows.map((r) => ({ ...outRow, ...r })) : [outRow]
          if (!toBool(this.evalAggregateExpr(select.having, enrichedGroup, localCtes))) {
            continue
          }
        }
        outRows.push(outRow)
      }
      return this.applyPostClauses(select, outColumns, dedupeOutputRows(outColumns, outRows), localCtes)
    }

    // Handle window functions like row_number() OVER (...)
    const windowValues = new Map<string, unknown[]>()
    if (hasWindow) {
      for (const proj of select.projections) {
        if (proj.kind === 'expr' && proj.expr.kind === 'call' && proj.expr.over) {
          const over = proj.expr.over
          const indexed = rows.map((r, i) => ({ r, i }))
          indexed.sort((a, b) => {
            for (const item of over.orderBy) {
              const va = this.evalExpr(item.expr, a.r, localCtes)
              const vb = this.evalExpr(item.expr, b.r, localCtes)
              const cmp = compareValues(va, vb)
              if (cmp !== 0) return item.desc ? -cmp : cmp
            }
            return a.i - b.i
          })
          const counters = new Map<string, number>()
          const vals = new Array<unknown>(rows.length)
          for (const entry of indexed) {
            const partKey = JSON.stringify(over.partitionBy.map((e) => this.evalExpr(e, entry.r, localCtes)))
            const nextNum = (counters.get(partKey) ?? 0) + 1
            counters.set(partKey, nextNum)
            vals[entry.i] = nextNum
          }
          windowValues.set(proj.alias, vals)
        }
      }
    }

    const outColumns: MockColumn[] = []
    let builtColumns = false
    const outRows: Record<string, unknown>[] = []

    const starColsFor = (qualifier?: string): MockColumn[] => {
      if (qualifier && columnsByScope.has(qualifier)) return columnsByScope.get(qualifier)!
      return input.columns
    }

    const computeRow = (r: Record<string, unknown>, rowIndex: number): Record<string, unknown> => {
      const outRow: Record<string, unknown> = {}
      const scopes = this.rowScopes.get(r)
      for (const proj of select.projections) {
        if (proj.kind === 'star') {
          const exceptSet = new Set(proj.except)
          const replaceMap = new Map(proj.replace.map((item) => [item.alias, item.expr]))
          const scopedRow = proj.qualifier && scopes?.get(proj.qualifier) ? scopes.get(proj.qualifier)! : r
          for (const col of starColsFor(proj.qualifier)) {
            if (exceptSet.has(col.name)) continue
            const replaceExpr = replaceMap.get(col.name)
            if (replaceExpr) {
              outRow[col.name] = this.evalExpr(replaceExpr, r, localCtes)
              if (!builtColumns) {
                outColumns.push({ name: col.name, type: inferExprType(replaceExpr, input.columns) })
              }
            } else {
              outRow[col.name] = scopedRow[col.name]
              if (!builtColumns) outColumns.push({ ...col })
            }
          }
        } else {
          if (windowValues.has(proj.alias)) {
            outRow[proj.alias] = windowValues.get(proj.alias)![rowIndex]
          } else {
            outRow[proj.alias] = this.evalExpr(proj.expr, r, localCtes)
          }
          if (!builtColumns) {
            outColumns.push({ name: proj.alias, type: inferExprType(proj.expr, input.columns) })
          }
        }
      }
      builtColumns = true
      this.projectedSourceFallback.set(outRow, r)
      return outRow
    }

    if (rows.length === 0) {
      // Still resolve output column metadata even for 0 rows (needed for LIMIT 0)
      for (const proj of select.projections) {
        if (proj.kind === 'star') {
          const exceptSet = new Set(proj.except)
          const replaceMap = new Map(proj.replace.map((item) => [item.alias, item.expr]))
          for (const col of starColsFor(proj.qualifier)) {
            if (exceptSet.has(col.name)) continue
            const replaceExpr = replaceMap.get(col.name)
            outColumns.push({
              name: col.name,
              type: replaceExpr ? inferExprType(replaceExpr, input.columns) : col.type,
            })
          }
        } else {
          outColumns.push({ name: proj.alias, type: inferExprType(proj.expr, input.columns) })
        }
      }
    } else {
      rows.forEach((r, idx) => outRows.push(computeRow(r, idx)))
    }

    return this.applyPostClauses(select, outColumns, dedupeOutputRows(outColumns, outRows), localCtes)
  }

  private applyPostClauses(
    select: SelectQuery,
    columns: MockColumn[],
    rows: Record<string, unknown>[],
    ctes: Map<string, unknown>,
  ): EvalResult {
    let resultRows = rows
    if (select.qualify) {
      resultRows = resultRows.filter((r) => toBool(this.evalExpr(select.qualify!, r, ctes)))
    }
    if (select.orderBy?.length) {
      const orderBy = select.orderBy
      resultRows = [...resultRows].sort((a, b) => {
        for (const item of orderBy) {
          if (item.expr.kind === 'tuple' && item.expr.items.length === 0) continue
          const va = this.evalExpr(item.expr, a, ctes)
          const vb = this.evalExpr(item.expr, b, ctes)
          const cmp = compareValues(va, vb)
          if (cmp !== 0) return item.desc ? -cmp : cmp
        }
        return 0
      })
    }
    if (select.limit !== undefined) {
      if (select.limitBy?.length) {
        const limitBy = select.limitBy
        const counts = new Map<string, number>()
        const limited: Record<string, unknown>[] = []
        for (const r of resultRows) {
          const key = JSON.stringify(limitBy.map((e) => this.evalExpr(e, r, ctes)))
          const c = counts.get(key) ?? 0
          if (c < select.limit) {
            counts.set(key, c + 1)
            limited.push(r)
          }
        }
        resultRows = limited
      } else {
        const off = select.offset ?? 0
        resultRows = resultRows.slice(off, off + select.limit)
      }
    } else if (select.offset) {
      resultRows = resultRows.slice(select.offset)
    }

    return { columns, rows: resultRows }
  }

  private evalQuery(node: QueryNode, ctes = new Map<string, unknown>()): EvalResult {
    if (node.kind === 'select') {
      return this.evalSelect(node, ctes)
    }
    const parts = node.queries.map((q) => this.evalSelect(q, ctes))
    const columns = parts[0]?.columns ?? []
    const rows = parts.flatMap((p) => p.rows)
    return { columns, rows }
  }

  async query<T = unknown>({ query, query_params = {}, format }: QueryInput): Promise<{ json: <R = T>() => Promise<R> }> {
    const trimmed = query.trim()
    if (/^SHOW\s+CREATE\s+TABLE\s+/i.test(trimmed)) {
      const tokens = tokenize(trimmed.slice(trimmed.search(/\bTABLE\b/i) + 5))
      let database = 'default'
      let table = ''
      if (tokens.length >= 3 && tokens[1]?.type === 'punct' && tokens[1].value === '.') {
        database = tokens[0]?.type === 'ident' ? tokens[0].value : 'default'
        table = tokens[2]?.type === 'ident' ? tokens[2].value : ''
      } else if (tokens[0]?.type === 'ident') {
        table = tokens[0].value
      }
      const tbl = this.databases.get(database)?.get(table)
      if (!tbl) {
        throw new Error(`Table ${database}.${table} does not exist`)
      }
      const colsSql = tbl.columns.map((c) => `    ${quoteMockIdent(c.name)} ${c.type}`).join(',\n')
      const orderExpr = tbl.sorting_key && !/^tuple\(\)$/i.test(tbl.sorting_key.trim())
        ? tbl.sorting_key
        : 'tuple()'
      const statement = `CREATE TABLE ${quoteMockIdent(database)}.${quoteMockIdent(tbl.name)}\n(\n${colsSql}\n)\nENGINE = ${tbl.engine}\nORDER BY ${orderExpr}`
      return {
        json: async <R = T>() => {
          if (format === 'JSON') {
            return {
              meta: [{ name: 'statement', type: 'String' }],
              data: [{ statement }],
            } as unknown as R
          }
          return [{ statement }] as unknown as R
        },
      }
    }

    const tokens = tokenize(query)
    const parser = new SqlParser(tokens, query_params)
    const ast = parser.parseQuery()
    const result = this.evalQuery(ast)

    return {
      json: async <R = T>() => {
        if (format === 'JSON') {
          return {
            meta: result.columns.map(({ name, type }) => ({ name, type })),
            data: result.rows,
          } as unknown as R
        }
        return result.rows as unknown as R
      },
    }
  }

  async exec({ query, query_params = {}, clickhouse_settings = {}, abort_signal, query_id }: ExecInput): Promise<{ stream: Readable; query_id: string }> {
    const qid = query_id || randomUUID()
    if (abort_signal?.aborted) {
      throw new Error('Query aborted before execution')
    }

    const formatMatch = /\s+FORMAT\s+([A-Za-z0-9_]+)\s*;?\s*$/i.exec(query)
    const outFormat = formatMatch?.[1] ?? 'CSVWithNames'
    const sqlQuery = formatMatch ? query.slice(0, formatMatch.index) : query

    if (outFormat !== 'CSV' && outFormat !== 'CSVWithNames' && outFormat !== 'SQLInsert') {
      throw new Error(`Unsupported mock exec format: ${outFormat}`)
    }

    const tokens = tokenize(sqlQuery)
    const parser = new SqlParser(tokens, query_params)
    const ast = parser.parseQuery()
    const result = this.evalQuery(ast)

    const controller = new AbortController()
    const onAbort = () => controller.abort()
    abort_signal?.addEventListener('abort', onAbort, { once: true })
    this.activeQueries.set(qid, controller)

    const activeQueries = this.activeQueries
    const cols = result.columns

    const delimiter = typeof clickhouse_settings.format_csv_delimiter === 'string' && clickhouse_settings.format_csv_delimiter.length === 1
      ? clickhouse_settings.format_csv_delimiter
      : ','
    const nullRep = clickhouse_settings.format_csv_null_representation !== undefined
      ? String(clickhouse_settings.format_csv_null_representation)
      : '\\N'

    const sqlTableName = typeof clickhouse_settings.output_format_sql_insert_table_name === 'string' && clickhouse_settings.output_format_sql_insert_table_name
      ? clickhouse_settings.output_format_sql_insert_table_name
      : 'table'
    const sqlIncludeCols = Number(clickhouse_settings.output_format_sql_insert_include_column_names ?? 1) !== 0
    const sqlQuoteNames = Number(clickhouse_settings.output_format_sql_insert_quote_names ?? 1) !== 0
    const sqlBatchSize = Math.max(1, Number(clickhouse_settings.output_format_sql_insert_max_batch_size ?? 1000) || 1000)

    async function* generateChunks(): AsyncGenerator<Buffer> {
      try {
        if (outFormat === 'CSV' || outFormat === 'CSVWithNames') {
          if (outFormat === 'CSVWithNames') {
            if (controller.signal.aborted) throw new Error('Query was cancelled')
            const headerLine = `${cols.map((c) => formatMockCsvCell(c.name, delimiter, nullRep)).join(delimiter)}\n`
            yield Buffer.from(headerLine, 'utf8')
          }
          const chunkRows = 25
          for (let i = 0; i < result.rows.length; i += chunkRows) {
            if (controller.signal.aborted) throw new Error('Query was cancelled')
            const slice = result.rows.slice(i, i + chunkRows)
            let text = ''
            for (const row of slice) {
              text += `${cols.map((c) => formatMockCsvCell(row[c.name], delimiter, nullRep)).join(delimiter)}\n`
            }
            yield Buffer.from(text, 'utf8')
            await new Promise((resolve) => setImmediate(resolve))
          }
          return
        }

        const formattedTable = sqlQuoteNames ? quoteMockIdent(sqlTableName) : sqlTableName
        const colList = sqlIncludeCols
          ? ` (${cols.map((c) => (sqlQuoteNames ? quoteMockIdent(c.name) : c.name)).join(', ')})`
          : ''

        for (let i = 0; i < result.rows.length; i += sqlBatchSize) {
          if (controller.signal.aborted) throw new Error('Query was cancelled')
          const batch = result.rows.slice(i, i + sqlBatchSize)
          const tuples = batch
            .map((row) => `(${cols.map((c) => formatMockSqlValue(row[c.name])).join(', ')})`)
            .join(', ')
          yield Buffer.from(`INSERT INTO ${formattedTable}${colList} VALUES ${tuples};\n`, 'utf8')
          await new Promise((resolve) => setImmediate(resolve))
        }
      } finally {
        abort_signal?.removeEventListener('abort', onAbort)
        activeQueries.delete(qid)
      }
    }

    return {
      stream: Readable.from(generateChunks()),
      query_id: qid,
    }
  }

  async command({ query, query_params = {} }: CommandInput): Promise<void> {
    const trimmed = query.trim()

    if (/^KILL\s+QUERY/i.test(trimmed)) {
      const paramMatch = /\{([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(trimmed)
      const qid = paramMatch ? String(query_params[paramMatch[1]] ?? '') : ''
      if (qid && this.activeQueries.has(qid)) {
        this.activeQueries.get(qid)?.abort()
      }
      return
    }

    if (/^CREATE\s+DATABASE/i.test(trimmed)) {
      const tokens = tokenize(trimmed)
      const dbTok = tokens[tokens.length - 1]
      if (dbTok?.type === 'ident') {
        if (!this.databases.has(dbTok.value)) {
          this.databases.set(dbTok.value, new Map())
        }
      }
      return
    }

    if (/^RENAME\s+TABLE/i.test(trimmed)) {
      const tokens = tokenize(trimmed)
      // Expected: RENAME TABLE db1 . tbl1 TO db2 . tbl2
      let i = 2
      const srcDbTok = tokens[i]
      const srcTblTok = tokens[i + 2]
      i += 3
      if (tokens[i]?.type === 'ident' && tokens[i].value.toUpperCase() === 'TO') {
        i += 1
      }
      const dstDbTok = tokens[i]
      const dstTblTok = tokens[i + 2]
      const srcDatabase = srcDbTok?.type === 'ident' ? srcDbTok.value : 'default'
      const srcTable = srcTblTok?.type === 'ident' ? srcTblTok.value : ''
      const dstDatabase = dstDbTok?.type === 'ident' ? dstDbTok.value : 'default'
      const dstTable = dstTblTok?.type === 'ident' ? dstTblTok.value : ''

      const srcDb = this.databases.get(srcDatabase)
      const tbl = srcDb?.get(srcTable)
      if (!tbl) {
        throw new Error(`Table ${srcDatabase}.${srcTable} does not exist`)
      }
      if (!this.databases.has(dstDatabase)) this.databases.set(dstDatabase, new Map())
      const dstDb = this.databases.get(dstDatabase)!
      if (dstDb.has(dstTable)) {
        throw new Error(`Table ${dstDatabase}.${dstTable} already exists`)
      }
      srcDb!.delete(srcTable)
      dstDb.set(dstTable, { ...tbl, name: dstTable })
      return
    }

    if (/^DROP\s+TABLE/i.test(trimmed)) {
      const tokens = tokenize(trimmed)
      let i = 2
      const ifExists = tokens[i]?.type === 'ident' && tokens[i].value.toUpperCase() === 'IF'
      if (ifExists) i += 2
      const dbTok = tokens[i]
      const tblTok = tokens[i + 2]
      const database = dbTok?.type === 'ident' ? dbTok.value : 'default'
      const table = tblTok?.type === 'ident' ? tblTok.value : ''
      const db = this.databases.get(database)
      if (!db?.has(table)) {
        if (ifExists) return
        throw new Error(`Table ${database}.${table} does not exist`)
      }
      db.delete(table)
      return
    }

    if (/^CREATE\s+TABLE/i.test(trimmed)) {
      const tokens = tokenize(trimmed)
      let i = 2
      const ifNotExists = tokens[i]?.type === 'ident' && tokens[i].value.toUpperCase() === 'IF'
      if (ifNotExists) i += 3
      const dbTok = tokens[i]
      const tblTok = tokens[i + 2]
      const database = dbTok?.type === 'ident' ? dbTok.value : 'default'
      const table = tblTok?.type === 'ident' ? tblTok.value : ''
      const afterTableIndex = i + 3

      const isColumnListCreate = tokens[afterTableIndex]?.type === 'punct' && tokens[afterTableIndex].value === '('
      if (!isColumnListCreate) {
        const asTokenIndex = tokens.findIndex(
          (tok, idx) => idx >= afterTableIndex && tok.type === 'ident' && tok.value.toUpperCase() === 'AS',
        )
        if (asTokenIndex !== -1) {
          let engine = 'MergeTree'
          let sorting_key = 'tuple()'
          const headerTokens = tokens.slice(afterTableIndex, asTokenIndex)
          for (let h = 0; h < headerTokens.length; h += 1) {
            const tok = headerTokens[h]
            if (tok?.type === 'ident' && tok.value.toUpperCase() === 'ENGINE') {
              const nextTok = headerTokens[h + 1]?.type === 'op' && headerTokens[h + 1].value === '='
                ? headerTokens[h + 2]
                : headerTokens[h + 1]
              if (nextTok?.type === 'ident') engine = nextTok.value
            }
            if (
              tok?.type === 'ident'
              && tok.value.toUpperCase() === 'ORDER'
              && headerTokens[h + 1]?.type === 'ident'
              && headerTokens[h + 1].value.toUpperCase() === 'BY'
            ) {
              const orderTok = headerTokens[h + 2]
              if (orderTok?.type === 'ident') {
                sorting_key = orderTok.value.toUpperCase() === 'TUPLE' ? 'tuple()' : orderTok.value
              }
            }
          }

          const selectParser = new SqlParser(tokens.slice(asTokenIndex + 1), query_params)
          const ast = selectParser.parseQuery()
          const res = this.evalQuery(ast)

          if (!this.databases.has(database)) this.databases.set(database, new Map())
          const db = this.databases.get(database)!
          if (db.has(table)) {
            if (ifNotExists) return
            throw new Error(`Table ${database}.${table} already exists`)
          }
          db.set(table, {
            name: table,
            engine,
            sorting_key,
            columns: res.columns.map((c) => ({ ...c })),
            rows: res.rows.map((r) => ({ ...r })),
          })
          return
        }
      }

      const openParen = trimmed.indexOf('(')
      const closeParen = findMatchingParen(trimmed, openParen)
      const colDefs = splitTopLevelComma(trimmed.slice(openParen + 1, closeParen))
      const columns: MockColumn[] = colDefs.map((def) => {
        const colTokens = tokenize(def)
        const colName = colTokens[0]?.type === 'ident' ? colTokens[0].value : 'col'
        const rest = def.slice(def.indexOf(colName) + colName.length + (def.trimStart().startsWith('`') ? 2 : 0)).trim()
        return { name: colName, type: rest || 'String' }
      })

      const after = trimmed.slice(closeParen + 1)
      const afterNoSettings = after.replace(/\s+SETTINGS\s+[\s\S]*$/i, '')
      const engineMatch = /ENGINE\s*=?\s*([A-Za-z0-9_]+)/i.exec(afterNoSettings)
      const orderMatch = /ORDER\s+BY\s+(.+)$/i.exec(afterNoSettings)
      const engine = engineMatch?.[1] ?? 'MergeTree'
      const sorting_key = orderMatch?.[1]?.replace(/`/g, '').trim() ?? 'tuple()'

      if (!this.databases.has(database)) this.databases.set(database, new Map())
      const db = this.databases.get(database)!
      if (db.has(table)) {
        if (ifNotExists) return
        throw new Error(`Table ${database}.${table} already exists`)
      }
      db.set(table, { name: table, engine, sorting_key, columns, rows: [] })
      return
    }

    if (/^INSERT\s+INTO/i.test(trimmed)) {
      const tokens = tokenize(trimmed)
      let i = 2
      const dbTok = tokens[i]
      const tblTok = tokens[i + 2]
      const database = dbTok?.type === 'ident' ? dbTok.value : 'default'
      const table = tblTok?.type === 'ident' ? tblTok.value : ''
      const tbl = this.databases.get(database)?.get(table)
      if (!tbl) throw new Error(`Target table ${database}.${table} not found`)

      i += 3
      let colNames = tbl.columns.map((c) => c.name)
      if (tokens[i]?.type === 'punct' && tokens[i].value === '(') {
        colNames = []
        i += 1
        while (i < tokens.length && !(tokens[i].type === 'punct' && tokens[i].value === ')')) {
          if (tokens[i].type === 'ident') colNames.push((tokens[i] as { value: string }).value)
          i += 1
        }
        i += 1
      }

      if (tokens[i]?.type === 'ident' && tokens[i].value.toUpperCase() === 'VALUES') {
        const valuesParser = new SqlParser(tokens.slice(i + 1), query_params)
        valuesParser.expectPunct('(')
        const row: Record<string, unknown> = {}
        let idx = 0
        if (!valuesParser.matchPunct(')')) {
          do {
            const expr = valuesParser.parseExpr()
            const col = colNames[idx] ?? `col_${idx}`
            row[col] = this.evalExpr(expr, {}, new Map())
            idx += 1
          } while (valuesParser.matchPunct(','))
          valuesParser.expectPunct(')')
        }
        tbl.rows.push(row)
        return
      }

      const selectParser = new SqlParser(tokens.slice(i), query_params)
      const ast = selectParser.parseQuery()
      const res = this.evalQuery(ast)
      for (const r of res.rows) {
        const record: Record<string, unknown> = {}
        for (const col of tbl.columns) {
          record[col.name] = defaultValueForMockType(col.type)
        }
        colNames.forEach((colName, idx) => {
          const sourceKey = res.columns[idx]?.name ?? colName
          const val = sourceKey in r ? r[sourceKey] : r[colName]
          record[colName] = val === undefined ? record[colName] : val
        })
        tbl.rows.push(record)
      }
    }
  }

  async insert({ table, values, format = 'CSVWithNames', columns, clickhouse_settings = {} }: InsertInput): Promise<void> {
    const tblTokens = tokenize(table)
    let database = 'default'
    let tableName = ''
    if (tblTokens.length >= 3 && tblTokens[1]?.type === 'punct' && tblTokens[1].value === '.') {
      database = tblTokens[0]?.type === 'ident' ? tblTokens[0].value : 'default'
      tableName = tblTokens[2]?.type === 'ident' ? tblTokens[2].value : ''
    } else if (tblTokens[0]?.type === 'ident') {
      tableName = tblTokens[0].value
    }

    const tbl = this.databases.get(database)?.get(tableName)
    if (!tbl) {
      throw new Error(`Target table ${database}.${tableName} not found`)
    }

    const targetColumns = columns?.length
      ? columns.map((col) => {
          const toks = tokenize(col)
          return toks[0]?.type === 'ident' ? toks[0].value : col
        })
      : tbl.columns.map((c) => c.name)

    const knownCols = new Set(tbl.columns.map((c) => c.name))
    for (const col of targetColumns) {
      if (!knownCols.has(col)) {
        throw new Error(`Column ${col} does not exist in ${database}.${tableName}`)
      }
    }

    let rawText = ''
    if (typeof values === 'string') {
      rawText = values
    } else if (Buffer.isBuffer(values)) {
      rawText = values.toString('utf8')
    } else {
      const chunks: Buffer[] = []
      for await (const chunk of values) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      rawText = Buffer.concat(chunks).toString('utf8')
    }

    if (rawText.startsWith('\uFEFF')) {
      rawText = rawText.slice(1)
    }

    if (format !== 'CSVWithNames' && format !== 'CSV') {
      throw new Error(`Unsupported mock insert format: ${format}`)
    }

    const delimiterSetting = clickhouse_settings.format_csv_delimiter
    const delimiter = typeof delimiterSetting === 'string' && delimiterSetting.length === 1
      ? delimiterSetting
      : ','

    const parsed = Papa.parse<string[]>(rawText, {
      delimiter,
      header: false,
      skipEmptyLines: true,
    })

    if (parsed.errors.length > 0) {
      throw new Error(`Malformed CSV payload: ${parsed.errors[0]?.message ?? 'unknown error'}`)
    }

    const allRows = parsed.data
    let dataRows = allRows
    const skipFirstLines = Number(clickhouse_settings.input_format_csv_skip_first_lines ?? 0)
    if (skipFirstLines > 0) {
      dataRows = allRows.slice(skipFirstLines)
    } else if (format === 'CSVWithNames') {
      if (allRows.length === 0) {
        throw new Error('CSVWithNames payload has no header row')
      }
      const header = allRows[0] ?? []
      if (clickhouse_settings.input_format_csv_allow_variable_number_of_columns === 0 && header.length !== targetColumns.length) {
        throw new Error('CSV header column count mismatch')
      }
      dataRows = allRows.slice(1)
    }

    const strictCols = clickhouse_settings.input_format_csv_allow_variable_number_of_columns === 0
    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx += 1) {
      const row = dataRows[rowIdx] ?? []
      if (strictCols && row.length !== targetColumns.length) {
        throw new Error(`CSV row ${rowIdx + 1} has ${row.length} columns, expected ${targetColumns.length}`)
      }
    }

    const nullRep = clickhouse_settings.format_csv_null_representation !== undefined
      ? String(clickhouse_settings.format_csv_null_representation)
      : '\\N'

    for (const row of dataRows) {
      const record: Record<string, unknown> = {}
      for (const col of tbl.columns) {
        record[col.name] = defaultValueForMockType(col.type)
      }
      targetColumns.forEach((colName, idx) => {
        const rawVal = row[idx] ?? ''
        const colDef = tbl.columns.find((c) => c.name === colName)
        if (colDef && colDef.type.startsWith('Nullable(') && rawVal === nullRep) {
          record[colName] = null
        } else {
          record[colName] = rawVal
        }
      })
      tbl.rows.push(record)
    }
  }
}

function findMatchingParen(str: string, openIndex: number): number {
  let depth = 0
  let inQuote = false
  for (let i = openIndex; i < str.length; i += 1) {
    const ch = str[i]
    if (ch === "'" && str[i - 1] !== '\\') inQuote = !inQuote
    if (inQuote) continue
    if (ch === '(') depth += 1
    else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return str.length - 1
}

function splitTopLevelComma(str: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i]
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(str.slice(start, i).trim())
      start = i + 1
    }
  }
  const tail = str.slice(start).trim()
  if (tail) parts.push(tail)
  return parts
}

function quoteMockIdent(name: string): string {
  return `\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
}

function formatMockCsvCell(value: unknown, delimiter: string, nullRep: string): string {
  if (value === null || value === undefined) {
    return nullRep
  }
  const str = typeof value === 'object' ? (JSON.stringify(value) ?? '') : String(value)
  if (str === '') {
    return '""'
  }
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function formatMockSqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  const str = typeof value === 'object' ? (JSON.stringify(value) ?? '') : String(value)
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0')
  return `'${escaped}'`
}

let mockClientInstance: MockClickHouseClient | null = null

export function useMockClickHouse(): MockClickHouseClient {
  if (!mockClientInstance) {
    mockClientInstance = new MockClickHouseClient()
  }
  return mockClientInstance
}
