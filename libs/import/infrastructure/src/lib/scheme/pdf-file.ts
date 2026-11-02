import { Unzlib } from 'fflate'
import { PdfLexer, PdfSyntaxError, asNumber, dictGet, latin1, type PdfObject } from './pdf-syntax'

/** Limits for one scheme file, independent of what the file declares. */
export const PDF_LIMITS = {
  fileBytes: 64 * 1024 * 1024,
  streamBytes: 32 * 1024 * 1024,
  totalStreamBytes: 128 * 1024 * 1024,
  objects: 200_000,
}

const INPUT_CHUNK_BYTES = 1024

class PdfLimitError extends Error {}

export interface PdfStream {
  readonly dict: PdfObject
  readonly data: Uint8Array
}

interface XrefEntry {
  readonly offset: number
  readonly gen: number
}

/**
 * Read-only access to objects of a classic (xref-table) PDF such as PDFsharp writes.
 * Cross-reference streams and encryption are reported as unsupported, not guessed.
 */
export class PdfFile {
  private readonly xref = new Map<number, XrefEntry>()
  private readonly cache = new Map<number, PdfObject>()
  private readonly streams = new Map<number, { dict: PdfObject; start: number }>()
  private decoded = 0
  readonly trailer: PdfObject

  constructor(
    private readonly bytes: Uint8Array,
    private readonly limits: Readonly<typeof PDF_LIMITS> = PDF_LIMITS,
  ) {
    if (bytes.length > limits.fileBytes) throw new PdfSyntaxError('Файл PDF больше 64 МиБ.')
    if (latin1(bytes, 0, 5) !== '%PDF-') throw new PdfSyntaxError('Файл не является PDF.')
    this.trailer = this.readXrefChain()
    if (dictGet(this.trailer, 'Encrypt'))
      throw new PdfSyntaxError('Зашифрованные PDF не поддерживаются.')
  }

  /** Object by number; references inside are not resolved. */
  object(num: number): PdfObject {
    const cached = this.cache.get(num)
    if (cached) return cached
    const entry = this.xref.get(num)
    if (!entry) return { kind: 'null' }
    const lexer = new PdfLexer(this.bytes, entry.offset)
    const n = lexer.token(),
      g = lexer.token(),
      kw = lexer.token()
    if (
      n?.kind !== 'number' ||
      n.value !== num ||
      g?.kind !== 'number' ||
      kw?.kind !== 'op' ||
      kw.value !== 'obj'
    )
      throw new PdfSyntaxError(`Таблица ссылок PDF указывает не на объект ${num}.`)
    const value = lexer.object()
    const after = lexer.token()
    if (after?.kind === 'op' && after.value === 'stream') {
      let start = lexer.pos
      if (this.bytes[start] === 13) start++
      if (this.bytes[start] === 10) start++
      this.streams.set(num, { dict: value, start })
    }
    this.cache.set(num, value)
    return value
  }

  resolve(obj: PdfObject | undefined): PdfObject | undefined {
    let current = obj
    for (let i = 0; current?.kind === 'ref' && i < 32; i++) current = this.object(current.num)
    return current?.kind === 'ref' ? undefined : current
  }

  get(obj: PdfObject | undefined, key: string): PdfObject | undefined {
    return this.resolve(dictGet(this.resolve(obj), key))
  }

  /** Decoded stream data of an indirect stream object. */
  stream(ref: PdfObject | undefined): PdfStream | undefined {
    if (ref?.kind !== 'ref') return undefined
    this.object(ref.num)
    const raw = this.streams.get(ref.num)
    if (!raw) return undefined
    const length = asNumber(this.resolve(dictGet(raw.dict, 'Length')))
    if (length === undefined || length < 0 || raw.start + length > this.bytes.length)
      throw new PdfSyntaxError('Неверная длина потока PDF.')
    const encoded = this.bytes.subarray(raw.start, raw.start + length)
    return { dict: raw.dict, data: this.decode(raw.dict, encoded) }
  }

  private decode(dict: PdfObject, data: Uint8Array): Uint8Array {
    const filter = this.resolve(dictGet(dict, 'Filter'))
    const names =
      filter === undefined
        ? []
        : filter.kind === 'array'
          ? filter.items.map((f) => this.resolve(f))
          : [filter]
    let out = data
    for (const f of names) {
      if (f?.kind !== 'name' || (f.value !== 'FlateDecode' && f.value !== 'Fl'))
        throw new PdfSyntaxError('Поток PDF сжат неподдерживаемым способом.')
      if (dictGet(dict, 'DecodeParms'))
        throw new PdfSyntaxError('Параметры сжатия потока PDF не поддерживаются.')
      out = this.inflate(out)
    }
    return out
  }

  /** Small input chunks bound transient output even for a deliberately oversized stream. */
  private inflate(data: Uint8Array): Uint8Array {
    const chunks: Uint8Array[] = []
    let size = 0
    const inflater = new Unzlib((chunk) => {
      size += chunk.length
      if (size > this.limits.streamBytes)
        throw new PdfLimitError('Поток PDF после распаковки больше 32 МиБ.')
      if (this.decoded + size > this.limits.totalStreamBytes)
        throw new PdfLimitError('Распакованные потоки PDF больше 128 МиБ.')
      chunks.push(chunk)
    })
    try {
      for (let at = 0; at < data.length; at += INPUT_CHUNK_BYTES)
        inflater.push(data.subarray(at, at + INPUT_CHUNK_BYTES), false)
      inflater.push(new Uint8Array(0), true)
    } catch (error) {
      if (error instanceof PdfLimitError) throw new PdfSyntaxError(error.message)
      throw new PdfSyntaxError('Поток PDF повреждён.')
    }
    this.decoded += size
    const out = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }

  private readXrefChain(): PdfObject {
    const tail = latin1(this.bytes, Math.max(0, this.bytes.length - 2048))
    const match = /startxref\s+(\d+)\s+%%EOF/u.exec(tail.slice(tail.lastIndexOf('startxref')))
    if (!match?.[1]) throw new PdfSyntaxError('В PDF нет таблицы ссылок (startxref).')
    let offset = Number(match[1])
    let first: PdfObject | undefined
    const seen = new Set<number>()
    while (!seen.has(offset)) {
      seen.add(offset)
      const trailer = this.readXrefSection(offset)
      first ??= trailer
      const prev = asNumber(dictGet(trailer, 'Prev'))
      if (prev === undefined) break
      offset = prev
    }
    if (!first) throw new PdfSyntaxError('В PDF нет трейлера.')
    return first
  }

  private readXrefSection(offset: number): PdfObject {
    const lexer = new PdfLexer(this.bytes, offset)
    const head = lexer.token()
    if (head?.kind !== 'op' || head.value !== 'xref')
      throw new PdfSyntaxError('PDF с потоком ссылок не поддерживается: сохраните схему заново.')
    for (;;) {
      const t = lexer.token()
      if (t?.kind === 'op' && t.value === 'trailer') return lexer.object()
      const count = lexer.token()
      if (t?.kind !== 'number' || count?.kind !== 'number')
        throw new PdfSyntaxError('Таблица ссылок PDF повреждена.')
      for (let i = 0; i < count.value; i++) {
        const off = lexer.token(),
          gen = lexer.token(),
          type = lexer.token()
        if (off?.kind !== 'number' || gen?.kind !== 'number' || type?.kind !== 'op')
          throw new PdfSyntaxError('Таблица ссылок PDF повреждена.')
        const num = t.value + i
        // Newer sections come first in the chain and win.
        if (type.value === 'n' && !this.xref.has(num)) {
          if (this.xref.size >= this.limits.objects)
            throw new PdfSyntaxError('В PDF слишком много объектов.')
          this.xref.set(num, { offset: off.value, gen: gen.value })
        }
      }
    }
  }
}
