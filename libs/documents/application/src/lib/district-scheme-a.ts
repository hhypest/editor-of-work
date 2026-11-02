import {
  chainage,
  compareChainage,
  describeChainageError,
  distance,
  err,
  formatPlus,
  KmLengths,
  ok,
  type Chainage,
  type Result,
} from '@eow/shared/kernel'
import {
  mm,
  type OverviewDocument,
  type OverviewLine,
  type OverviewSource,
  type SheetError,
  type SheetPage,
  type SheetPrimitive,
  type TextMeasurer,
} from './sheet-model'
import { bold, narrow, regular, textBlock } from './sheet-text'
import {
  moveShapes,
  sheetLine as line,
  sheetRect as rect,
  sheetText as text,
  sheetThickLine as thick,
} from './sheet-drawing'

/**
 * Схема дистанции, вариант A (#33, ADR-0050): каждое направление — одна линия в общем для
 * листа масштабе. Масштаб — самый крупный из ряда, при котором самое длинное направление
 * помещается в ширину листа. Длины считаются по таблице нестандартных километров.
 */
export const DISTRICT_SCALES = [
  10_000, 20_000, 25_000, 50_000, 100_000, 150_000, 200_000, 250_000, 300_000, 400_000, 500_000,
  750_000, 1_000_000, 1_500_000, 2_000_000,
] as const
export type DistrictScale = (typeof DISTRICT_SCALES)[number]

export interface DistrictDocument extends OverviewDocument {
  readonly scale: DistrictScale
}

const LEFT = 15,
  RIGHT = 405,
  TRACK_LEFT = 25,
  TRACK_RIGHT = 395
/** Разрыв протяжения (чужая дистанция) рисуется отрезком постоянной длины, мм. */
const GAP = 10
const TOP = 34,
  BOTTOM = 252
const MAX_PAGES = 200
const MAX_LANES = 12
const LANE = 4
const BAND = 5
const LABEL = narrow(2.5)
const KM_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500] as const

interface Part {
  readonly from: Chainage
  readonly to: Chainage
  readonly meters: number
  /** Левый край части на листе, мм. */
  readonly left: number
}
interface PreparedLine {
  readonly line: OverviewLine
  readonly lengths: KmLengths
  readonly parts: readonly Omit<Part, 'left'>[]
}
interface Interval {
  readonly from: number
  readonly to: number
}

/** «300 000»: разряды через пробел, без неразрывных пробелов локали. */
const grouped = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ' ')

const overlaps = (a: Interval, b: Interval, margin: number): boolean =>
  a.from < b.to + margin && b.from < a.to + margin

function prepareLines(source: OverviewSource): Result<readonly PreparedLine[], SheetError> {
  if (source.lines.length > 1000 || source.axes.length > 50000 || source.boundaries.length > 50000)
    return err({ message: 'Слишком много объектов для одного документа.' })
  const ids = new Set<string>()
  const prepared: PreparedLine[] = []
  for (const current of source.lines) {
    if (ids.has(current.id)) return err({ message: 'Повторяется идентификатор направления.' })
    ids.add(current.id)
    const lengths = KmLengths.of(current.kmLengths)
    if (!lengths.ok) return err({ message: describeChainageError(lengths.error) })
    const parts: Omit<Part, 'left'>[] = []
    let previous: Chainage | undefined
    for (const span of current.extents.toSorted((a, b) => compareChainage(a.from, b.from))) {
      const a = chainage(span.from.km, span.from.m, lengths.value),
        b = chainage(span.to.km, span.to.m, lengths.value)
      if (!a.ok) return err({ message: `${current.name}: ${describeChainageError(a.error)}` })
      if (!b.ok) return err({ message: `${current.name}: ${describeChainageError(b.error)}` })
      if (compareChainage(a.value, b.value) >= 0 || b.value.km - a.value.km > 100_000)
        return err({ message: `${current.name}: недопустимый диапазон направления.` })
      if (previous && compareChainage(previous, a.value) > 0)
        return err({ message: `${current.name}: части протяжения перекрываются.` })
      previous = b.value
      parts.push({
        from: a.value,
        to: b.value,
        meters: distance(a.value, b.value, lengths.value),
      })
    }
    if (parts.length) prepared.push({ line: current, lengths: lengths.value, parts })
  }
  return ok(prepared)
}

const drawnWidth = (line: PreparedLine, scale: number): number =>
  line.parts.reduce((sum, p) => sum + (p.meters * 1000) / scale, 0) + GAP * (line.parts.length - 1)

/** Самый крупный масштаб ряда, при котором каждое направление помещается в ширину листа. */
export function districtScale(lines: readonly PreparedLine[]): Result<DistrictScale, SheetError> {
  const found = DISTRICT_SCALES.find((scale) =>
    lines.every((l) => drawnWidth(l, scale) <= TRACK_RIGHT - TRACK_LEFT),
  )
  return found
    ? ok(found)
    : err({ message: 'Направление длиннее 740 км не помещается на лист А3 даже в 1:2 000 000.' })
}

interface Label {
  readonly text: string
  /** Точка привязки на линии направления. */
  readonly x: number
  readonly width: number
}
interface Placed extends Label {
  readonly lane: number
  readonly left: number
}

/**
 * Подписи в полосах лесенкой: подпись начинается у своей оси и идёт вправо, поэтому
 * подписи ставятся справа налево — левая станция плотной группы уходит в полосу выше.
 * Подпись не перекрывает подписи своей полосы, её выноска не проходит через подписи
 * нижних полос, а сама подпись не закрывает выноски верхних.
 */
function placeLabels(labels: readonly Label[]): readonly Placed[] | undefined {
  const placed: Placed[] = []
  for (const label of labels.toSorted((a, b) => b.x - a.x || a.text.localeCompare(b.text))) {
    const left = Math.max(LEFT, Math.min(label.x - 0.8, RIGHT - label.width))
    const span = { from: left, to: left + label.width }
    let lane = 0
    for (; lane < MAX_LANES; lane++) {
      const free = placed.every((p) => {
        const other = { from: p.left, to: p.left + p.width }
        if (p.lane === lane) return !overlaps(span, other, 1.5)
        if (p.lane < lane && label.x >= other.from - 0.8 && label.x <= other.to + 0.8) return false
        if (p.lane > lane && p.x >= span.from - 0.8 && p.x <= span.to + 0.8) return false
        return true
      })
      if (free) break
    }
    if (lane === MAX_LANES) return undefined
    placed.push({ ...label, lane, left })
  }
  return placed
}

interface Column extends Label {
  /** Середина столбца подписи на листе. */
  readonly column: number
}
/** Ширина столбца вертикальной подписи и высота выноски над линией, мм. */
const COLUMN = 3
const LIFT = 4

/**
 * Столбцы вертикальных подписей станций: не ближе ширины столбца друг к другу; тесные
 * группы раздвигаются вправо, у правого края — влево. undefined — подписи не помещаются
 * в ширину листа.
 */
function placeColumns(labels: readonly Label[]): readonly Column[] | undefined {
  const sorted = labels.toSorted((a, b) => a.x - b.x || a.text.localeCompare(b.text))
  const columns = sorted.map((l) => l.x)
  for (let i = 1; i < columns.length; i++)
    columns[i] = Math.max(columns[i] ?? 0, (columns[i - 1] ?? 0) + COLUMN)
  const last = columns.length - 1
  if (last >= 0) columns[last] = Math.min(columns[last] ?? 0, RIGHT - COLUMN / 2)
  for (let i = last - 1; i >= 0; i--)
    columns[i] = Math.min(columns[i] ?? 0, (columns[i + 1] ?? 0) - COLUMN)
  if (columns.length && (columns[0] ?? 0) < LEFT + COLUMN / 2) return undefined
  return sorted.map((label, i) => ({ ...label, column: columns[i] ?? label.x }))
}

interface Row {
  readonly height: number
  readonly shapes: readonly SheetPrimitive[]
}

/** Ряд направления в координатах от его верхнего края. */
function drawLine(
  prepared: PreparedLine,
  source: OverviewSource,
  scale: DistrictScale,
  measurer: TextMeasurer,
): Result<Row, SheetError> {
  const { line: current, lengths } = prepared
  const shapes: SheetPrimitive[] = []
  const title = textBlock(current.name, LEFT, 4, RIGHT - LEFT, 1, bold(3), measurer)
  if (!title.ok) return title
  shapes.push(...title.value)
  let cursor = TRACK_LEFT
  const parts: Part[] = prepared.parts.map((p) => {
    const part = { ...p, left: cursor }
    cursor += (p.meters * 1000) / scale + GAP
    return part
  })
  const xOf = (at: Chainage): number | undefined => {
    const part = parts.find(
      (p) => compareChainage(p.from, at) <= 0 && compareChainage(at, p.to) <= 0,
    )
    return part && part.left + (distance(part.from, at, lengths) * 1000) / scale
  }
  const right = (p: Part) => p.left + (p.meters * 1000) / scale
  // Подписи станций над линией.
  const axes = source.axes.filter((a) => a.lineId === current.id && xOf(a.at) !== undefined)
  const labels: Label[] = []
  for (const axis of axes) {
    const at = chainage(axis.at.km, axis.at.m, lengths)
    if (!at.ok) return err({ message: `${axis.name}: ${describeChainageError(at.error)}` })
    const width = measurer.width(axis.name, LABEL).value
    if (width > RIGHT - LEFT)
      return err({ message: `Название станции «${axis.name.slice(0, 60)}» шире листа.` })
    labels.push({ text: axis.name, x: xOf(at.value) ?? 0, width })
  }
  const placed = placeColumns(labels)
  if (!placed)
    return err({
      message: `${current.name}: станции стоят слишком часто, их названия не помещаются над линией.`,
    })
  const tallest = Math.max(0, ...placed.map((p) => p.width))
  // Названия станций читаются снизу вверх над своей осью; при тесноте столбец подписи
  // сдвигается вбок, выноска ведёт от оси к подписи.
  const lineY = 9 + tallest + LIFT + 2
  const labelShapes: SheetPrimitive[] = []
  for (const p of placed) {
    const foot = lineY - LIFT
    shapes.push(line(p.x, lineY - 0.9, p.x, lineY - 1.6), line(p.x, lineY - 1.6, p.column, foot))
    labelShapes.push({
      kind: 'text',
      text: p.text,
      x: mm(p.column + COLUMN / 2 - 0.5),
      y: mm(foot - 0.3),
      font: LABEL,
      rotate: -90,
    })
  }
  // Линия направления, разрывы и километры.
  const kmMm = (1_000_000 / scale) * 1
  const step = KM_STEPS.find((k) => k * kmMm >= 9) ?? 500
  const tickY = lineY + 4
  // Координаты концов частей подписываются всегда: если не помещаются в строку отметок,
  // уходят в следующую строку. Номера километров ставятся только в свободные места первой.
  const coordinateRows: Interval[][] = [[]]
  const placeCoordinate = (value: string, left: number): void => {
    const w = measurer.width(value, LABEL).value
    const x = Math.max(LEFT, Math.min(left, RIGHT - w))
    const span = { from: x, to: x + w }
    let row = coordinateRows.findIndex((used) => used.every((u) => !overlaps(u, span, 1.5)))
    if (row < 0) row = coordinateRows.push([]) - 1
    coordinateRows[row]?.push(span)
    shapes.push(text(value, x, tickY + 2.5 + row * 3.5, LABEL))
  }
  for (const [i, part] of parts.entries()) {
    shapes.push(thick(part.left, lineY, right(part), lineY, 0.8))
    const next = parts[i + 1]
    if (next) {
      shapes.push(
        line(right(part) + 1, lineY, next.left - 1, lineY, true),
        line(right(part) + 1, lineY + 1.5, right(part) + 3, lineY - 1.5),
        line(next.left - 3, lineY + 1.5, next.left - 1, lineY - 1.5),
      )
    }
    for (const x of [part.left, right(part)]) shapes.push(line(x, lineY - 1.2, x, lineY + 1.2))
    placeCoordinate(formatPlus(part.from), part.left)
    const endLabel = formatPlus(part.to)
    placeCoordinate(endLabel, right(part) - measurer.width(endLabel, LABEL).value)
  }
  for (const part of parts)
    for (let km = Math.ceil(part.from.km / step) * step; km <= part.to.km; km += step) {
      const at = { km, m: 0 }
      if (compareChainage(at, part.from) <= 0 || compareChainage(at, part.to) >= 0) continue
      const x = xOf(at)
      if (x === undefined) continue
      shapes.push(line(x, lineY - 0.8, x, lineY + 0.8))
      const value = String(km)
      const w = measurer.width(value, LABEL).value
      const span = { from: x - w / 2, to: x + w / 2 }
      const first = coordinateRows[0] ?? []
      if (first.some((u) => overlaps(u, span, 1.5))) continue
      first.push(span)
      shapes.push(text(value, span.from, tickY + 2.5, LABEL))
    }
  for (const p of placed) shapes.push({ kind: 'circle', x: mm(p.x), y: mm(lineY), radius: mm(0.9) })
  // Полосы ПД и ПЧУ под линией: ПД — белые, ПЧУ — серые, подпись внутри или в полосе подписей.
  const pdY = tickY + 5 + (coordinateRows.length - 1) * 3.5,
    pchuY = pdY + BAND + 1
  interface Span extends Interval {
    readonly code: string
    readonly pchu: string | undefined
  }
  const spans: Span[] = []
  for (const b of source.boundaries) {
    if (b.lineId !== current.id) continue
    // Граница проверяется по длинам километров так же, как на общей схеме.
    if (
      !chainage(b.from.km, b.from.m, lengths).ok ||
      !chainage(b.to.km, b.to.m, lengths).ok ||
      compareChainage(b.from, b.to) >= 0
    )
      return err({ message: `${b.code}: недопустимая граница ПД.` })
    for (const part of parts) {
      const from = compareChainage(b.from, part.from) < 0 ? part.from : b.from
      const to = compareChainage(b.to, part.to) > 0 ? part.to : b.to
      if (compareChainage(from, to) >= 0) continue
      const left = xOf(from),
        rightX = xOf(to)
      if (left === undefined || rightX === undefined) continue
      spans.push({ from: left, to: rightX, code: b.code, pchu: b.pchu })
    }
  }
  spans.sort((a, b) => a.from - b.from)
  for (const [i, s] of spans.entries())
    if (i > 0 && s.from < (spans[i - 1]?.to ?? s.from) - 0.001)
      return err({ message: `${current.name}: границы ПД перекрываются; проверьте оргструктуру.` })
  const outside: Label[] = []
  const bandLabel = (code: string, s: Interval, y: number): void => {
    const width = measurer.width(code, LABEL).value
    if (width <= s.to - s.from - 1)
      shapes.push(text(code, (s.from + s.to - width) / 2, y + BAND - 1.4, LABEL))
    else outside.push({ text: code, x: (s.from + s.to) / 2, width })
  }
  for (const s of spans) {
    shapes.push(rect(s.from, pdY, s.to - s.from, BAND))
    bandLabel(s.code, s, pdY)
  }
  // ПЧУ: подряд идущие участки ПД одного ПЧУ без разрыва сливаются.
  const pchus: (Interval & { code: string })[] = []
  for (const s of spans) {
    if (s.pchu === undefined) continue
    const last = pchus.at(-1)
    if (last && last.code === s.pchu && Math.abs(last.to - s.from) < 0.001)
      pchus[pchus.length - 1] = { ...last, to: s.to }
    else pchus.push({ from: s.from, to: s.to, code: s.pchu })
  }
  for (const p of pchus) {
    shapes.push(rect(p.from, pchuY, p.to - p.from, BAND, true))
    bandLabel(p.code, p, pchuY)
  }
  let height = pchuY + BAND + 3
  // Узкие участки подписываются под полосами, как станции над линией, но сверху вниз.
  if (outside.length) {
    const below = placeLabels(outside)
    if (!below)
      return err({ message: `${current.name}: подписи узких участков ПД и ПЧУ не помещаются.` })
    const top = pchuY + BAND
    for (const p of below) {
      const baseline = top + 4 + p.lane * LANE
      shapes.push(line(p.x, top - 0.2, p.x, baseline - 2.4))
      labelShapes.push(
        rect(p.left - 0.4, baseline - 2.2, p.width + 0.8, 2.9, false, false),
        text(p.text, p.left, baseline, LABEL),
      )
    }
    height = top + 4 + (Math.max(...below.map((p) => p.lane)) + 1) * LANE
  }
  return ok({ height: height + 3, shapes: [...shapes, ...labelShapes] })
}

/** Листы варианта A: направления сверху вниз, переполнение начинает новый лист. */
export function buildDistrictSchemeA(
  source: OverviewSource,
  measurer: TextMeasurer,
): Result<DistrictDocument, SheetError> {
  const prepared = prepareLines(source)
  if (!prepared.ok) return prepared
  const scale = districtScale(prepared.value)
  if (!scale.ok) return scale
  const warnings = [...source.warnings]
  for (const axis of source.axes)
    if (
      !source.lines.some(
        (l) =>
          l.id === axis.lineId &&
          l.extents.some(
            (e) => compareChainage(e.from, axis.at) <= 0 && compareChainage(axis.at, e.to) <= 0,
          ),
      )
    )
      warnings.push(
        `Ось ${axis.name} ${formatPlus(axis.at)} вне протяжения направления и не показана.`,
      )
  if (source.boundaries.some((b) => b.pchu === undefined))
    warnings.push('У части ПД не найдено ПЧУ в оргструктуре: их участки без полосы ПЧУ.')
  const pages: SheetPage[] = []
  let shapes: SheetPrimitive[] = [],
    y = TOP
  const flush = (): Result<null, SheetError> => {
    if (pages.length >= MAX_PAGES) return err({ message: 'Документ превышает 200 листов.' })
    const header = textBlock(
      `Схема дистанции · ${source.edition.label}`,
      LEFT,
      19,
      240,
      1,
      bold(4),
      measurer,
    )
    if (!header.ok) return header
    pages.push({
      width: mm(420),
      height: mm(297),
      number: pages.length + 1,
      primitives: [
        rect(10, 10, 400, 277),
        ...header.value,
        text('Вариант A — линейная в масштабе', LEFT, 26, regular(2.8)),
        ...shapes,
        thick(LEFT, 265, LEFT + 12, 265, 0.8),
        text('Главный путь', LEFT + 15, 266),
        { kind: 'circle', x: mm(80), y: mm(265), radius: mm(0.9) },
        text('Ось станции', 84, 266),
        rect(130, 263, 12, BAND - 1),
        text('ПД', 145, 266),
        rect(165, 263, 12, BAND - 1, true),
        text('ПЧУ', 180, 266),
        line(205, 265, 217, 265, true),
        text('Чужая дистанция (разрыв без масштаба)', 220, 266),
        ...(warnings.length
          ? [
              text(
                `Замечаний: ${warnings.length}. Проверьте список в предпросмотре.`,
                LEFT,
                274,
                regular(2.6),
              ),
            ]
          : []),
        text(
          `Редакция от ${source.edition.date} · Масштаб 1:${grouped(scale.value)} · Лист ${pages.length + 1}`,
          LEFT,
          281,
          regular(2.8),
        ),
      ],
    })
    shapes = []
    y = TOP
    return ok(null)
  }
  for (const current of prepared.value) {
    const row = drawLine(current, source, scale.value, measurer)
    if (!row.ok) return row
    if (TOP + row.value.height > BOTTOM)
      return err({ message: `${current.line.name}: направление не помещается на лист по высоте.` })
    if (y + row.value.height > BOTTOM) {
      const saved = flush()
      if (!saved.ok) return saved
    }
    shapes.push(...moveShapes(row.value.shapes, y))
    y += row.value.height
  }
  if (!prepared.value.length)
    shapes.push(text('Нет направлений. Загрузите оргструктуру паспорта.', LEFT, y + 10))
  const saved = flush()
  if (!saved.ok) return saved
  return ok({ pages, warnings, scale: scale.value })
}
