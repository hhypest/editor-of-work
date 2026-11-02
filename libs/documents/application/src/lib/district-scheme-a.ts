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
  type SheetFont,
  type SheetPage,
  type SheetPrimitive,
  type TextMeasurer,
} from './sheet-model'
import { bold, narrow, regular } from './sheet-text'
import { moveShapes, sheetLine as line, sheetThickLine as thick } from './sheet-drawing'
import {
  CAPTION,
  colored,
  DISTRICT_RED,
  districtHeader,
  fillRect,
  kmText,
  LEFT,
  PCHU_FILLS,
  plural,
  RIGHT,
  text,
  WHITE,
  type TextOptions,
} from './district-common'

export { DISTRICT_RED, genitiveTitle, kmText, plural } from './district-common'

/**
 * Схема дистанции, вариант A (#33, ADR-0050) по согласованному образцу: каждое направление —
 * линия в общем для листа масштабе по главному пути, станции по осям с числом путей и
 * стрелок, полосы ПД и ПЧУ с руководителями, красные границы участков с координатами.
 * Короткие направления встают в ряд рядом друг с другом.
 */
export interface DistrictDocument extends OverviewDocument {
  /** Километров в одном сантиметре листа: «1 см ≈ 3,9 км». */
  readonly kmPerCm: number
}

const GRAY = '#9a9a9a'
const PD_FILLS = ['#ececec', '#d4d4d4'] as const

/** Ширина, в которую вписывается самое длинное направление, мм. */
const FIT_WIDTH = 355
/** Разрыв протяжения (чужая дистанция) рисуется пунктиром постоянной длины, мм. */
const GAP = 12
/** Расстояние между направлениями одного ряда, мм. */
const BLOCK_GAP = 24
/** Отступ ряда слева: подписи первой станции и координаты могут выходить левее линии. */
const INDENT = 8
const TOP = 36,
  BOTTOM = 276
const MAX_PAGES = 50
/** Столбец станции: название над линией и сведения под ней, мм. */
const COLUMN = 5.6
const NAME = bold(2.6)
const INFO = narrow(2.4)
const BAND = 5.6
const LABEL = bold(2.6)
const COORD = regular(2.4)
const EPS = 0.001

interface Part {
  readonly from: Chainage
  readonly to: Chainage
  readonly meters: number
}
interface Prepared {
  readonly line: OverviewLine
  readonly lengths: KmLengths
  readonly parts: readonly Part[]
  readonly meters: number
}

function prepareLines(source: OverviewSource): Result<readonly Prepared[], SheetError> {
  if (source.lines.length > 1000 || source.axes.length > 50000 || source.boundaries.length > 50000)
    return err({ message: 'Слишком много объектов для одного документа.' })
  const ids = new Set<string>()
  const prepared: Prepared[] = []
  for (const current of source.lines) {
    if (ids.has(current.id)) return err({ message: 'Повторяется идентификатор направления.' })
    ids.add(current.id)
    const lengths = KmLengths.of(current.kmLengths)
    if (!lengths.ok) return err({ message: describeChainageError(lengths.error) })
    const parts: Part[] = []
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
      parts.push({ from: a.value, to: b.value, meters: distance(a.value, b.value, lengths.value) })
    }
    if (parts.length)
      prepared.push({
        line: current,
        lengths: lengths.value,
        parts,
        meters: parts.reduce((n, p) => n + p.meters, 0),
      })
  }
  return ok(prepared)
}

/**
 * Масштаб по главному пути: километров в сантиметре с одним знаком после запятой, при котором
 * самое длинное направление помещается в ширину листа.
 */
export function districtKmPerCm(lines: readonly { readonly meters: number }[]): number {
  const longest = Math.max(1, ...lines.map((l) => l.meters))
  return Math.max(0.1, Math.ceil((longest / 1000 / (FIT_WIDTH / 10)) * 10 - 1e-9) / 10)
}

interface Station {
  readonly x: number
  readonly name: string
  readonly info: readonly [string, string]
}
interface Column extends Station {
  readonly column: number
}

/** Столбцы станций не ближе COLUMN; тесные группы раздвигаются вправо, у края — влево. */
function placeColumns(
  stations: readonly Station[],
  left: number,
  right: number,
): readonly Column[] | undefined {
  const sorted = stations.toSorted((a, b) => a.x - b.x || a.name.localeCompare(b.name, 'ru'))
  const columns = sorted.map((s) => s.x)
  for (let i = 1; i < columns.length; i++)
    columns[i] = Math.max(columns[i] ?? 0, (columns[i - 1] ?? 0) + COLUMN)
  const last = columns.length - 1
  if (last >= 0) columns[last] = Math.min(columns[last] ?? 0, right)
  for (let i = last - 1; i >= 0; i--)
    columns[i] = Math.min(columns[i] ?? 0, (columns[i + 1] ?? 0) - COLUMN)
  if (columns.length && (columns[0] ?? 0) < left) return undefined
  return sorted.map((s, i) => ({ ...s, column: columns[i] ?? s.x }))
}

interface Block {
  readonly width: number
  readonly height: number
  readonly shapes: readonly SheetPrimitive[]
}

interface Span {
  readonly from: number
  readonly to: number
  readonly code: string
  readonly pchu: string | undefined
  readonly start: Chainage
  readonly end: Chainage
}

/** Общие для листа сведения, которые нужны каждому направлению. */
interface Context {
  readonly source: OverviewSource
  readonly measurer: TextMeasurer
  readonly mmPerMeter: number
  readonly unbound: ReadonlySet<string>
  /** Порядок ПЧУ задаёт их заливку одинаково на всех направлениях. */
  readonly pchuOrder: readonly string[]
  /** Станции, уже подписанные числом путей и стрелок на другом направлении. */
  readonly counted: Set<string>
}

function drawBlock(prepared: Prepared, context: Context): Result<Block, SheetError> {
  const { source, measurer, mmPerMeter } = context
  const { line: current, lengths, parts } = prepared
  const back: SheetPrimitive[] = [],
    front: SheetPrimitive[] = []
  const starts: number[] = []
  let cursor = 0
  for (const p of parts) {
    starts.push(cursor)
    cursor += p.meters * mmPerMeter + GAP
  }
  const trackWidth = cursor - GAP
  const xOf = (at: Chainage): number | undefined => {
    const index = parts.findIndex(
      (p) => compareChainage(p.from, at) <= 0 && compareChainage(at, p.to) <= 0,
    )
    const part = parts[index]
    return part && (starts[index] ?? 0) + distance(part.from, at, lengths) * mmPerMeter
  }
  // Заголовок: направление, длина главного пути, части вне дистанции.
  const gaps = parts
    .slice(1)
    .map(
      (p, i) =>
        `км ${formatPlus(parts[i]?.to ?? p.from)} — ${formatPlus(p.from)} не входит в дистанцию`,
    )
  const tail = ` · ${[`${kmText(prepared.meters)} км`, ...gaps].join(' · ')}`
  const nameWidth = measurer.width(current.name, bold(3)).value
  const titleWidth = nameWidth + measurer.width(tail, regular(3)).value
  front.push(text(current.name, 0, 3, bold(3)), text(tail, nameWidth, 3, regular(3)))
  // Станции: только привязанные к ПД; непривязанные названы в примечании листа.
  const stations: Station[] = []
  for (const axis of source.axes) {
    if (axis.lineId !== current.id || context.unbound.has(axis.name)) continue
    const at = chainage(axis.at.km, axis.at.m, lengths)
    if (!at.ok) return err({ message: `${axis.name}: ${describeChainageError(at.error)}` })
    const x = xOf(at.value)
    if (x === undefined) continue
    const stats = source.stationStats?.[axis.name]
    const repeated = context.counted.has(axis.name)
    if (stats) context.counted.add(axis.name)
    stations.push({
      x,
      name: axis.name,
      info: [
        `км ${formatPlus(at.value)}`,
        repeated ? 'учтена выше' : stats ? `${stats.tracks} п. · ${stats.switches} стр.` : '',
      ],
    })
  }
  const placed = placeColumns(stations, -COLUMN, trackWidth + COLUMN)
  if (!placed)
    return err({
      message: `${current.name}: станции стоят слишком часто, их названия не помещаются над линией.`,
    })
  const tallest = Math.max(0, ...placed.map((p) => measurer.width(p.name, NAME).value))
  const lineY = 11 + tallest
  const infoHeight = Math.max(
    0,
    ...placed.flatMap((p) => p.info.map((t) => measurer.width(t, INFO).value)),
  )
  const pdY = lineY + 5 + infoHeight + 3,
    pchuY = pdY + BAND + 0.6,
    coordY = pchuY + BAND + 3.4
  // Главный путь и разрывы протяжения.
  for (const [i, part] of parts.entries()) {
    const x0 = starts[i] ?? 0,
      x1 = x0 + part.meters * mmPerMeter
    back.push(
      thick(x0, lineY, x1, lineY, 0.8),
      thick(x0, lineY - 1.6, x0, lineY + 1.6, 0.5),
      thick(x1, lineY - 1.6, x1, lineY + 1.6, 0.5),
    )
    if (i + 1 < parts.length)
      back.push(colored(thick(x1 + 1.5, lineY, x1 + GAP - 1.5, lineY, 0.8, { dashed: true }), GRAY))
  }
  // Станции: квадрат на оси, название над ним, координата и число путей и стрелок под ним.
  for (const p of placed) {
    const top = lineY - 1.6,
      bottom = lineY + 1.6
    if (Math.abs(p.column - p.x) > EPS)
      back.push(line(p.x, top, p.column, top - 1.4), line(p.x, bottom, p.column, bottom + 1.4))
    front.push(
      {
        kind: 'rect',
        x: mm(p.x - 1.4),
        y: mm(lineY - 1.4),
        width: mm(2.8),
        height: mm(2.8),
        shade: false,
        border: true,
      },
      text(p.name, p.column + 0.9, top - 2, NAME, { rotate: -90 }),
    )
    for (const [i, info] of p.info.entries()) {
      if (!info) continue
      const w = measurer.width(info, INFO).value
      front.push(text(info, p.column - 0.3 + i * 2.5, bottom + 2 + w, INFO, { rotate: -90 }))
    }
  }
  // Полосы ПД по пересечению границ с частями протяжения.
  const spans: Span[] = []
  for (const b of source.boundaries) {
    if (b.lineId !== current.id) continue
    if (
      !chainage(b.from.km, b.from.m, lengths).ok ||
      !chainage(b.to.km, b.to.m, lengths).ok ||
      compareChainage(b.from, b.to) >= 0
    )
      return err({ message: `${b.code}: недопустимая граница ПД.` })
    for (const part of parts) {
      const start = compareChainage(b.from, part.from) < 0 ? part.from : b.from
      const end = compareChainage(b.to, part.to) > 0 ? part.to : b.to
      if (compareChainage(start, end) >= 0) continue
      const from = xOf(start),
        to = xOf(end)
      if (from === undefined || to === undefined) continue
      spans.push({ from, to, code: b.code, pchu: b.pchu, start, end })
    }
  }
  spans.sort((a, b) => a.from - b.from)
  for (const [i, s] of spans.entries())
    if (i > 0 && s.from < (spans[i - 1]?.to ?? s.from) - EPS)
      return err({ message: `${current.name}: границы ПД перекрываются; проверьте оргструктуру.` })
  const heads = source.heads ?? {}
  const caption = (code: string): string => (heads[code] ? `${code} · ${heads[code]}` : code)
  /** Подпись полосы: с руководителем, без него или никакой, если полоса узкая. */
  const fitted = (code: string, width: number): string | undefined =>
    [caption(code), code].find((v) => measurer.width(v, LABEL).value <= width - 1.5)
  let previousCode: string | undefined,
    shade = 0
  for (const s of spans) {
    if (previousCode !== undefined && previousCode !== s.code) shade++
    previousCode = s.code
    back.push(fillRect(s.from, pdY, s.to - s.from, BAND, PD_FILLS[shade % PD_FILLS.length] ?? ''))
    const value = fitted(s.code, s.to - s.from)
    if (value)
      front.push(text(value, (s.from + s.to) / 2, pdY + BAND - 1.7, LABEL, { anchor: 'middle' }))
  }
  // ПЧУ: подряд идущие ПД одного ПЧУ без разрыва дают одну полосу.
  const pchus: { from: number; to: number; code: string }[] = []
  for (const s of spans) {
    if (s.pchu === undefined) continue
    const last = pchus.at(-1)
    if (last && last.code === s.pchu && Math.abs(last.to - s.from) < EPS) last.to = s.to
    else pchus.push({ from: s.from, to: s.to, code: s.pchu })
  }
  for (const p of pchus) {
    const index = Math.max(0, context.pchuOrder.indexOf(p.code))
    back.push(
      fillRect(p.from, pchuY, p.to - p.from, BAND, PCHU_FILLS[index % PCHU_FILLS.length] ?? ''),
    )
    const value = fitted(p.code, p.to - p.from)
    if (value)
      front.push(
        text(value, (p.from + p.to) / 2, pchuY + BAND - 1.7, LABEL, {
          color: WHITE,
          anchor: 'middle',
        }),
      )
  }
  // Границы: ПЧУ и края участков — сплошная красная, ПД — красный пунктир; координаты под полосами.
  const edges: { x: number; at: Chainage; solid: boolean }[] = []
  for (const [i, s] of spans.entries()) {
    const prev = spans[i - 1]
    const joined = prev !== undefined && Math.abs(prev.to - s.from) < EPS
    edges.push({ x: s.from, at: s.start, solid: !joined || prev.pchu !== s.pchu })
    const next = spans[i + 1]
    if (!(next && Math.abs(next.from - s.to) < EPS)) edges.push({ x: s.to, at: s.end, solid: true })
  }
  const used: { from: number; to: number }[] = []
  for (const edge of edges) {
    back.push(
      colored(
        edge.solid
          ? thick(edge.x, lineY - 5, edge.x, pchuY + BAND + 0.6, 0.7)
          : thick(edge.x, lineY - 4, edge.x, pchuY + BAND + 0.6, 0.35, { dashed: true }),
        DISTRICT_RED,
      ),
    )
    const value = `км ${formatPlus(edge.at)}`
    const w = measurer.width(value, COORD).value
    const x = Math.max(edge.x - w / 2, (used.at(-1)?.to ?? -Infinity) + 1.5)
    used.push({ from: x, to: x + w })
    front.push(text(value, x, coordY, COORD, { color: DISTRICT_RED }))
  }
  const width = Math.max(trackWidth + COLUMN, titleWidth, ...used.map((u) => u.to))
  return ok({ width, height: coordY + 5, shapes: [...back, ...front] })
}

const shiftX = (shape: SheetPrimitive, dx: number): SheetPrimitive =>
  shape.kind === 'line'
    ? { ...shape, x1: mm(shape.x1.value + dx), x2: mm(shape.x2.value + dx) }
    : { ...shape, x: mm(shape.x.value + dx) }

/** Сводка листа: итоги, станции примыкания, станции без привязки к ПД. */
interface Summary {
  readonly totals: string
  readonly notes: string
}

function summarize(
  source: OverviewSource,
  prepared: readonly Prepared[],
  unbound: ReadonlySet<string>,
  kmPerCm: number,
): Summary {
  const mainMeters = prepared.reduce((n, l) => n + l.meters, 0)
  const shown = new Set(prepared.map((p) => p.line.id))
  const drawn = [
    ...new Set(
      source.axes.filter((a) => shown.has(a.lineId) && !unbound.has(a.name)).map((a) => a.name),
    ),
  ]
  const stats = drawn.map((n) => source.stationStats?.[n])
  const stationMeters = stats.reduce((n, s) => n + (s?.meters ?? 0), 0)
  const switches = stats.reduce((n, s) => n + (s?.switches ?? 0), 0)
  const junctions = drawn.flatMap((name) => {
    const lines = [...new Set(source.axes.filter((a) => a.name === name).map((a) => a.lineId))].map(
      (id) => source.lines.find((l) => l.id === id)?.name ?? id,
    )
    return lines.length > 1 ? [`${name} — станция примыкания направлений ${lines.join(', ')}.`] : []
  })
  return {
    totals: [
      `Всего: главный путь ${kmText(mainMeters)} км`,
      ...(source.stationStats ? [`станционные пути ${kmText(stationMeters)} км`] : []),
      ...(source.stationStats
        ? [plural(switches, 'стрелочный перевод', 'стрелочных перевода', 'стрелочных переводов')]
        : []),
      plural(drawn.length, 'станция', 'станции', 'станций'),
    ].join(' · '),
    notes: [
      `Масштаб по главному пути: 1 см ≈ ${String(kmPerCm).replace('.', ',')} км.`,
      ...junctions,
      ...(unbound.size ? [`Не входят в привязку к ПД: ${[...unbound].join(', ')}.`] : []),
    ].join(' '),
  }
}

function frame(
  source: OverviewSource,
  summary: Summary,
  number: number,
  warnings: number,
  measurer: TextMeasurer,
): SheetPrimitive[] {
  const right = (value: string, y: number, font: SheetFont, options: TextOptions = {}) =>
    text(value, RIGHT - measurer.width(value, font).value, y, font, options)
  return [
    ...districtHeader(
      source,
      'Линейная схема в масштабе по километрам: главные пути, станции по осям, линейные (ПД) и эксплуатационные (ПЧУ) участки',
      measurer,
    ),
    thick(LEFT, 280, RIGHT, 280, 0.3),
    {
      kind: 'rect',
      x: mm(LEFT),
      y: mm(282.6),
      width: mm(2.8),
      height: mm(2.8),
      shade: false,
      border: true,
    },
    text('станция (ось)', LEFT + 4.5, 285, regular(2.6)),
    colored(thick(42, 282.4, 42, 285.8, 0.35, { dashed: true }), DISTRICT_RED),
    text('граница ПД', 44, 285, regular(2.6)),
    colored(thick(64, 282.4, 64, 285.8, 0.7), DISTRICT_RED),
    text('граница ПЧУ', 66, 285, regular(2.6)),
    text('«3 п. · 10 стр.» — станционных путей / стрелочных переводов', 88, 285, regular(2.6)),
    right(summary.totals, 285, bold(2.6)),
    text(summary.notes, LEFT, 290, regular(2.4)),
    ...(warnings
      ? [
          right(`Замечаний: ${warnings}; список — в предпросмотре.`, 290, regular(2.4), {
            color: DISTRICT_RED,
          }),
        ]
      : []),
    text(
      `Редакция от ${source.edition.date.split('-').reverse().join('.')} · Лист ${number}`,
      LEFT,
      294.5,
      regular(2.2),
      { color: CAPTION },
    ),
  ]
}

/** Листы варианта A по образцу: направления рядами, короткие — рядом друг с другом. */
export function buildDistrictSchemeA(
  source: OverviewSource,
  measurer: TextMeasurer,
): Result<DistrictDocument, SheetError> {
  const prepared = prepareLines(source)
  if (!prepared.ok) return prepared
  const kmPerCm = districtKmPerCm(prepared.value)
  const unbound = new Set(source.unboundStations ?? [])
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
  if (source.heads) {
    const missing = [
      ...new Set(source.boundaries.flatMap((b) => [b.code, ...(b.pchu ? [b.pchu] : [])])),
    ].filter((code) => !source.heads?.[code])
    if (missing.length)
      warnings.push(
        `Нет руководителя на листе «Руководители» шаблона ручных данных: ${missing.join(', ')}.`,
      )
  }
  if (!source.district?.trim())
    warnings.push('Нет названия дистанции: заполните строку «Дистанция» листа «Руководители».')
  const context: Context = {
    source,
    measurer,
    mmPerMeter: 10 / (kmPerCm * 1000),
    unbound,
    pchuOrder: [...new Set(source.boundaries.flatMap((b) => (b.pchu ? [b.pchu] : [])))].toSorted(
      (a, b) => a.localeCompare(b, 'ru', { numeric: true }),
    ),
    counted: new Set(),
  }
  const blocks: Block[] = []
  for (const current of prepared.value) {
    const block = drawBlock(current, context)
    if (!block.ok) return block
    if (TOP + block.value.height > BOTTOM)
      return err({ message: `${current.line.name}: направление не помещается на лист по высоте.` })
    blocks.push(block.value)
  }
  // Ряды: направление встаёт правее предыдущего, если ряд вмещает его целиком.
  const rows: Block[][] = []
  for (const block of blocks) {
    const row = rows.at(-1)
    const used = row?.reduce((n, b) => n + b.width + BLOCK_GAP, 0) ?? 0
    if (row?.length && LEFT + INDENT + used + block.width <= RIGHT) row.push(block)
    else rows.push([block])
  }
  const bodies: SheetPrimitive[][] = [[]]
  let y = TOP
  for (const row of rows) {
    const height = Math.max(...row.map((b) => b.height))
    if (y + height > BOTTOM && y > TOP) {
      if (bodies.length >= MAX_PAGES) return err({ message: 'Документ превышает 50 листов.' })
      bodies.push([])
      y = TOP
    }
    let x = LEFT + INDENT
    for (const block of row) {
      bodies.at(-1)?.push(
        ...moveShapes(
          block.shapes.map((s) => shiftX(s, x)),
          y,
        ),
      )
      x += block.width + BLOCK_GAP
    }
    y += height + 3
  }
  if (!prepared.value.length)
    bodies[0]?.push(
      text('Нет направлений. Загрузите оргструктуру паспорта.', LEFT, TOP + 10, regular()),
    )
  const summary = summarize(source, prepared.value, unbound, kmPerCm)
  const pages: SheetPage[] = bodies.map((body, i) => ({
    width: mm(420),
    height: mm(297),
    number: i + 1,
    primitives: [...frame(source, summary, i + 1, warnings.length, measurer), ...body],
  }))
  return ok({ pages, warnings, kmPerCm })
}
