import type {
  DrawingColor,
  DrawingPath,
  DrawingPoint,
  DrawingText,
  SchemeDrawing,
} from '@eow/import/application'
import { PdfFile } from './pdf-file'
import { loadFont, type PdfFont } from './pdf-font'
import { PdfLexer, PdfSyntaxError, asName, asNumber, type PdfObject } from './pdf-syntax'

type Matrix = readonly [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const BLACK: DrawingColor = [0, 0, 0]
// A scheme sheet has a few thousand drawing operators; the limits only stop hostile input.
const MAX_OPERATORS = 2_000_000
const MAX_FORM_DEPTH = 8
const BEZIER_STEPS = 4

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
]
const apply = (m: Matrix, x: number, y: number): readonly [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
]
const scaleOf = (m: Matrix): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

interface GraphicsState {
  ctm: Matrix
  lineWidth: number
  dash: readonly number[]
  stroke: DrawingColor
  fill: DrawingColor
  font: PdfFont | undefined
  fontSize: number
  charSpacing: number
  wordSpacing: number
  horizontalScale: number
  leading: number
  rise: number
}

/** Reads the first page of a scheme PDF into paths and text runs in sheet points, y down. */
export function readSchemeDrawing(bytes: Uint8Array): SchemeDrawing {
  const file = new PdfFile(bytes)
  const page = firstPage(file)
  const box = inherited(file, page, 'MediaBox')
  const corners = box?.kind === 'array' ? box.items.map((i) => asNumber(file.resolve(i))) : []
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = corners
  if (!(x1 > x0 && y1 > y0)) throw new PdfSyntaxError('У листа PDF нет размеров (MediaBox).')
  const interpreter = new ContentInterpreter(file, x1 - x0, [1, 0, 0, -1, -x0, y1])
  const contents = file.resolve(dictEntry(page, 'Contents'))
  const parts =
    contents?.kind === 'array' ? contents.items : [dictEntry(page, 'Contents') ?? { kind: 'null' }]
  const data = concat(parts.map((p) => file.stream(p)?.data ?? new Uint8Array()))
  interpreter.run(data, inherited(file, page, 'Resources'), 0)
  return interpreter.result(y1 - y0)
}

function dictEntry(obj: PdfObject | undefined, key: string): PdfObject | undefined {
  return obj?.kind === 'dict' ? obj.entries.get(key) : undefined
}

function firstPage(file: PdfFile): PdfObject {
  let node = file.get(file.get(file.trailer, 'Root'), 'Pages')
  for (let depth = 0; depth < 32 && node; depth++) {
    if (asName(file.get(node, 'Type')) === 'Page') return node
    const kids = file.get(node, 'Kids')
    node = file.resolve(kids?.kind === 'array' ? kids.items[0] : undefined)
  }
  throw new PdfSyntaxError('В PDF нет страниц.')
}

function inherited(file: PdfFile, page: PdfObject, key: string): PdfObject | undefined {
  let node: PdfObject | undefined = page
  for (let depth = 0; depth < 32 && node; depth++) {
    const value = file.get(node, key)
    if (value) return value
    node = file.get(node, 'Parent')
  }
  return undefined
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    out[at + p.length] = 10
    at += p.length + 1
  }
  return out
}

const gray = (v: number): DrawingColor => [v, v, v]
function color(values: readonly number[]): DrawingColor {
  const [a = 0, b = 0, c = 0, d = 0] = values
  if (values.length === 1) return gray(a)
  if (values.length === 3) return [a, b, c]
  if (values.length === 4) return [(1 - a) * (1 - d), (1 - b) * (1 - d), (1 - c) * (1 - d)]
  return BLACK
}

class ContentInterpreter {
  private readonly paths: DrawingPath[] = []
  private readonly texts: DrawingText[] = []
  private readonly fonts = new Map<string | PdfObject, PdfFont>()
  private state: GraphicsState
  private readonly stack: GraphicsState[] = []
  private subpaths: DrawingPoint[][] = []
  private current: DrawingPoint[] | undefined
  private start: DrawingPoint | undefined
  private textMatrix: Matrix = IDENTITY
  private lineMatrix: Matrix = IDENTITY
  private operators = 0

  constructor(
    private readonly file: PdfFile,
    private readonly width: number,
    base: Matrix,
  ) {
    this.state = {
      ctm: base,
      lineWidth: 1,
      dash: [],
      stroke: BLACK,
      fill: BLACK,
      font: undefined,
      fontSize: 0,
      charSpacing: 0,
      wordSpacing: 0,
      horizontalScale: 1,
      leading: 0,
      rise: 0,
    }
  }

  result(height: number): SchemeDrawing {
    return { width: this.width, height, paths: this.paths, texts: this.texts }
  }

  run(data: Uint8Array, resources: PdfObject | undefined, depth: number): void {
    const lexer = new PdfLexer(data)
    const operands: PdfObject[] = []
    for (;;) {
      const t = lexer.token()
      if (!t) return
      if (t.kind !== 'op' || t.value === '[' || t.value === '<<') {
        operands.push(t.kind === 'op' ? lexer.complete(t, 0) : t)
        continue
      }
      if (++this.operators > MAX_OPERATORS)
        throw new PdfSyntaxError('В листе PDF слишком много операций.')
      if (t.value === 'BI') {
        skipInlineImage(lexer)
      } else this.execute(t.value, operands, resources, depth)
      operands.length = 0
    }
  }

  private execute(
    op: string,
    args: readonly PdfObject[],
    resources: PdfObject | undefined,
    depth: number,
  ): void {
    const n = (i: number): number => asNumber(args[i]) ?? 0
    const nums = (): number[] => args.map((a) => asNumber(a) ?? 0)
    const s = this.state
    switch (op) {
      case 'q':
        this.stack.push({ ...s })
        return
      case 'Q':
        this.state = this.stack.pop() ?? s
        return
      case 'cm':
        s.ctm = multiply([n(0), n(1), n(2), n(3), n(4), n(5)], s.ctm)
        return
      case 'w':
        s.lineWidth = n(0)
        return
      case 'd': {
        const arr = args[0]
        s.dash = arr?.kind === 'array' ? arr.items.map((i) => asNumber(i) ?? 0) : []
        return
      }
      case 'gs':
        this.extGState(resources, args[0])
        return
      case 'RG':
      case 'G':
      case 'K':
      case 'SC':
      case 'SCN':
        s.stroke = color(nums())
        return
      case 'rg':
      case 'g':
      case 'k':
      case 'sc':
      case 'scn':
        s.fill = color(nums())
        return
      case 'CS':
        s.stroke = BLACK
        return
      case 'cs':
        s.fill = BLACK
        return
      default:
        if (this.pathOp(op, n)) return
        if (this.paintOp(op)) return
        this.textOp(op, args, n, resources, depth)
    }
  }

  private extGState(resources: PdfObject | undefined, name: PdfObject | undefined): void {
    const key = asName(name)
    if (!key) return
    const gs = this.file.get(this.file.get(resources, 'ExtGState'), key)
    const lw = asNumber(this.file.get(gs, 'LW'))
    if (lw !== undefined) this.state.lineWidth = lw
  }

  private point(x: number, y: number): DrawingPoint {
    const [px, py] = apply(this.state.ctm, x, y)
    return { x: px, y: py }
  }

  private pathOp(op: string, n: (i: number) => number): boolean {
    switch (op) {
      case 'm':
        this.current = [this.point(n(0), n(1))]
        this.subpaths.push(this.current)
        this.start = this.current[0]
        return true
      case 'l':
        this.lineTo(this.point(n(0), n(1)))
        return true
      case 'c':
        this.curve(this.point(n(0), n(1)), this.point(n(2), n(3)), this.point(n(4), n(5)))
        return true
      case 'v': {
        const from = this.current?.at(-1)
        if (from) this.curve(from, this.point(n(0), n(1)), this.point(n(2), n(3)))
        return true
      }
      case 'y': {
        const end = this.point(n(2), n(3))
        this.curve(this.point(n(0), n(1)), end, end)
        return true
      }
      case 'h':
        if (this.current && this.start) this.current.push(this.start)
        return true
      case 're': {
        const [x, y, w, h] = [n(0), n(1), n(2), n(3)]
        const corners = [
          this.point(x, y),
          this.point(x + w, y),
          this.point(x + w, y + h),
          this.point(x, y + h),
        ]
        const first = corners[0] ?? this.point(x, y)
        this.subpaths.push([...corners, first])
        this.current = undefined
        return true
      }
      default:
        return false
    }
  }

  private lineTo(p: DrawingPoint): void {
    if (!this.current) {
      this.current = [p]
      this.subpaths.push(this.current)
      this.start = p
      return
    }
    this.current.push(p)
  }

  /** Curves only draw signal lamps and arcs on schemes; a few chords are enough. */
  private curve(c1: DrawingPoint, c2: DrawingPoint, end: DrawingPoint): void {
    const from = this.current?.at(-1)
    if (!from) return this.lineTo(end)
    for (let i = 1; i <= BEZIER_STEPS; i++) {
      const t = i / BEZIER_STEPS,
        u = 1 - t
      this.lineTo({
        x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
        y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
      })
    }
  }

  private paintOp(op: string): boolean {
    const modes: Record<string, readonly [boolean, boolean, boolean]> = {
      S: [true, false, false],
      s: [true, false, true],
      f: [false, true, true],
      F: [false, true, true],
      'f*': [false, true, true],
      B: [true, true, true],
      'B*': [true, true, true],
      b: [true, true, true],
      'b*': [true, true, true],
      n: [false, false, false],
    }
    const mode = modes[op]
    if (!mode) return op === 'W' || op === 'W*'
    const [stroke, fill, close] = mode
    if (close)
      for (const sp of this.subpaths) {
        const first = sp[0],
          last = sp.at(-1)
        if (first && last && sp.length > 2 && (first.x !== last.x || first.y !== last.y))
          sp.push(first)
      }
    const subpaths = this.subpaths.filter((sp) => sp.length > 0)
    if ((stroke || fill) && subpaths.length) {
      const scale = scaleOf(this.state.ctm)
      this.paths.push({
        subpaths,
        stroke: stroke ? this.state.stroke : null,
        fill: fill ? this.state.fill : null,
        width: this.state.lineWidth * scale,
        dash: this.state.dash.map((v) => v * scale),
      })
    }
    this.subpaths = []
    this.current = undefined
    this.start = undefined
    return true
  }

  private textOp(
    op: string,
    args: readonly PdfObject[],
    n: (i: number) => number,
    resources: PdfObject | undefined,
    depth: number,
  ): void {
    const s = this.state
    switch (op) {
      case 'BT':
        this.textMatrix = IDENTITY
        this.lineMatrix = IDENTITY
        return
      case 'Tf': {
        const name = asName(args[0]) ?? ''
        s.font = this.font(resources, name)
        s.fontSize = n(1)
        return
      }
      case 'Tc':
        s.charSpacing = n(0)
        return
      case 'Tw':
        s.wordSpacing = n(0)
        return
      case 'Tz':
        s.horizontalScale = n(0) / 100
        return
      case 'TL':
        s.leading = n(0)
        return
      case 'Ts':
        s.rise = n(0)
        return
      case 'Td':
        this.moveLine(n(0), n(1))
        return
      case 'TD':
        s.leading = -n(1)
        this.moveLine(n(0), n(1))
        return
      case 'Tm':
        this.lineMatrix = [n(0), n(1), n(2), n(3), n(4), n(5)]
        this.textMatrix = this.lineMatrix
        return
      case 'T*':
        this.moveLine(0, -s.leading)
        return
      case 'Tj':
        this.show([args[0]])
        return
      case "'":
        this.moveLine(0, -s.leading)
        this.show([args[0]])
        return
      case '"':
        s.wordSpacing = n(0)
        s.charSpacing = n(1)
        this.moveLine(0, -s.leading)
        this.show([args[2]])
        return
      case 'TJ': {
        const arr = args[0]
        this.show(arr?.kind === 'array' ? arr.items : [])
        return
      }
      case 'Do':
        this.form(resources, asName(args[0]), depth)
        return
      default:
    }
  }

  private moveLine(tx: number, ty: number): void {
    this.lineMatrix = multiply([1, 0, 0, 1, tx, ty], this.lineMatrix)
    this.textMatrix = this.lineMatrix
  }

  /** Resource names are local to their dictionary: the cache is keyed by the font object. */
  private font(resources: PdfObject | undefined, name: string): PdfFont | undefined {
    const dict = this.file.get(resources, 'Font')
    const ref = dict?.kind === 'dict' ? dict.entries.get(name) : undefined
    if (!ref) return undefined
    const key = ref.kind === 'ref' ? `${ref.num} ${ref.gen}` : ref
    const cached = this.fonts.get(key)
    if (cached) return cached
    const font = loadFont(this.file, ref)
    this.fonts.set(key, font)
    return font
  }

  private show(items: readonly (PdfObject | undefined)[]): void {
    const s = this.state
    const font = s.font
    if (!font) return
    const th = s.horizontalScale
    const trm = (): Matrix =>
      multiply(multiply([s.fontSize * th, 0, 0, s.fontSize, 0, s.rise], this.textMatrix), s.ctm)
    const begin = trm()
    // Labels are often padded with spaces; the run is trimmed to its visible glyphs.
    let text = ''
    let first: readonly [number, number] | undefined
    let last: readonly [number, number] | undefined
    for (const item of items) {
      if (item?.kind === 'number') {
        this.advance((-item.value / 1000) * s.fontSize * th)
        continue
      }
      if (item?.kind !== 'string') continue
      for (const g of font.glyphs(item.bytes)) {
        const blank = !g.text.trim()
        if (!blank && !first) first = apply(trm(), 0, 0)
        if (first) text += g.text
        const tx = (g.advance / 1000) * s.fontSize + s.charSpacing + (g.isSpace ? s.wordSpacing : 0)
        this.advance(tx * th)
        if (!blank) last = apply(trm(), 0, 0)
      }
    }
    if (!first || !last) return
    const [ox, oy] = apply(begin, 0, 0)
    const [ux, uy] = apply(begin, 1, 0)
    const [vx, vy] = apply(begin, 0, 1)
    this.texts.push({
      text: text.trim(),
      origin: { x: first[0], y: first[1] },
      angle: Math.atan2(uy - oy, ux - ox),
      size: Math.hypot(vx - ox, vy - oy),
      width: Math.hypot(last[0] - first[0], last[1] - first[1]),
      color: s.fill,
    })
  }

  private advance(tx: number): void {
    this.textMatrix = multiply([1, 0, 0, 1, tx, 0], this.textMatrix)
  }

  private form(resources: PdfObject | undefined, name: string | undefined, depth: number): void {
    if (!name || depth >= MAX_FORM_DEPTH) return
    const xobjects = this.file.get(resources, 'XObject')
    const ref = xobjects?.kind === 'dict' ? xobjects.entries.get(name) : undefined
    const stream = this.file.stream(ref)
    if (!stream || asName(this.file.get(stream.dict, 'Subtype')) !== 'Form') return
    const m = this.file.get(stream.dict, 'Matrix')
    const values =
      m?.kind === 'array' ? m.items.map((i) => asNumber(this.file.resolve(i)) ?? 0) : []
    const saved = { ...this.state }
    this.stack.push(saved)
    if (values.length === 6) {
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = values
      this.state.ctm = multiply([a, b, c, d, e, f], this.state.ctm)
    }
    this.run(stream.data, this.file.get(stream.dict, 'Resources') ?? resources, depth + 1)
    this.state = this.stack.pop() ?? saved
  }
}

/** Inline image data is binary; skip to the `EI` keyword that ends it. */
function skipInlineImage(lexer: PdfLexer): void {
  for (;;) {
    const t = lexer.token()
    if (!t) return
    if (t.kind === 'op' && t.value === 'ID') break
  }
  const b = lexer.bytes
  for (let i = lexer.pos; i + 2 < b.length; i++)
    if (b[i] === 0x45 && b[i + 1] === 0x49 && (i + 2 >= b.length || (b[i + 2] ?? 0) <= 32)) {
      lexer.pos = i + 2
      return
    }
  lexer.pos = b.length
}
