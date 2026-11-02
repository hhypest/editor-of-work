/**
 * Minimal PDF object syntax (ISO 32000-1, 7.2–7.3): enough to read the files that
 * ЕК АСУИ exports for station schemes. Content streams use the same tokens plus operators.
 */
export type PdfObject =
  | { readonly kind: 'null' }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'string'; readonly bytes: Uint8Array }
  | { readonly kind: 'array'; readonly items: readonly PdfObject[] }
  | { readonly kind: 'dict'; readonly entries: ReadonlyMap<string, PdfObject> }
  | { readonly kind: 'ref'; readonly num: number; readonly gen: number }

export type PdfToken = PdfObject | { readonly kind: 'op'; readonly value: string }

export const PDF_NULL: PdfObject = { kind: 'null' }

export class PdfSyntaxError extends Error {}

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32])
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])
// Guards against hostile nesting; real schemes nest arrays two levels deep.
const MAX_DEPTH = 64

const isRegular = (b: number): boolean => !WHITESPACE.has(b) && !DELIMITERS.has(b)
const hexValue = (b: number): number => {
  if (b >= 0x30 && b <= 0x39) return b - 0x30
  if (b >= 0x41 && b <= 0x46) return b - 0x37
  if (b >= 0x61 && b <= 0x66) return b - 0x57
  return -1
}

export class PdfLexer {
  constructor(
    readonly bytes: Uint8Array,
    public pos = 0,
    private readonly end = bytes.length,
  ) {}

  atEnd(): boolean {
    this.skipSpace()
    return this.pos >= this.end
  }

  skipSpace(): void {
    while (this.pos < this.end) {
      const b = this.byte(this.pos)
      if (WHITESPACE.has(b)) this.pos++
      else if (b === 0x25) {
        while (this.pos < this.end && this.byte(this.pos) !== 10 && this.byte(this.pos) !== 13)
          this.pos++
      } else return
    }
  }

  /** Next token; `[` `]` `<<` `>>` are returned as operators for the object parser. */
  token(): PdfToken | undefined {
    this.skipSpace()
    if (this.pos >= this.end) return undefined
    const b = this.byte(this.pos)
    if (b === 0x2f) return this.name()
    if (b === 0x28) return this.literalString()
    if (b === 0x3c) {
      if (this.byte(this.pos + 1) === 0x3c) {
        this.pos += 2
        return { kind: 'op', value: '<<' }
      }
      return this.hexString()
    }
    if (b === 0x3e) {
      if (this.byte(this.pos + 1) !== 0x3e) {
        // Step past the stray byte so that a caller skipping bad tokens keeps moving.
        this.pos++
        throw new PdfSyntaxError('Неожиданный символ «>».')
      }
      this.pos += 2
      return { kind: 'op', value: '>>' }
    }
    if (b === 0x5b || b === 0x5d || b === 0x7b || b === 0x7d) {
      this.pos++
      return { kind: 'op', value: String.fromCharCode(b) }
    }
    const start = this.pos
    while (this.pos < this.end && isRegular(this.byte(this.pos))) this.pos++
    if (this.pos === start) {
      this.pos++
      throw new PdfSyntaxError('Неверный символ в PDF.')
    }
    const word = latin1(this.bytes, start, this.pos)
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/u.test(word)) return { kind: 'number', value: Number(word) }
    if (word === 'true' || word === 'false') return { kind: 'bool', value: word === 'true' }
    if (word === 'null') return PDF_NULL
    return { kind: 'op', value: word }
  }

  /** A complete object; `N G R` references are resolved by the caller's lookahead here. */
  object(depth = 0): PdfObject {
    if (depth > MAX_DEPTH) throw new PdfSyntaxError('Слишком глубокая вложенность объектов PDF.')
    const t = this.token()
    if (!t) throw new PdfSyntaxError('Неожиданный конец PDF.')
    return this.complete(t, depth)
  }

  complete(t: PdfToken, depth: number): PdfObject {
    if (t.kind === 'number') return this.maybeRef(t)
    if (t.kind !== 'op') return t
    if (t.value === '[') return this.array(depth)
    if (t.value === '<<') return this.dict(depth)
    throw new PdfSyntaxError(`Неожиданный оператор «${t.value}» в объекте PDF.`)
  }

  private array(depth: number): PdfObject {
    const items: PdfObject[] = []
    for (;;) {
      const t = this.token()
      if (!t) throw new PdfSyntaxError('Незакрытый массив PDF.')
      if (t.kind === 'op' && t.value === ']') return { kind: 'array', items }
      items.push(this.complete(t, depth + 1))
    }
  }

  private dict(depth: number): PdfObject {
    const entries = new Map<string, PdfObject>()
    for (;;) {
      const t = this.token()
      if (!t) throw new PdfSyntaxError('Незакрытый словарь PDF.')
      if (t.kind === 'op' && t.value === '>>') return { kind: 'dict', entries }
      if (t.kind !== 'name') throw new PdfSyntaxError('Ключ словаря PDF должен быть именем.')
      entries.set(t.value, this.object(depth + 1))
    }
  }

  private maybeRef(first: { kind: 'number'; value: number }): PdfObject {
    const save = this.pos
    const second = this.token()
    if (second?.kind === 'number' && Number.isInteger(first.value) && first.value >= 0) {
      const third = this.token()
      if (third?.kind === 'op' && third.value === 'R' && Number.isInteger(second.value))
        return { kind: 'ref', num: first.value, gen: second.value }
    }
    this.pos = save
    return first
  }

  private name(): PdfObject {
    this.pos++
    const start = this.pos
    while (this.pos < this.end && isRegular(this.byte(this.pos))) this.pos++
    const raw = latin1(this.bytes, start, this.pos)
    const value = raw.replace(/#([0-9a-fA-F]{2})/gu, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    return { kind: 'name', value }
  }

  private hexString(): PdfObject {
    this.pos++
    const out: number[] = []
    let high = -1
    while (this.pos < this.end) {
      const b = this.byte(this.pos++)
      if (b === 0x3e) {
        if (high >= 0) out.push(high << 4)
        return { kind: 'string', bytes: Uint8Array.from(out) }
      }
      const v = hexValue(b)
      if (v < 0) {
        if (WHITESPACE.has(b)) continue
        throw new PdfSyntaxError('Неверная шестнадцатеричная строка PDF.')
      }
      if (high < 0) high = v
      else {
        out.push((high << 4) | v)
        high = -1
      }
    }
    throw new PdfSyntaxError('Незакрытая строка PDF.')
  }

  private literalString(): PdfObject {
    this.pos++
    const out: number[] = []
    let nesting = 1
    while (this.pos < this.end) {
      const b = this.byte(this.pos++)
      if (b === 0x28) nesting++
      else if (b === 0x29 && --nesting === 0) return { kind: 'string', bytes: Uint8Array.from(out) }
      if (b !== 0x5c) {
        out.push(b)
        continue
      }
      const e = this.byte(this.pos++)
      const simple: Record<number, number> = {
        0x6e: 10,
        0x72: 13,
        0x74: 9,
        0x62: 8,
        0x66: 12,
        0x28: 0x28,
        0x29: 0x29,
        0x5c: 0x5c,
      }
      const mapped = simple[e]
      if (mapped !== undefined) out.push(mapped)
      else if (e >= 0x30 && e <= 0x37) {
        let v = e - 0x30
        for (let i = 0; i < 2 && this.byte(this.pos) >= 0x30 && this.byte(this.pos) <= 0x37; i++)
          v = v * 8 + this.byte(this.pos++) - 0x30
        out.push(v & 0xff)
      } else if (e === 13) {
        if (this.byte(this.pos) === 10) this.pos++
      } else if (e !== 10) out.push(e)
    }
    throw new PdfSyntaxError('Незакрытая строка PDF.')
  }

  private byte(i: number): number {
    return i < this.end ? (this.bytes[i] ?? 0) : 0
  }
}

export function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let s = ''
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i] ?? 0)
  return s
}

export function dictGet(obj: PdfObject | undefined, key: string): PdfObject | undefined {
  return obj?.kind === 'dict' ? obj.entries.get(key) : undefined
}

export function asNumber(obj: PdfObject | undefined): number | undefined {
  return obj?.kind === 'number' ? obj.value : undefined
}

export function asName(obj: PdfObject | undefined): string | undefined {
  return obj?.kind === 'name' ? obj.value : undefined
}
