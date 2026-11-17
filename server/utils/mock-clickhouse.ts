import { randomUUID } from 'node:crypto'

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
}

type CommandInput = {
  query: string
  query_params?: Record<string, unknown>
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
  | { kind: 'ident'; name: string }
  | { kind: 'call'; name: string; args: ExprNode[]; over?: { partitionBy: ExprNode[]; orderBy: OrderItem[] } }
  | { kind: 'unary'; op: string; expr: ExprNode }
  | { kind: 'binary'; op: string; left: ExprNode; right: ExprNode }
  | { kind: 'in'; left: ExprNode; values: ExprNode[]; not?: boolean }
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
  | { kind: 'star'; except: string[]; replace: Array<{ expr: ExprNode; alias: string }> }
  | { kind: 'expr'; expr: ExprNode; alias: string }

type SelectQuery = {
  kind: 'select'
  withCte?: { expr: SelectQuery; alias: string }
  projections: SelectProjection[]
  from?: { kind: 'table'; database: string; table: string } | { kind: 'subquery'; query: QueryNode }
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
          else if (next === 's') val += '\\s'
          else val += next
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

    const projections: SelectProjection[] = []
    do {
      if (this.matchOp('*')) {
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
        projections.push({ kind: 'star', except, replace })
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

    let from: SelectQuery['from']
    if (this.matchKeyword('FROM')) {
      if (this.matchPunct('(')) {
        const sub = this.parseQuery()
        this.expectPunct(')')
        from = { kind: 'subquery', query: sub }
      } else {
        const firstTok = this.next()
        const firstName = firstTok?.type === 'ident' ? firstTok.value : ''
        if (this.matchPunct('.')) {
          const secondTok = this.next()
          const secondName = secondTok?.type === 'ident' ? secondTok.value : ''
          from = { kind: 'table', database: firstName, table: secondName }
        } else {
          from = { kind: 'table', database: 'default', table: firstName }
        }
      }
      this.matchKeyword('FINAL')
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
      withCte,
      projections,
      from,
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
        const values = this.parseInList()
        left = { kind: 'in', left, values, not: true }
      } else if (this.matchKeyword('IN')) {
        const values = this.parseInList()
        left = { kind: 'in', left, values, not: false }
      } else {
        break
      }
    }
    return left
  }

  private parseInList(): ExprNode[] {
    this.expectPunct('(')
    const values: ExprNode[] = []
    if (!this.matchPunct(')')) {
      do {
        values.push(this.parseExpr())
      } while (this.matchPunct(','))
      this.expectPunct(')')
    }
    return values
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
  if (/^DateTime/i.test(base)) {
    const d = new Date(str)
    if (Number.isNaN(d.getTime())) return strict ? null : str
    return d.toISOString()
  }
  return str
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
    if (fn === 'row_number' || fn === 'count' || fn === 'countif' || fn === 'uniqexact') return 'UInt64'
    if (fn === 'isnull' || fn === 'notempty' || fn === 'startswith' || fn === 'match') return 'UInt8'
    if (fn === 'position' || fn === 'positioncaseinsensitiveutf8' || fn === 'lengthutf8' || fn === 'length') return 'UInt64'
    if (fn === 'cast' && expr.args[1]?.kind === 'literal') return String(expr.args[1].value)
    if (fn === 'if' && expr.args.length >= 3) {
      const t1 = inferExprType(expr.args[1], inputColumns)
      const t2 = inferExprType(expr.args[2], inputColumns)
      if (t1 === 'Nullable(Nothing)') return t2.startsWith('Nullable(') ? t2 : `Nullable(${t2})`
      if (t2 === 'Nullable(Nothing)') return t1.startsWith('Nullable(') ? t1 : `Nullable(${t1})`
      return t1
    }
    if (fn === 'trimboth' || fn === 'upperutf8' || fn === 'lowerutf8' || fn === 'initcap' || fn === 'replaceregexpall') {
      return expr.args[0] ? inferExprType(expr.args[0], inputColumns) : 'String'
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

export class MockClickHouseClient {
  private databases = createInitialDatabases()

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
      case 'ident':
        if (expr.name in row) return row[expr.name]
        if (ctes.has(expr.name)) return ctes.get(expr.name)
        return undefined
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
        if (expr.values.length === 1) {
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
      return String(v).toLowerCase().replace(/(^|\s)\S/g, (ch) => ch.toUpperCase())
    }
    if (fn === 'replaceregexpall') {
      const v = this.evalExpr(args[0], row, ctes)
      if (v === null || v === undefined) return null
      const pat = String(this.evalExpr(args[1], row, ctes) ?? '')
      const rep = String(this.evalExpr(args[2], row, ctes) ?? '')
      return String(v).replace(new RegExp(pat, 'g'), rep)
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
    return null
  }

  private containsAggregate(expr: ExprNode): boolean {
    if (expr.kind === 'call') {
      const fn = expr.name.toLowerCase()
      if (['count', 'countif', 'sum', 'uniqexact', 'groupuniqarray'].includes(fn)) return true
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
      if (fn === 'uniqexact') {
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
    return groupRows[0] ? this.evalExpr(expr, groupRows[0], ctes) : null
  }

  private evalSelect(select: SelectQuery, ctes = new Map<string, unknown>()): EvalResult {
    const localCtes = new Map(ctes)
    if (select.withCte) {
      const cteRes = this.evalSelect(select.withCte.expr, localCtes)
      const firstCol = cteRes.columns[0]?.name
      const cteVal = firstCol ? cteRes.rows[0]?.[firstCol] : null
      localCtes.set(select.withCte.alias, cteVal)
    }

    let input: EvalResult
    if (!select.from) {
      input = { columns: [], rows: [{}] }
    } else if (select.from.kind === 'table') {
      input = this.getTable(select.from.database, select.from.table)
    } else {
      input = this.evalQuery(select.from.query, localCtes)
    }

    let rows = input.rows
    if (select.where) {
      rows = rows.filter((r) => toBool(this.evalExpr(select.where!, r, localCtes)))
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
      return this.applyPostClauses(select, outColumns, outRows, localCtes)
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

    const computeRow = (r: Record<string, unknown>, rowIndex: number): Record<string, unknown> => {
      const outRow: Record<string, unknown> = {}
      for (const proj of select.projections) {
        if (proj.kind === 'star') {
          const exceptSet = new Set(proj.except)
          const replaceMap = new Map(proj.replace.map((item) => [item.alias, item.expr]))
          for (const col of input.columns) {
            if (exceptSet.has(col.name)) continue
            const replaceExpr = replaceMap.get(col.name)
            if (replaceExpr) {
              outRow[col.name] = this.evalExpr(replaceExpr, r, localCtes)
              if (!builtColumns) {
                outColumns.push({ name: col.name, type: inferExprType(replaceExpr, input.columns) })
              }
            } else {
              outRow[col.name] = r[col.name]
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
      return outRow
    }

    if (rows.length === 0) {
      // Still resolve output column metadata even for 0 rows (needed for LIMIT 0)
      for (const proj of select.projections) {
        if (proj.kind === 'star') {
          const exceptSet = new Set(proj.except)
          const replaceMap = new Map(proj.replace.map((item) => [item.alias, item.expr]))
          for (const col of input.columns) {
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

    return this.applyPostClauses(select, outColumns, outRows, localCtes)
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

  async command({ query, query_params = {} }: CommandInput): Promise<void> {
    const trimmed = query.trim()

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

    if (/^CREATE\s+TABLE/i.test(trimmed)) {
      const tokens = tokenize(trimmed)
      let i = 2
      if (tokens[i]?.type === 'ident' && tokens[i].value.toUpperCase() === 'IF') i += 3
      const dbTok = tokens[i]
      const tblTok = tokens[i + 2]
      const database = dbTok?.type === 'ident' ? dbTok.value : 'default'
      const table = tblTok?.type === 'ident' ? tblTok.value : ''

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
      const engineMatch = /ENGINE\s*=?\s*([A-Za-z0-9_]+)/i.exec(after)
      const orderMatch = /ORDER\s+BY\s+(.+)$/i.exec(after)
      const engine = engineMatch?.[1] ?? 'MergeTree'
      const sorting_key = orderMatch?.[1]?.replace(/`/g, '').trim() ?? 'tuple()'

      if (!this.databases.has(database)) this.databases.set(database, new Map())
      const db = this.databases.get(database)!
      if (!db.has(table) || !/IF\s+NOT\s+EXISTS/i.test(trimmed)) {
        db.set(table, { name: table, engine, sorting_key, columns, rows: [] })
      }
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
        tbl.rows.push({ ...r })
      }
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

let mockClientInstance: MockClickHouseClient | null = null

export function useMockClickHouse(): MockClickHouseClient {
  if (!mockClientInstance) {
    mockClientInstance = new MockClickHouseClient()
  }
  return mockClientInstance
}
