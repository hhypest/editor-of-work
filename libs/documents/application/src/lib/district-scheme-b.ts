import {
  compareChainage,
  distance,
  err,
  formatPlus,
  ok,
  type Chainage,
  type Result,
} from '@eow/shared/kernel'
import {
  mm,
  type OverviewDocument,
  type OverviewSource,
  type SheetError,
  type SheetFont,
  type SheetPage,
  type SheetPrimitive,
  type TextMeasurer,
} from './sheet-model'
import { bold, regular } from './sheet-text'
import { sheetThickLine as thick } from './sheet-drawing'
import {
  CAPTION,
  colored,
  DISTRICT_RED,
  districtHeader,
  kmText,
  LEFT,
  plural,
  RIGHT,
  text,
} from './district-common'
import { districtLines, type DistrictLine, type DistrictSpan } from './district-scheme-c'

/**
 * Схема дистанции, вариант B — топологическая (#34, ADR-0054) по согласованному образцу:
 * направления — внемасштабные линии со станциями по порядку осей, цвет линии — ПЧУ; станции
 * примыкания соединяют направления, общий конец вне дистанции — отдельный узел.
 */
/** Цвета ПЧУ: различимы между собой и в печати. */
export const PCHU_COLORS = [
  '#c8102e',
  '#1f3a68',
  '#e09b2d',
  '#2e7d32',
  '#6a3d9a',
  '#00838f',
] as const
const NO_PCHU = '#9a9a9a'
const OUTSIDE = '#a0a0a0'
const TOP = 36
const LEGEND = 210
const MAX_PAGES = 50
/** Поле для подписей «на …» у концов линий. */
const MARGIN = 28
const ROW = 44
const GAP = 8
const STATION_GAP = 8
const LINE_WEIGHT = 1.4
const STATION = bold(2.4)
const PD_LABEL = bold(2.6)
const COORD = regular(2.3)
const EPS = 1e-6

/** Концы направления по названию «Узловая — Ряжск, главный путь 1». */
export function lineEnds(name: string): readonly [string, string] | undefined {
  const base = name.split(',')[0]?.trim() ?? ''
  const spaced = base.split(/\s+[—–-]\s+/u)
  const parts = spaced.length === 2 ? spaced : base.split(/[—–]/u)
  if (parts.length !== 2) return undefined
  const [a = '', b = ''] = parts.map((p) => p.trim())
  return a && b ? [a, b] : undefined
}
/** «на Вязьму», «на Духовскую», «на Волово». */
export function toward(place: string): string {
  const word = place.trim()
  const rules: readonly [RegExp, string][] = [
    [/ая$/u, 'ую'],
    [/яя$/u, 'юю'],
    [/а$/u, 'у'],
    [/я$/u, 'ю'],
  ]
  for (const [pattern, ending] of rules)
    if (pattern.test(word)) return `на ${word.replace(pattern, ending)}`
  return `на ${word}`
}

interface Point {
  readonly at: Chainage
  readonly kind: 'end' | 'boundary' | 'station'
  readonly part: number
}
/** Линия ряда: x каждой точки в собственной системе ряда, слева направо по координатам. */
interface Track {
  readonly line: DistrictLine
  readonly points: readonly { readonly point: Point; readonly x: number }[]
  readonly width: number
}

function track(line: DistrictLine, mmPerMeter: number): Track {
  const points: Point[] = []
  for (const [i, [from, to]] of line.parts.entries())
    points.push({ at: from, kind: 'end', part: i }, { at: to, kind: 'end', part: i })
  const partOf = (at: Chainage) =>
    line.parts.findIndex(([a, z]) => compareChainage(a, at) <= 0 && compareChainage(at, z) <= 0)
  for (const span of line.spans)
    for (const [a, z] of span.ranges)
      for (const at of [a, z]) {
        const part = partOf(at)
        if (part >= 0) points.push({ at, kind: 'boundary', part })
      }
  for (const c of line.columns)
    if (c.at && c.name) {
      const part = partOf(c.at)
      if (part >= 0) points.push({ at: c.at, kind: 'station', part })
    }
  points.sort((a, b) => a.part - b.part || compareChainage(a.at, b.at))
  const placed: { point: Point; x: number }[] = []
  let partStart = 0
  for (const [i, point] of points.entries()) {
    const previous = placed.at(-1)
    const start = line.parts[point.part]?.[0] ?? point.at
    if (previous && previous.point.part !== point.part) partStart = previous.x + GAP
    const raw = partStart + distance(start, point.at, line.lengths) * mmPerMeter
    const same =
      previous &&
      compareChainage(previous.point.at, point.at) === 0 &&
      previous.point.part === point.part
    const min = !previous
      ? raw
      : same
        ? previous.x
        : previous.x +
          (previous.point.kind === 'station' && point.kind === 'station' ? STATION_GAP : 3)
    placed.push({ point, x: i === 0 ? raw : Math.max(raw, min) })
    if (i === 0) partStart = 0
  }
  return { line, points: placed, width: placed.at(-1)?.x ?? 0 }
}

/** x точки ряда с учётом ориентации и сдвига. */
interface Row {
  readonly track: Track
  readonly reversed: boolean
  offset: number
  y: number
}
const xOf = (row: Row, at: Chainage, part?: number): number | undefined => {
  const found = row.track.points.find(
    (p) => compareChainage(p.point.at, at) === 0 && (part === undefined || p.point.part === part),
  )
  if (!found) return undefined
  return row.offset + (row.reversed ? row.track.width - found.x : found.x)
}
const stationAt = (line: DistrictLine, name: string) =>
  line.columns.find((c) => c.name === name && c.at)?.at

interface Link {
  readonly a: number
  readonly b: number
  readonly station?: string
  readonly external?: string
}

/** Связи направлений: общая станция или общий конец за пределами дистанции. */
function links(lines: readonly DistrictLine[]): Link[] {
  const result: Link[] = []
  const stations = new Set(lines.flatMap((l) => l.columns.map((c) => c.name)).filter(Boolean))
  for (let a = 0; a < lines.length; a++)
    for (let b = a + 1; b < lines.length; b++) {
      const la = lines[a],
        lb = lines[b]
      if (!la || !lb) continue
      const shared = la.columns.find((c) => c.name && lb.columns.some((d) => d.name === c.name))
      if (shared) {
        result.push({ a, b, station: shared.name })
        continue
      }
      const ends = lineEnds(la.line)?.filter(
        (e) => !stations.has(e) && lineEnds(lb.line)?.includes(e),
      )
      if (ends?.[0]) result.push({ a, b, external: ends[0] })
    }
  return result
}

function bounds(rows: readonly Row[]): [number, number] {
  const xs = rows.flatMap((r) => [r.offset, r.offset + r.track.width])
  return [Math.min(...xs), Math.max(...xs)]
}

/** Порядок и ориентация рядов: обход связей от самого связанного направления. */
function arrange(lines: readonly DistrictLine[], tracks: readonly Track[]): Row[] {
  const all = links(lines)
  const degree = (i: number) => all.filter((l) => l.a === i || l.b === i).length
  const placed = new Map<number, Row>()
  const order: number[] = []
  const remaining = lines.map((_, i) => i)
  while (remaining.length) {
    const root = remaining.toSorted((a, b) => degree(b) - degree(a) || a - b)[0] ?? 0
    const queue = [root]
    const rootTrack = tracks[root]
    if (!rootTrack) break
    placed.set(root, { track: rootTrack, reversed: false, offset: 0, y: 0 })
    const component: Row[] = [placed.get(root) as Row]
    while (queue.length) {
      const current = queue.shift() ?? root
      order.push(current)
      remaining.splice(remaining.indexOf(current), 1)
      const from = placed.get(current)
      if (!from) continue
      for (const link of all) {
        if (link.a !== current && link.b !== current) continue
        const other = link.a === current ? link.b : link.a
        const otherTrack = tracks[other]
        if (placed.has(other) || !otherTrack) continue
        const candidates = [false, true].map((reversed) => {
          const row: Row = { track: otherTrack, reversed, offset: 0, y: 0 }
          if (link.station) {
            const at = stationAt(from.track.line, link.station),
              there = stationAt(otherTrack.line, link.station)
            const x1 = at && xOf(from, at),
              x2 = there && xOf(row, there)
            row.offset = (x1 ?? 0) - (x2 ?? 0)
          } else {
            // Общий конец: концы с одним названием — на одной стороне и на одной вертикали.
            const side = (r: Row, line: DistrictLine) => {
              const end = lineEnds(line.line)?.indexOf(link.external ?? '') ?? -1
              const right = (end === 1) !== r.reversed
              return { right, x: right ? r.offset + r.track.width : r.offset }
            }
            const mine = side(from, from.track.line),
              theirs = side(row, otherTrack.line)
            row.offset = mine.x - (theirs.right ? row.track.width : 0)
            if (mine.right !== theirs.right) row.offset = Number.NaN
          }
          const [min, max] = bounds([...component, row])
          return { row, width: Number.isNaN(row.offset) ? Infinity : max - min }
        })
        const best = candidates.toSorted((a, b) => a.width - b.width)[0]
        if (!best || !Number.isFinite(best.width)) continue
        placed.set(other, best.row)
        component.push(best.row)
        queue.push(other)
      }
    }
    for (const r of component) if (!placed.has(lines.indexOf(r.track.line))) continue
    // Компонент прижимается к левому полю.
    const [min] = bounds(component)
    for (const r of component) r.offset -= min
  }
  return order.flatMap((i) => {
    const row = placed.get(i)
    return row ? [row] : []
  })
}

const colorOf = (pchu: string | undefined, order: readonly string[]) =>
  pchu === undefined
    ? NO_PCHU
    : (PCHU_COLORS[Math.max(0, order.indexOf(pchu)) % PCHU_COLORS.length] ?? NO_PCHU)

function drawRow(
  row: Row,
  scale: number,
  source: OverviewSource,
  pchuOrder: readonly string[],
  junctions: ReadonlySet<string>,
  attached: ReadonlySet<'left' | 'right'>,
  page: { readonly anchorOf: ReadonlyMap<string, Row>; readonly drawn: Set<string> },
  measurer: TextMeasurer,
): SheetPrimitive[] {
  const { line } = row.track
  const back: SheetPrimitive[] = [],
    front: SheetPrimitive[] = []
  const y = row.y
  const X = (x: number) => LEFT + MARGIN + x * scale
  const at = (c: Chainage, part?: number) => {
    const x = xOf(row, c, part)
    return x === undefined ? undefined : X(x)
  }
  // Заголовок направления.
  const name = line.line
  const meters = line.parts.reduce((n, [a, z]) => n + distance(a, z, line.lengths), 0)
  const left = X(row.offset)
  front.push(text(name, left, y - 25, bold(2.8)))
  front.push(
    text(
      ` · ${kmText(meters)} км`,
      left + measurer.width(name, bold(2.8)).value,
      y - 25,
      regular(2.8),
    ),
  )
  // Участки линии между соседними точками: цвет ПЧУ участка ПД, вне ПД — серый.
  const spanAt = (a: Chainage, z: Chainage): DistrictSpan | undefined =>
    line.spans.find((s) =>
      s.ranges.some(([from, to]) => compareChainage(from, a) <= 0 && compareChainage(z, to) <= 0),
    )
  const points = row.track.points
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1],
      q = points[i]
    if (!p || !q || p.point.part !== q.point.part) continue
    const x1 = at(p.point.at, p.point.part),
      x2 = at(q.point.at, q.point.part)
    if (x1 === undefined || x2 === undefined || Math.abs(x2 - x1) < EPS) continue
    const span = spanAt(p.point.at, q.point.at)
    back.push(
      colored(thick(x1, y, x2, y, LINE_WEIGHT), span ? colorOf(span.pchu, pchuOrder) : NO_PCHU),
    )
  }
  // Разрывы протяжения: серые точки между частями.
  for (let i = 1; i < line.parts.length; i++) {
    const end = line.parts[i - 1]?.[1],
      start = line.parts[i]?.[0]
    const x1 = end && at(end, i - 1),
      x2 = start && at(start, i)
    if (x1 === undefined || x2 === undefined || !x1 || !x2) continue
    back.push(colored(thick(x1 + 1.5, y, x2 - 1.5, y, 0.9, { dashed: true }), OUTSIDE))
  }
  // Концы: точки «вне дистанции» и направление.
  const ends = lineEnds(name)
  const first = line.parts[0]?.[0],
    last = line.parts.at(-1)?.[1]
  const xa = first && at(first, 0),
    xb = last && at(last, line.parts.length - 1)
  if (xa !== undefined && xb !== undefined && xa && xb) {
    const [leftX, rightX] = [Math.min(xa, xb), Math.max(xa, xb)]
    const [leftName, rightName] = row.reversed ? [ends?.[1], ends?.[0]] : [ends?.[0], ends?.[1]]
    // Конец, ведущий к узлу вне дистанции, продолжает пунктир узла без подписи.
    if (!attached.has('left')) {
      back.push(colored(thick(leftX - 8, y, leftX - 1.5, y, 0.9, { dashed: true }), OUTSIDE))
      if (leftName) {
        const label = toward(leftName)
        const lx = leftX - 9.5 - measurer.width(label, regular(2.6)).value
        front.push(text(label, lx, y + 0.9, regular(2.6), { color: CAPTION }))
      }
    }
    if (!attached.has('right')) {
      back.push(colored(thick(rightX + 1.5, y, rightX + 8, y, 0.9, { dashed: true }), OUTSIDE))
      if (rightName)
        front.push(text(toward(rightName), rightX + 9.5, y + 0.9, regular(2.6), { color: CAPTION }))
    }
  }
  // Границы ПД и концы частей: чёрная засечка, координата снизу.
  const marks = new Map<string, { x: number; at: Chainage }>()
  for (const p of points) {
    if (p.point.kind === 'station') continue
    const x = at(p.point.at, p.point.part)
    if (x !== undefined)
      marks.set(`${p.point.part}:${formatPlus(p.point.at)}`, { x, at: p.point.at })
  }
  const used: { from: number; to: number }[] = []
  for (const mark of [...marks.values()].toSorted((a, b) => a.x - b.x)) {
    front.push(thick(mark.x, y - 2.6, mark.x, y + 2.6, 0.6))
    const value = formatPlus(mark.at)
    const w = measurer.width(value, COORD).value
    const x = Math.max(mark.x - w / 2, (used.at(-1)?.to ?? -Infinity) + 1.5)
    used.push({ from: x, to: x + w })
    front.push(text(value, x, y + 11, COORD, { color: CAPTION }))
  }
  // Подписи ПД под линией.
  const heads = source.heads ?? {}
  for (const span of line.spans)
    for (const [a, z] of span.ranges) {
      const x1 = at(a),
        x2 = at(z)
      if (x1 === undefined || x2 === undefined) continue
      const width = Math.abs(x2 - x1)
      const label = [
        heads[span.code] ? `${span.code} · ${heads[span.code]}` : span.code,
        span.code,
      ].find((v) => measurer.width(v, PD_LABEL).value <= width - 2)
      if (label) front.push(text(label, (x1 + x2) / 2, y + 6, PD_LABEL, { anchor: 'middle' }))
    }
  // Станции: кружок на оси, название наискось над ним.
  for (const c of line.columns) {
    if (!c.at || !c.name) continue
    // Станция рисуется один раз на листе — в ряду, к которому сходятся линии примыкания.
    if (page.drawn.has(c.name) || page.anchorOf.get(c.name) !== row) continue
    const x = at(c.at)
    if (x === undefined) continue
    page.drawn.add(c.name)
    const junction = junctions.has(c.name)
    front.push({
      kind: 'circle',
      x: mm(x),
      y: mm(y),
      radius: mm(junction ? 2.3 : 1.4),
      fill: '#ffffff',
      stroke: junction ? '#111111' : colorOf(c.span?.pchu, pchuOrder),
      weight: mm(junction ? 0.9 : 0.6),
    })
    front.push(text(c.name, x + 0.6, y - (junction ? 3.2 : 2.4), STATION, { rotate: -45 }))
  }
  return [...back, ...front]
}

interface PdTotals {
  meters: number
  stations: number
  stationMeters: number
  switches: number
}

function pdTotals(lines: readonly DistrictLine[], source: OverviewSource) {
  const result = new Map<string, PdTotals & { pchu: string | undefined }>()
  for (const line of lines) {
    for (const span of line.spans) {
      const t = result.get(span.code) ?? {
        meters: 0,
        stations: 0,
        stationMeters: 0,
        switches: 0,
        pchu: span.pchu,
      }
      t.meters += span.meters
      result.set(span.code, t)
    }
    for (const c of line.columns) {
      if (!c.span || !c.name || c.repeated) continue
      const t = result.get(c.span.code)
      const own = source.stationStats?.[c.name]
      if (!t) continue
      t.stations++
      t.stationMeters += own?.meters ?? 0
      t.switches += own?.switches ?? 0
    }
  }
  return result
}

/** Нижняя граница итогов над подвалом, мм. */
const LEGEND_BOTTOM = 276
const LEGEND_LINE = 4
const LEGEND_TITLE = 11

/**
 * Итоги по ПЧУ: группы по три в ряд. Ряд, не поместившийся по высоте, уходит на новый лист;
 * группа длиннее листа делится на части «(продолжение)».
 */
function legend(
  lines: readonly DistrictLine[],
  source: OverviewSource,
  pchuOrder: readonly string[],
  measurer: TextMeasurer,
): SheetPrimitive[][] {
  const totals = pdTotals(lines, source)
  const heads = source.heads ?? {}
  const groups = [...pchuOrder, ...([...totals.values()].some((t) => !t.pchu) ? [undefined] : [])]
  const width = (RIGHT - LEFT - 2 * 8) / 3
  const capacity = Math.floor((LEGEND_BOTTOM - TOP - 4 - LEGEND_TITLE) / LEGEND_LINE)
  interface Chunk {
    readonly pchu: string | undefined
    readonly title: string
    readonly lines: readonly string[]
  }
  const chunks: Chunk[] = []
  for (const pchu of groups) {
    const pds = [...totals.entries()]
      .filter(([, t]) => t.pchu === pchu)
      .toSorted(([a], [b]) => a.localeCompare(b, 'ru', { numeric: true }))
    const meters = pds.reduce((n, [, t]) => n + t.meters, 0)
    const title = pchu
      ? `${pchu}${heads[pchu] ? ` · ${heads[pchu]}` : ''} — ${kmText(meters)} км`
      : `Без ПЧУ — ${kmText(meters)} км`
    const rows = pds.map(
      ([code, t]) =>
        `${code}${heads[code] ? ` · ${heads[code]}` : ''} — гл. путь ${kmText(t.meters)} км · ${t.stations} ст. · ст. пути ${kmText(t.stationMeters)} км · ${t.switches} стр.`,
    )
    for (let i = 0; i === 0 || i < rows.length; i += capacity)
      chunks.push({
        pchu,
        title: i === 0 ? title : `${pchu ?? 'Без ПЧУ'} (продолжение)`,
        lines: rows.slice(i, i + capacity),
      })
  }
  const pages: SheetPrimitive[][] = [[]]
  let y = LEGEND
  for (let i = 0; i < chunks.length; i += 3) {
    const row = chunks.slice(i, i + 3)
    const height = LEGEND_TITLE + Math.max(...row.map((c) => c.lines.length)) * LEGEND_LINE
    if (y + height > LEGEND_BOTTOM) {
      pages.push([])
      y = TOP + 4
    }
    for (const [k, chunk] of row.entries()) {
      const x = LEFT + k * (width + 8)
      const shapes = pages.at(-1)
      shapes?.push(
        colored(thick(x, y, x + width, y, 1.2), colorOf(chunk.pchu, pchuOrder)),
        text(fit(chunk.title, width, bold(2.8), measurer), x, y + 6, bold(2.8)),
        ...chunk.lines.map((line, n) =>
          text(
            fit(line, width, regular(2.5), measurer),
            x,
            y + LEGEND_TITLE + n * LEGEND_LINE,
            regular(2.5),
          ),
        ),
      )
    }
    y += height + 4
  }
  return pages
}

function fit(value: string, width: number, font: SheetFont, measurer: TextMeasurer): string {
  if (measurer.width(value, font).value <= width) return value
  let cut = value
  while (cut.length > 1 && measurer.width(`${cut}…`, font).value > width) cut = cut.slice(0, -1)
  return `${cut}…`
}

export function buildDistrictSchemeB(
  source: OverviewSource,
  measurer: TextMeasurer,
): Result<OverviewDocument, SheetError> {
  const prepared = districtLines(source)
  if (!prepared.ok) return prepared
  const lines = prepared.value
  const warnings = [...source.warnings]
  if (source.boundaries.some((b) => b.pchu === undefined))
    warnings.push('У части ПД не найдено ПЧУ в оргструктуре: их участки показаны серым.')
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
  const outside = lines.flatMap((l) => l.columns.filter((c) => c.name && !c.span))
  if (outside.length)
    warnings.push(
      `Станции вне участков ПД (в итоги не входят): ${[...new Set(outside.map((c) => c.name))].join(', ')}.`,
    )
  const pchuOrder = [
    ...new Set(source.boundaries.flatMap((b) => (b.pchu ? [b.pchu] : []))),
  ].toSorted((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
  // Внемасштабная схема: общий коэффициент по самому длинному направлению, затем раздвижка.
  const available = RIGHT - LEFT - 2 * MARGIN
  const longest = Math.max(
    1,
    ...lines.map((l) => l.parts.reduce((n, [a, z]) => n + distance(a, z, l.lengths), 0)),
  )
  const tracks = lines.map((l) => track(l, (available * 0.8) / longest))
  const rows = arrange(lines, tracks)
  const lineCount = new Map<string, Set<string>>()
  for (const l of lines)
    for (const c of l.columns)
      if (c.name) lineCount.set(c.name, (lineCount.get(c.name) ?? new Set()).add(l.id))
  const junctions = new Set([...lineCount].filter(([, ids]) => ids.size > 1).map(([name]) => name))
  // Ряды по листам; связи между листами не рисуются, концы подписаны направлениями.
  const pages: SheetPrimitive[][] = [[]]
  const pageRows: Row[][] = [[]]
  let y = TOP + 32
  for (const row of rows) {
    if (y > LEGEND - 14) {
      if (pages.length >= MAX_PAGES) return err({ message: 'Документ превышает 50 листов.' })
      pages.push([])
      pageRows.push([])
      y = TOP + 32
    }
    row.y = y
    pageRows.at(-1)?.push(row)
    y += ROW
  }
  for (const [p, onPage] of pageRows.entries()) {
    if (!onPage.length) continue
    const [, max] = bounds(onPage)
    const scale = max > available ? available / max : 1
    const X = (x: number) => LEFT + MARGIN + x * scale
    const body = pages[p] ?? []
    // Общий конец вне дистанции: концы с одним названием на одной стороне — узел и пунктир.
    const nodes = new Map<string, Row[]>()
    for (const link of links(onPage.map((r) => r.track.line)))
      if (link.external) {
        const members = nodes.get(link.external) ?? []
        for (const i of [link.a, link.b]) {
          const r = onPage[i]
          if (r && !members.includes(r)) members.push(r)
        }
        nodes.set(link.external, members)
      }
    const attached = new Map<Row, Set<'left' | 'right'>>()
    const connectors: SheetPrimitive[] = [],
      nodeMarks: SheetPrimitive[] = []
    for (const [place, members] of nodes) {
      const ends = members.map((r) => {
        const index = lineEnds(r.track.line.line)?.indexOf(place) ?? -1
        const right = (index === 1) !== r.reversed
        return { row: r, right, x: X(right ? r.offset + r.track.width : r.offset), y: r.y }
      })
      if (!ends.every((e) => e.right === ends[0]?.right)) continue
      const right = ends[0]?.right ?? true
      const nodeX = right
        ? Math.max(...ends.map((e) => e.x)) + 20
        : Math.min(...ends.map((e) => e.x)) - 20
      const nodeY = (Math.min(...ends.map((e) => e.y)) + Math.max(...ends.map((e) => e.y))) / 2
      for (const e of ends) {
        const sides = attached.get(e.row) ?? new Set<'left' | 'right'>()
        sides.add(right ? 'right' : 'left')
        attached.set(e.row, sides)
        connectors.push(
          colored(thick(e.x, e.y, nodeX, e.y, 0.9, { dashed: true }), OUTSIDE),
          colored(thick(nodeX, e.y, nodeX, nodeY, 0.9, { dashed: true }), OUTSIDE),
        )
      }
      const label = place.toLocaleUpperCase('ru')
      const note = 'вне границ дистанции'
      const lw = Math.max(
        measurer.width(label, bold(2.8)).value,
        measurer.width(note, regular(2.4)).value,
      )
      const nx = right ? nodeX - 5 - lw : nodeX + 5
      nodeMarks.push(
        {
          kind: 'circle',
          x: mm(nodeX),
          y: mm(nodeY),
          radius: mm(3.2),
          fill: '#ffffff',
          stroke: '#777777',
          weight: mm(0.8),
        },
        text(label, nx, nodeY - 0.5, bold(2.8), { color: '#555555' }),
        text(note, nx, nodeY + 3.5, regular(2.4), { color: CAPTION }),
      )
    }
    // Станции примыкания: вертикаль от листа, где станция нарисована, к линии другого направления.
    const counted = new Set(
      onPage.flatMap((r) =>
        r.track.line.columns.filter((c) => c.name && !c.repeated && c.span).map((c) => c.name),
      ),
    )
    const anchorOf = new Map<string, Row>()
    for (const row of onPage)
      for (const c of row.track.line.columns)
        if (
          c.name &&
          c.at &&
          !anchorOf.has(c.name) &&
          (counted.has(c.name) ? !c.repeated && c.span : true)
        )
          anchorOf.set(c.name, row)
    for (const row of onPage)
      for (const c of row.track.line.columns) {
        const anchor = c.name ? anchorOf.get(c.name) : undefined
        if (!c.at || !anchor || anchor === row) continue
        const there = stationAt(anchor.track.line, c.name)
        const x1 = there && xOf(anchor, there),
          x2 = xOf(row, c.at)
        if (x1 === undefined || x2 === undefined) continue
        const color = colorOf(c.span?.pchu, pchuOrder)
        connectors.push(
          colored(thick(X(x1), anchor.y, X(x1), row.y, LINE_WEIGHT), color),
          colored(thick(X(x1), row.y, X(x2), row.y, LINE_WEIGHT), color),
        )
      }
    body.push(...connectors)
    const page = { anchorOf, drawn: new Set<string>() }
    for (const row of onPage)
      body.push(
        ...drawRow(
          row,
          scale,
          source,
          pchuOrder,
          junctions,
          attached.get(row) ?? new Set(),
          page,
          measurer,
        ),
      )
    body.push(...nodeMarks)
  }
  if (!lines.length)
    pages[0]?.push(
      text('Нет направлений. Загрузите оргструктуру паспорта.', LEFT, TOP + 10, regular()),
    )
  // Итоги по ПЧУ и подвал — на последнем листе.
  const totals = pdTotals(lines, source)
  const sum = [...totals.values()].reduce(
    (n, t) => ({
      meters: n.meters + t.meters,
      stationMeters: n.stationMeters + t.stationMeters,
      switches: n.switches + t.switches,
      stations: n.stations + t.stations,
    }),
    { meters: 0, stationMeters: 0, switches: 0, stations: 0 },
  )
  const [first = [], ...more] = legend(lines, source, pchuOrder, measurer)
  pages.at(-1)?.push(...first)
  pages.push(...more)
  if (pages.length > MAX_PAGES) return err({ message: 'Документ превышает 50 листов.' })
  const unbound = source.unboundStations ?? []
  const footer = (number: number): SheetPrimitive[] => {
    const totalsText = `Всего: главный путь ${kmText(sum.meters)} км · станционные пути ${kmText(sum.stationMeters)} км · ${plural(sum.switches, 'стрелочный перевод', 'стрелочных перевода', 'стрелочных переводов')} · ${plural(sum.stations, 'станция', 'станции', 'станций')}`
    const warning = `Замечаний: ${warnings.length}; список — в предпросмотре.`
    return [
      thick(LEFT, 280, LEFT, 284, 0.6),
      text('граница ПД', LEFT + 2, 283.3, regular(2.5)),
      colored(thick(LEFT + 22, 282, LEFT + 30, 282, 0.9, { dashed: true }), OUTSIDE),
      text('вне дистанции', LEFT + 32, 283.3, regular(2.5)),
      {
        kind: 'circle',
        x: mm(LEFT + 56),
        y: mm(282.2),
        radius: mm(1.6),
        fill: '#ffffff',
        stroke: '#111111',
        weight: mm(0.7),
      },
      text('станция примыкания', LEFT + 59, 283.3, regular(2.5)),
      text(totalsText, RIGHT - measurer.width(totalsText, bold(2.5)).value, 283.3, bold(2.5)),
      text(
        `Схема внемасштабная, станции расставлены по порядку осей.${unbound.length ? ` Не входят в привязку к ПД: ${unbound.join(', ')}.` : ''}`,
        LEFT,
        288.5,
        regular(2.4),
      ),
      text(
        `Редакция от ${source.edition.date.split('-').toReversed().join('.')} · Лист ${number}`,
        LEFT,
        293.5,
        regular(2.2),
        { color: CAPTION },
      ),
      ...(warnings.length
        ? [
            text(
              warning,
              RIGHT - measurer.width(warning, regular(2.2)).value,
              293.5,
              regular(2.2),
              { color: DISTRICT_RED },
            ),
          ]
        : []),
    ]
  }
  const result: SheetPage[] = pages.map((body, i) => ({
    width: mm(420),
    height: mm(297),
    number: i + 1,
    primitives: [
      ...districtHeader(
        source,
        'Топологическая схема направлений · цвет линии — эксплуатационный участок (ПЧУ)',
        measurer,
      ),
      ...body,
      ...footer(i + 1),
    ],
  }))
  return ok({ pages: result, warnings })
}
