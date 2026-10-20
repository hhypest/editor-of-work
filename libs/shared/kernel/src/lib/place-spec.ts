import {
  chainage,
  describeChainageError,
  formatPlus,
  picketBounds,
  PICKET_LENGTH,
  PICKETS_PER_KM,
  compareChainage,
  type Chainage,
  type ChainageError,
  type KmLengths,
} from './chainage'
import type { PicketRef } from './chainage-parse'
import { err, ok, type Result } from './result'
import { spanLength, spansOverlap, type TrackPoint, type TrackSpan } from './track-span'

/** Элемент описания места: участок или точка. */
export type PlaceItem =
  ({ readonly kind: 'span' } & TrackSpan) | ({ readonly kind: 'point' } & TrackPoint)

/**
 * Описание места работы на направлении: «227 км пк 4 – 228 км пк 10; 234 км пк 3».
 * Элементы идут в порядке записи.
 */
export interface PlaceSpec {
  readonly line: string
  readonly items: readonly PlaceItem[]
}

/** Фрагмент исходной строки: [start; end) в символах UTF-16. */
export interface TextRange {
  readonly start: number
  readonly end: number
}

type PointRole = 'single' | 'start' | 'end'

export type PlaceSpecProblem =
  | { readonly kind: 'syntax'; readonly role: PointRole }
  | { readonly kind: 'fraction' }
  | { readonly kind: 'extra-dash' }
  | { readonly kind: 'missing-start' }
  | { readonly kind: 'missing-end' }
  | { readonly kind: 'value'; readonly cause: ChainageError }
  | { readonly kind: 'reversed' }
  | { readonly kind: 'zero-length' }
  | { readonly kind: 'overlap'; readonly other: string }

/** Ошибка разбора: что не так и где это в строке. */
export type PlaceSpecError = PlaceSpecProblem & {
  readonly at: TextRange
  /** Фрагмент строки с ошибкой, как его ввёл пользователь. */
  readonly text: string
}

const EXAMPLES = '«227 км», «227 км пк 4», «227 км пк 4 – 228 км пк 10» или «222+916»'

function describeSyntax(role: PointRole): string {
  switch (role) {
    case 'single':
      return `не понятно, что это за место; ожидается ${EXAMPLES}`
    case 'start':
      return `не понятно начало участка; ожидается ${EXAMPLES}`
    case 'end':
      return 'не понятен конец участка; ожидается «228 км пк 10», «пк 10», «10» или «228+350»'
  }
}

function describeProblem(p: PlaceSpecProblem): string {
  switch (p.kind) {
    case 'syntax':
      return describeSyntax(p.role)
    case 'fraction':
      return 'дробные километры не принимаются; напишите «222+500» или «222 км пк 6»'
    case 'extra-dash':
      return 'в участке больше одного тире; разделяйте участки точкой с запятой'
    case 'missing-start':
      return 'перед тире нет начала участка'
    case 'missing-end':
      return 'после тире нет конца участка'
    case 'value':
      return describeChainageError(p.cause)
    case 'reversed':
      return 'конец участка раньше начала'
    case 'zero-length':
      return 'начало и конец совпадают; для точки укажите одно значение'
    case 'overlap':
      return `пересекается с «${p.other}»`
  }
}

/** «Позиция 29, «234 км пк 13»: Пикет 13 вне 1–10 (234 км)». Позиция считается с 1. */
export function describePlaceSpecError(e: PlaceSpecError): string {
  return `Позиция ${e.at.start + 1}, «${e.text}»: ${describeProblem(e)}`
}

// --- Разбиение строки на фрагменты с позициями -----------------------------

interface Fragment extends TextRange {
  readonly text: string
}

/** Фрагмент [start; end) без пробелов по краям; пустой — с нулевой длиной на месте start. */
function fragment(source: string, start: number, end: number): Fragment {
  let s = start
  let e = end
  while (s < e && /\s/u.test(source.charAt(s))) s++
  while (e > s && /\s/u.test(source.charAt(e - 1))) e--
  return { start: s, end: e, text: source.slice(s, e) }
}

/** Части разделяются «;», переводом строки или запятой, за которой не идёт цифра. */
const PART_SEPARATOR = /[;\n\r]|,(?!\d)/gu
/** Дефис, короткое и длинное тире, знак минуса. */
const DASH = /[-–—−]/gu

function splitBy(source: string, within: TextRange, pattern: RegExp): Fragment[] {
  const parts: Fragment[] = []
  let from = within.start
  for (const m of source.slice(within.start, within.end).matchAll(pattern)) {
    const at = within.start + m.index
    parts.push(fragment(source, from, at))
    from = at + m[0].length
  }
  parts.push(fragment(source, from, within.end))
  return parts
}

// --- Разбор одной точки ----------------------------------------------------

type ParsedPoint =
  | { readonly kind: 'exact'; readonly km: number; readonly m: number }
  | { readonly kind: 'pk'; readonly km: number; readonly pk: number }
  | { readonly kind: 'km'; readonly km: number }

interface StartContext {
  readonly km: number
  readonly wasPicket: boolean
}

const EXACT = [/^(\d+) ?\+ ?(\d+)$/u, /^(\d+) ?км ?(\d+) ?м$/u]
const PICKET = [/^(\d+) ?\/ ?(\d+)$/u, /^(\d+) ?(?:км)? ?пк ?(\d+)$/u, /^(\d+) ?км ?(\d+) ?пк$/u]
const PICKET_ONLY = /^пк ?(\d+)$/u
const NUMBER = /^\d+$/u
const KM = /^(\d+) ?(?:км)?$/u
const FRACTION = /^\d+ ?[.,] ?\d+ ?(?:км)?$/u

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replaceAll(/(км|пк)\./gu, '$1')
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

function firstMatch(patterns: readonly RegExp[], text: string): [number, number] | undefined {
  for (const p of patterns) {
    const m = p.exec(text)
    if (m?.[1] && m[2]) return [Number(m[1]), Number(m[2])]
  }
  return undefined
}

function readPoint(
  raw: string,
  role: PointRole,
  start: StartContext | undefined,
): Result<ParsedPoint, PlaceSpecProblem> {
  const t = normalize(raw)
  const exact = firstMatch(EXACT, t)
  if (exact) return ok({ kind: 'exact', km: exact[0], m: exact[1] })
  const pk = firstMatch(PICKET, t)
  if (pk) return ok({ kind: 'pk', km: pk[0], pk: pk[1] })
  if (start && role === 'end') {
    // «227 км пк 4 – пк 7» и «227 км пк 4–7»: конец на том же километре.
    const only = PICKET_ONLY.exec(t)?.[1]
    if (only) return ok({ kind: 'pk', km: start.km, pk: Number(only) })
    if (start.wasPicket && NUMBER.test(t) && Number(t) <= PICKETS_PER_KM)
      return ok({ kind: 'pk', km: start.km, pk: Number(t) })
  }
  const km = KM.exec(t)?.[1]
  if (km) return ok({ kind: 'km', km: Number(km) })
  return err(FRACTION.test(t) ? { kind: 'fraction' } : { kind: 'syntax', role })
}

function checked(km: number, m: number, lengths: KmLengths): Result<Chainage, PlaceSpecProblem> {
  const r = chainage(km, m, lengths)
  return r.ok ? r : err({ kind: 'value', cause: r.error })
}

/**
 * Граница участка. Начало — начало пикета или километра. Конец — конец пикета;
 * километр без пикета в конце означает его начало «N+000», как в прототипе:
 * «44 км – 50 км» — шесть километров.
 */
function boundary(
  p: ParsedPoint,
  side: 'start' | 'end',
  lengths: KmLengths,
): Result<Chainage, PlaceSpecProblem> {
  switch (p.kind) {
    case 'exact':
      return checked(p.km, p.m, lengths)
    case 'km':
      return checked(p.km, 0, lengths)
    case 'pk': {
      const b = picketBounds(p.km, p.pk)
      if (!b.ok) return err({ kind: 'value', cause: b.error })
      return ok(side === 'start' ? b.value.start : b.value.end)
    }
  }
}

// --- Разбор части: точка, пикет, километр или участок ----------------------

type PartResult = Result<PlaceItem, PlaceSpecError>

function fail(problem: PlaceSpecProblem, where: Fragment): PartResult {
  return err({ ...problem, at: { start: where.start, end: where.end }, text: where.text })
}

/** «227 км» — весь километр, «227 км пк 4» — пикет, «222+916» — точка. */
function readSingle(f: Fragment, line: string, lengths: KmLengths): PartResult {
  const p = readPoint(f.text, 'single', undefined)
  if (!p.ok) return fail(p.error, f)
  const point = p.value
  if (point.kind === 'exact') {
    const at = checked(point.km, point.m, lengths)
    return at.ok ? ok({ kind: 'point', line, at: at.value }) : fail(at.error, f)
  }
  const from = boundary(point, 'start', lengths)
  if (!from.ok) return fail(from.error, f)
  const to =
    point.kind === 'pk' ? boundary(point, 'end', lengths) : checked(point.km + 1, 0, lengths)
  return to.ok ? ok({ kind: 'span', line, from: from.value, to: to.value }) : fail(to.error, f)
}

function readRange(
  part: Fragment,
  a: Fragment,
  b: Fragment,
  line: string,
  lengths: KmLengths,
): PartResult {
  if (a.text === '') return fail({ kind: 'missing-start' }, part)
  if (b.text === '') return fail({ kind: 'missing-end' }, part)
  const pa = readPoint(a.text, 'start', undefined)
  if (!pa.ok) return fail(pa.error, a)
  const from = boundary(pa.value, 'start', lengths)
  if (!from.ok) return fail(from.error, a)
  const pb = readPoint(b.text, 'end', { km: pa.value.km, wasPicket: pa.value.kind === 'pk' })
  if (!pb.ok) return fail(pb.error, b)
  const to = boundary(pb.value, 'end', lengths)
  if (!to.ok) return fail(to.error, b)
  const order = compareChainage(from.value, to.value)
  if (order > 0) return fail({ kind: 'reversed' }, part)
  if (order === 0) return fail({ kind: 'zero-length' }, part)
  return ok({ kind: 'span', line, from: from.value, to: to.value })
}

function readPart(source: string, part: Fragment, line: string, lengths: KmLengths): PartResult {
  const sides = splitBy(source, part, DASH)
  const [a, b] = sides
  if (sides.length > 2) return fail({ kind: 'extra-dash' }, part)
  if (a && b) return readRange(part, a, b, line, lengths)
  return readSingle(part, line, lengths)
}

/** Участки одной работы не должны перекрываться: иначе объём посчитается дважды. */
function overlapErrors(parsed: readonly (readonly [Fragment, PlaceItem])[]): PlaceSpecError[] {
  const errors: PlaceSpecError[] = []
  parsed.forEach(([where, item], j) => {
    if (item.kind !== 'span') return
    const earlier = parsed
      .slice(0, j)
      .find(([, other]) => other.kind === 'span' && spansOverlap(other, item))
    if (earlier) {
      errors.push({
        kind: 'overlap',
        other: earlier[0].text,
        at: { start: where.start, end: where.end },
        text: where.text,
      })
    }
  })
  return errors
}

/**
 * Разбор описания места. Части разделяются «;», переводом строки или запятой,
 * границы участка — тире. Возвращает все ошибки сразу, у каждой — позиция в строке.
 * Пустая строка — пустое описание (работа без привязки к километрам).
 */
export function parsePlaceSpec(
  text: string,
  line: string,
  lengths: KmLengths,
): Result<PlaceSpec, readonly PlaceSpecError[]> {
  const parsed: (readonly [Fragment, PlaceItem])[] = []
  const errors: PlaceSpecError[] = []
  for (const part of splitBy(text, { start: 0, end: text.length }, PART_SEPARATOR)) {
    if (part.text === '') continue
    const r = readPart(text, part, line, lengths)
    if (r.ok) parsed.push([part, r.value])
    else errors.push(r.error)
  }
  errors.push(...overlapErrors(parsed))
  if (errors.length > 0) return err(errors.toSorted((x, y) => x.at.start - y.at.start))
  return ok({ line, items: parsed.map(([, item]) => item) })
}

// --- Печать ----------------------------------------------------------------

/** Точка — начало пикета: m кратно 100 и не дальше начала пк 10. */
function picketStarting(c: Chainage): PicketRef | undefined {
  const pk = c.m / PICKET_LENGTH + 1
  return Number.isInteger(pk) && pk <= PICKETS_PER_KM ? { km: c.km, pk } : undefined
}

/** Точка — конец пикета: начало километра закрывает пк 10 предыдущего. */
function picketEnding(c: Chainage): PicketRef | undefined {
  if (c.m === 0) return c.km > 0 ? { km: c.km - 1, pk: PICKETS_PER_KM } : undefined
  const pk = c.m / PICKET_LENGTH
  return Number.isInteger(pk) && pk < PICKETS_PER_KM ? { km: c.km, pk } : undefined
}

function picketText(p: PicketRef): string {
  return `${p.km} км пк ${p.pk}`
}

function formatSpan(span: TrackSpan): string {
  const s = picketStarting(span.from)
  const e = picketEnding(span.to)
  if (s && e && s.km === e.km) {
    if (s.pk === e.pk) return picketText(s)
    if (s.pk === 1 && e.pk === PICKETS_PER_KM) return `${s.km} км`
    return `${picketText(s)}–${e.pk}`
  }
  const from = s ? picketText(s) : formatPlus(span.from)
  const to = e ? picketText(e) : formatPlus(span.to)
  return `${from} – ${to}`
}

export function formatPlaceItem(item: PlaceItem): string {
  return item.kind === 'point' ? formatPlus(item.at) : formatSpan(item)
}

/** Текст описания места; разбор этого текста даёт те же участки и точки. */
export function formatPlaceSpec(spec: PlaceSpec): string {
  return spec.items.map(formatPlaceItem).join('; ')
}

/** Сумма длин участков в метрах; точки длины не имеют. */
export function placeLength(spec: PlaceSpec, lengths: KmLengths): number {
  let total = 0
  for (const item of spec.items) if (item.kind === 'span') total += spanLength(item, lengths)
  return total
}
