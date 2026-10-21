import { strFromU8, unzipSync } from 'fflate'
import { err, ok, type Result } from '@eow/shared/kernel'
import { attributes, decodeEntities, decodeOoxmlEscapes } from './xml'
import { parseAddress, parseRange, SheetBuilder, type Sheet } from './sheet'

/**
 * Минимальный читатель xlsx для выгрузок ЕК АСУИ: распаковка fflate и разбор XML листов.
 * Читает значения (у формул — сохранённый результат), даты, объединения и видимость листов.
 * Стили, формулы и прочее оформление не нужны импорту и не разбираются.
 */

interface SheetEntry {
  readonly name: string
  readonly visible: boolean
  readonly path: string
}

function unzip(bytes: Uint8Array, wanted: (path: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(bytes, { filter: (f) => wanted(f.name) })
}

function text(files: Record<string, Uint8Array>, path: string): string | undefined {
  const data = files[path]
  return data ? strFromU8(data) : undefined
}

/** Путь части пакета относительно xl/: «worksheets/sheet1.xml» или «/xl/worksheets/sheet1.xml». */
function partPath(target: string): string {
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//u, '')}`
}

function sheetEntries(workbook: string, rels: string): SheetEntry[] {
  const targets = new Map<string, string>()
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/gu)) {
    const a = attributes(m[1] ?? '')
    const id = a.get('Id')
    const target = a.get('Target')
    if (id && target) targets.set(id, partPath(target))
  }
  const out: SheetEntry[] = []
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/gu)) {
    const a = attributes(m[1] ?? '')
    const path = targets.get(a.get('r:id') ?? '')
    if (path)
      out.push({
        name: a.get('name') ?? '',
        visible: (a.get('state') ?? 'visible') === 'visible',
        path,
      })
  }
  return out
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/gu)].map((m) => {
    // Фонетические подсказки <rPh> к значению не относятся.
    const body = (m[1] ?? '').replaceAll(/<rPh\b[\s\S]*?<\/rPh>/gu, '')
    const parts = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map((t) => t[1] ?? '')
    return decodeOoxmlEscapes(decodeEntities(parts.join('')))
  })
}

/** Встроенные форматы чисел Excel, которые означают дату или время. */
const DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57, 58,
])

function isDateFormatCode(code: string): boolean {
  // Без текста в кавычках, цвета и условий в квадратных скобках.
  const bare = code.replaceAll(/"[^"]*"|\[[^\]]*\]|\\./gu, '')
  return /[dmyhs]/iu.test(bare) && !/^general$/iu.test(bare)
}

/** Номера стилей ячеек (атрибут s), которые показывают дату. */
function dateStyles(xml: string | undefined): ReadonlySet<number> {
  if (!xml) return new Set()
  const custom = new Map<number, string>()
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/gu)) {
    const a = attributes(m[1] ?? '')
    custom.set(Number(a.get('numFmtId')), a.get('formatCode') ?? '')
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/u.exec(xml)?.[1] ?? ''
  const out = new Set<number>()
  ;[...xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/gu)].forEach((m, index) => {
    const id = Number(attributes(m[1] ?? '').get('numFmtId') ?? 0)
    const code = custom.get(id)
    if (DATE_FORMAT_IDS.has(id) || (code !== undefined && isDateFormatCode(code))) out.add(index)
  })
  return out
}

/**
 * Серийный номер даты Excel → ГГГГ-ММ-ДД. В системе 1900 ноль — 30.12.1899,
 * в системе 1904 (флаг date1904 книги) — 01.01.1904, на 1462 дня позже.
 */
export function excelDate(serial: number, date1904 = false): string {
  const ms = Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86_400_000)
  return new Date(ms).toISOString().slice(0, 10)
}

interface Context {
  readonly strings: readonly string[]
  readonly dates: ReadonlySet<number>
  readonly date1904: boolean
}

function cellValue(
  attrs: ReadonlyMap<string, string>,
  inner: string,
  ctx: Context,
): string | number | null {
  const type = attrs.get('t') ?? 'n'
  const raw = /<v>([\s\S]*?)<\/v>/u.exec(inner)?.[1]
  switch (type) {
    case 's':
      return raw === undefined ? null : (ctx.strings[Number(raw)] ?? null)
    case 'inlineStr': {
      const parts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map((t) => t[1] ?? '')
      return decodeOoxmlEscapes(decodeEntities(parts.join('')))
    }
    case 'str':
      return raw === undefined ? null : decodeOoxmlEscapes(decodeEntities(raw))
    case 'b':
      return raw === '1' ? 'ИСТИНА' : 'ЛОЖЬ'
    case 'e':
      return raw === undefined ? null : decodeEntities(raw)
    default: {
      if (raw === undefined || raw === '') return null
      const n = Number(raw)
      if (!Number.isFinite(n)) return null
      return ctx.dates.has(Number(attrs.get('s') ?? -1)) ? excelDate(n, ctx.date1904) : n
    }
  }
}

function parseSheet(entry: SheetEntry, xml: string, ctx: Context): Sheet {
  const b = new SheetBuilder()
  let lastRow = 0
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gu)) {
    const rowAttrs = attributes(rm[1] ?? '')
    const row = Number(rowAttrs.get('r') ?? lastRow + 1)
    lastRow = row
    let lastCol = 0
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const a = attributes(cm[1] ?? '')
      const ref = a.get('r')
      const col = (ref ? parseAddress(ref)?.col : undefined) ?? lastCol + 1
      lastCol = col
      b.set(row, col, cellValue(a, cm[2] ?? '', ctx))
    }
  }
  for (const m of xml.matchAll(/<mergeCell\b([^>]*)\/?>/gu)) {
    const range = parseRange(attributes(m[1] ?? '').get('ref') ?? '')
    if (range) b.merges.push(range)
  }
  return b.build(entry.name, entry.visible)
}

export type XlsxError = { readonly kind: 'broken'; readonly detail: string }

/**
 * Листы книги. По умолчанию читаются только видимые: служебные листы BEx скрыты,
 * а распаковывать их ради импорта незачем — в настоящих отчётах их десятки.
 */
export function readXlsx(
  bytes: Uint8Array,
  options: { readonly includeHidden?: boolean } = {},
): Result<Sheet[], XlsxError> {
  try {
    const meta = unzip(bytes, (p) =>
      [
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/sharedStrings.xml',
        'xl/styles.xml',
      ].includes(p),
    )
    const workbook = text(meta, 'xl/workbook.xml')
    const rels = text(meta, 'xl/_rels/workbook.xml.rels')
    if (!workbook || !rels)
      return err({ kind: 'broken', detail: 'нет описания книги (xl/workbook.xml)' })
    const entries = sheetEntries(workbook, rels).filter((e) => options.includeHidden || e.visible)
    const wanted = new Set(entries.map((e) => e.path))
    const parts = unzip(bytes, (p) => wanted.has(p))
    const ctx: Context = {
      strings: sharedStrings(text(meta, 'xl/sharedStrings.xml')),
      dates: dateStyles(text(meta, 'xl/styles.xml')),
      date1904: /<workbookPr\b[^>]*\bdate1904\s*=\s*["'](?:1|true)["']/u.test(workbook),
    }
    const sheets: Sheet[] = []
    for (const e of entries) {
      const xml = text(parts, e.path)
      if (xml === undefined)
        return err({ kind: 'broken', detail: `нет листа «${e.name}» (${e.path})` })
      sheets.push(parseSheet(e, xml, ctx))
    }
    return ok(sheets)
  } catch (e) {
    return err({ kind: 'broken', detail: e instanceof Error ? e.message : String(e) })
  }
}
