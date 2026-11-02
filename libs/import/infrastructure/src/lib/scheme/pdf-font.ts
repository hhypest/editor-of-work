import type { PdfFile } from './pdf-file'
import { PdfLexer, asName, asNumber, latin1, type PdfObject } from './pdf-syntax'

/** One shown glyph: its text and horizontal advance in thousandths of the font size. */
export interface Glyph {
  readonly text: string
  readonly advance: number
  /** Single-byte code 32 gets word spacing (ISO 32000-1, 9.3.3). */
  readonly isSpace: boolean
}

export interface PdfFont {
  glyphs(bytes: Uint8Array): readonly Glyph[]
}

/** Codes → Unicode from a ToUnicode CMap (bfchar and bfrange sections). */
export function parseToUnicode(data: Uint8Array): {
  readonly map: ReadonlyMap<number, string>
  readonly codeBytes: number
} {
  const map = new Map<number, string>()
  const lexer = new PdfLexer(data)
  const operands: PdfObject[] = []
  let codeBytes = 1
  let section: 'bfchar' | 'bfrange' | 'codespace' | undefined
  for (;;) {
    let t
    try {
      t = lexer.token()
    } catch {
      continue
    }
    if (!t) break
    if (t.kind !== 'op') {
      operands.push(t)
      continue
    }
    if (t.value === '[') {
      operands.push(lexer.complete(t, 1))
      continue
    }
    if (t.value === 'begincodespacerange') section = 'codespace'
    else if (t.value === 'beginbfchar') section = 'bfchar'
    else if (t.value === 'beginbfrange') section = 'bfrange'
    else if (t.value.startsWith('end') && section) {
      if (section === 'codespace') {
        const lo = operands[0]
        if (lo?.kind === 'string') codeBytes = Math.max(1, lo.bytes.length)
      } else if (section === 'bfchar') {
        for (let i = 0; i + 1 < operands.length; i += 2) setChar(map, operands[i], operands[i + 1])
      } else {
        for (let i = 0; i + 2 < operands.length; i += 3)
          setRange(map, operands[i], operands[i + 1], operands[i + 2])
      }
      section = undefined
    }
    operands.length = 0
  }
  return { map, codeBytes }
}

const code = (o: PdfObject | undefined): number | undefined =>
  o?.kind === 'string' ? o.bytes.reduce((v, b) => v * 256 + b, 0) : undefined

function utf16(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i + 1 < bytes.length; i += 2)
    s += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0))
  return s
}

function setChar(map: Map<number, string>, src?: PdfObject, dst?: PdfObject): void {
  const c = code(src)
  if (c !== undefined && dst?.kind === 'string') map.set(c, utf16(dst.bytes))
}

function setRange(map: Map<number, string>, lo?: PdfObject, hi?: PdfObject, dst?: PdfObject): void {
  const from = code(lo),
    to = code(hi)
  if (from === undefined || to === undefined || to < from || to - from > 0xffff) return
  if (dst?.kind === 'array') {
    dst.items.forEach((item, i) => {
      if (item.kind === 'string' && from + i <= to) map.set(from + i, utf16(item.bytes))
    })
    return
  }
  if (dst?.kind !== 'string' || dst.bytes.length < 2) return
  const base = utf16(dst.bytes)
  const last = base.charCodeAt(base.length - 1)
  for (let c = from; c <= to; c++)
    map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - from)))
}

/** CID widths: `W [c [w1 w2 …] c1 c2 w …]` (ISO 32000-1, 9.7.4.3). */
function cidWidths(file: PdfFile, w: PdfObject | undefined): Map<number, number> {
  const out = new Map<number, number>()
  const items = w?.kind === 'array' ? w.items.map((i) => file.resolve(i)) : []
  for (let i = 0; i < items.length;) {
    const first = asNumber(items[i])
    const next = items[i + 1]
    if (first === undefined) break
    if (next?.kind === 'array') {
      next.items.forEach((v, k) => {
        const width = asNumber(file.resolve(v))
        if (width !== undefined) out.set(first + k, width)
      })
      i += 2
      continue
    }
    const last = asNumber(next),
      width = asNumber(items[i + 2])
    if (last === undefined || width === undefined || last - first > 0xffff) break
    for (let c = first; c <= last; c++) out.set(c, width)
    i += 3
  }
  return out
}

export function loadFont(file: PdfFile, font: PdfObject | undefined): PdfFont {
  // The entry stays a reference: only indirect objects carry stream data.
  const toUnicode = file.stream(fontDictEntry(file, font, 'ToUnicode'))
  const cmap = toUnicode ? parseToUnicode(toUnicode.data) : undefined
  if (asName(file.get(font, 'Subtype')) === 'Type0') {
    const descendants = file.get(font, 'DescendantFonts')
    const cid = file.resolve(descendants?.kind === 'array' ? descendants.items[0] : undefined)
    const widths = cidWidths(file, file.get(cid, 'W'))
    const dw = asNumber(file.get(cid, 'DW')) ?? 1000
    return {
      glyphs: (bytes) => {
        const out: Glyph[] = []
        for (let i = 0; i + 1 < bytes.length; i += 2) {
          const c = ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)
          out.push({ text: cmap?.map.get(c) ?? '', advance: widths.get(c) ?? dw, isSpace: false })
        }
        return out
      },
    }
  }
  const firstChar = asNumber(file.get(font, 'FirstChar')) ?? 0
  const widthsObj = file.get(font, 'Widths')
  const widths = widthsObj?.kind === 'array' ? widthsObj.items : []
  return {
    glyphs: (bytes) =>
      Array.from(bytes, (b) => ({
        text: cmap?.map.get(b) ?? windows1251(b),
        advance: asNumber(file.resolve(widths[b - firstChar])) ?? 500,
        isSpace: b === 32,
      })),
  }
}

function fontDictEntry(
  file: PdfFile,
  font: PdfObject | undefined,
  key: string,
): PdfObject | undefined {
  const dict = file.resolve(font)
  return dict?.kind === 'dict' ? dict.entries.get(key) : undefined
}

/** Simple fonts without ToUnicode in Russian exports are Windows-1251 at best. */
function windows1251(b: number): string {
  if (b < 0x80) return String.fromCharCode(b)
  if (b >= 0xc0) return String.fromCharCode(0x410 + b - 0xc0)
  if (b === 0xa8) return 'Ё'
  if (b === 0xb8) return 'ё'
  return latin1(Uint8Array.of(b))
}
