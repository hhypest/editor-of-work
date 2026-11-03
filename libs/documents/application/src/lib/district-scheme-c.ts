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
  type OverviewSource,
  type SheetError,
  type SheetFont,
  type SheetPage,
  type SheetPrimitive,
  type TextMeasurer,
} from './sheet-model'
import { bold, narrow, regular, wrapText } from './sheet-text'
import { moveShapes, sheetThickLine as thick } from './sheet-drawing'
import {
  CAPTION,
  colored,
  DISTRICT_RED,
  districtHeader,
  kmText,
  LEFT,
  PCHU_FILLS,
  RIGHT,
  text,
  WHITE,
} from './district-common'

/**
 * Схема дистанции, вариант C — схема-таблица (#35, ADR-0053) по согласованному образцу:
 * столбцы — станции направлений в порядке осей; под ними пути и стрелки станций, участки ПД с
 * руководителями, длины и границы, участки ПЧУ; ниже — итоги по ПЧУ и примечания.
 */
const LABEL_WIDTH = 47
const TABLE_WIDTH = RIGHT - LEFT - LABEL_WIDTH - 10
const MIN_COLUMN = 9,
  MAX_COLUMN = 16
const TOP = 36,
  BOTTOM = 276
const MAX_PAGES = 50
const PD_FILL = '#e6e6e6'
const LABEL_FILL = '#f2f2f2'
const NAME = bold(2.6)
const AXIS = narrow(2.4)
const CELL = regular(2.6)
const CELL_BOLD = bold(2.6)
const LABEL = bold(2.4)
const EPS = 1e-9
const BOUNDS = narrow(2.2)
const BOUNDS_STEP = 2.75

export interface DistrictSpan {
  readonly code: string
  readonly pchu: string | undefined
  readonly ranges: readonly (readonly [Chainage, Chainage])[]
  readonly meters: number
}
export interface DistrictColumn {
  readonly line: string
  /** Пустое название — участок ПД без станций на этом направлении. */
  readonly name: string
  readonly at: Chainage | undefined
  readonly span: Span | undefined
  /** Станция примыкания уже учтена на другом направлении. */
  readonly repeated: boolean
}
/** Направление для схем B и C: станции по осям, участки ПД, части протяжения. */
export interface DistrictLine {
  readonly id: string
  readonly line: string
  readonly lengths: KmLengths
  /** Части протяжения по возрастанию координат. */
  readonly parts: readonly (readonly [Chainage, Chainage])[]
  readonly columns: readonly DistrictColumn[]
  readonly spans: readonly DistrictSpan[]
  readonly gaps: readonly string[]
}
type Span = DistrictSpan
type Column = DistrictColumn
type Prepared = DistrictLine

/**
 * Направления среза для схем B и C: станции по осям (примыкание помечено повтором), участки ПД
 * по порядку координат (части одного ПД подряд — один участок), разрывы протяжения.
 */
export function districtLines(source: OverviewSource): Result<readonly DistrictLine[], SheetError> {
  if (source.lines.length > 1000 || source.axes.length > 50000 || source.boundaries.length > 50000)
    return err({ message: 'Слишком много объектов для одного документа.' })
  const unbound = new Set(source.unboundStations ?? [])
  const seen = new Set<string>()
  const result: Prepared[] = []
  for (const line of source.lines) {
    const lengths = KmLengths.of(line.kmLengths)
    if (!lengths.ok) return err({ message: describeChainageError(lengths.error) })
    const valid = (at: Chainage, what: string): Result<Chainage, SheetError> => {
      const c = chainage(at.km, at.m, lengths.value)
      return c.ok ? c : err({ message: `${what}: ${describeChainageError(c.error)}` })
    }
    const extents = line.extents.toSorted((a, b) => compareChainage(a.from, b.from))
    const gaps = extents
      .slice(1)
      .map(
        (e, i) =>
          `${line.name}: км ${formatPlus(extents[i]?.to ?? e.from)} — ${formatPlus(e.from)} в границы дистанции не входит.`,
      )
    // Участки ПД по порядку координат; части одного ПД подряд — один участок.
    const boundaries = source.boundaries
      .filter((b) => b.lineId === line.id)
      .toSorted((a, b) => compareChainage(a.from, b.from))
    const spans: { code: string; pchu: string | undefined; ranges: [Chainage, Chainage][] }[] = []
    for (const b of boundaries) {
      const from = valid(b.from, b.code),
        to = valid(b.to, b.code)
      if (!from.ok) return from
      if (!to.ok) return to
      if (compareChainage(from.value, to.value) >= 0)
        return err({ message: `${b.code}: недопустимая граница ПД.` })
      const last = spans.at(-1)
      const previous = last?.ranges.at(-1)?.[1]
      if (previous && compareChainage(from.value, previous) < 0)
        return err({ message: `${line.name}: границы ПД перекрываются; проверьте оргструктуру.` })
      if (last && last.code === b.code) last.ranges.push([from.value, to.value])
      else spans.push({ code: b.code, pchu: b.pchu, ranges: [[from.value, to.value]] })
    }
    const done = spans.map((s) => ({
      ...s,
      meters: s.ranges.reduce((n, [a, z]) => n + distance(a, z, lengths.value), 0),
    }))
    const inside = (span: Span, at: Chainage, last: boolean) =>
      span.ranges.some(
        ([a, z]) =>
          compareChainage(a, at) <= 0 &&
          (compareChainage(at, z) < 0 || (last && compareChainage(at, z) === 0)),
      )
    const axes: { name: string; at: Chainage }[] = []
    for (const axis of source.axes) {
      if (axis.lineId !== line.id || unbound.has(axis.name)) continue
      const at = valid(axis.at, axis.name)
      if (!at.ok) return at
      axes.push({ name: axis.name, at: at.value })
    }
    axes.sort((a, b) => compareChainage(a.at, b.at) || a.name.localeCompare(b.name, 'ru'))
    const spanOf = (at: Chainage) =>
      done.find((s, i) => inside(s, at, i === done.length - 1)) ??
      done.find((s) => inside(s, at, true))
    const columns: Column[] = []
    const column = (name: string, at: Chainage | undefined, span: Span | undefined): Column => {
      // Учтённой считается только станция в участке ПД: вхождение вне ПД не прячет следующее.
      const repeated = name !== '' && span !== undefined && seen.has(name)
      if (name && span) seen.add(name)
      return { line: line.name, name, at, span, repeated }
    }
    let next = 0
    for (const span of done) {
      const start = span.ranges[0]?.[0]
      while (next < axes.length && start && compareChainage(axes[next]?.at ?? start, start) < 0) {
        const axis = axes[next++]
        if (axis) columns.push(column(axis.name, axis.at, spanOf(axis.at)))
      }
      const own: Column[] = []
      while (next < axes.length && spanOf(axes[next]?.at ?? { km: 0, m: 0 }) === span) {
        const axis = axes[next++]
        if (axis) own.push(column(axis.name, axis.at, span))
      }
      columns.push(...(own.length ? own : [column('', undefined, span)]))
    }
    for (const axis of axes.slice(next)) columns.push(column(axis.name, axis.at, spanOf(axis.at)))
    const parts: [Chainage, Chainage][] = []
    for (const e of extents) {
      const from = valid(e.from, line.name),
        to = valid(e.to, line.name)
      if (!from.ok) return from
      if (!to.ok) return to
      parts.push([from.value, to.value])
    }
    if (columns.length)
      result.push({
        id: line.id,
        line: line.name,
        lengths: lengths.value,
        parts,
        columns,
        spans: done,
        gaps,
      })
  }
  return ok(result)
}

/** Ячейка таблицы с рамкой и, если задана, заливкой. */
const cell = (x: number, y: number, width: number, height: number, fill?: string) =>
  ({
    kind: 'rect',
    x: mm(x),
    y: mm(y),
    width: mm(width),
    height: mm(height),
    shade: false,
    border: true,
    ...(fill ? { fill } : {}),
  }) as const satisfies SheetPrimitive
const centered = (
  value: string,
  x: number,
  y: number,
  height: number,
  font: SheetFont,
  color?: string,
): SheetPrimitive =>
  text(value, x, y + height / 2 + font.size.value * 0.35, font, {
    anchor: 'middle',
    ...(color ? { color } : {}),
  })

interface Row {
  readonly label: string
  readonly height: number
}

/** Подпись участка по ширине: код и руководитель, только код или ничего. */
function caption(
  code: string,
  head: string | undefined,
  width: number,
  measurer: TextMeasurer,
): readonly string[] {
  const fits = (value: string, font: SheetFont) => measurer.width(value, font).value <= width - 1.5
  if (!fits(code, CELL_BOLD)) return []
  return head && fits(head, CELL) ? [code, head] : [code]
}

function table(
  columns: readonly Column[],
  y0: number,
  source: OverviewSource,
  pchuOrder: readonly string[],
  measurer: TextMeasurer,
): { readonly shapes: SheetPrimitive[]; readonly height: number } {
  const width = Math.min(MAX_COLUMN, TABLE_WIDTH / columns.length)
  // Границы ПД переносятся по ширине участка; строка растёт под самый длинный перечень.
  const boundsText = (span: Span) =>
    span.ranges.map(([a, z]) => `${formatPlus(a)} — ${formatPlus(z)}`).join('; ')
  const boundsLines = new Map<Span, readonly string[]>()
  for (let i = 0; i < columns.length;) {
    const span = columns[i]?.span
    let j = i
    while (j + 1 < columns.length && columns[j + 1]?.span === span) j++
    if (span) {
      const wrapped = wrapText(boundsText(span), (j - i + 1) * width - 1.5, BOUNDS, measurer)
      boundsLines.set(span, wrapped.ok ? wrapped.value : [boundsText(span)])
    }
    i = j + 1
  }
  const boundsHeight = Math.max(
    11,
    ...[...boundsLines.values()].map((l) => l.length * BOUNDS_STEP + 3),
  )
  const x0 = LEFT + LABEL_WIDTH
  const xOf = (i: number) => x0 + i * width
  const longest = (values: readonly string[], font: SheetFont) =>
    Math.max(0, ...values.map((v) => measurer.width(v, font).value))
  const rows: Row[] = [
    { label: 'Направление', height: 8 },
    {
      label: 'Станция',
      height: Math.min(
        60,
        Math.max(
          20,
          longest(
            columns.map((c) => c.name),
            NAME,
          ) + 6,
        ),
      ),
    },
    {
      label: 'Ось станции, км+м',
      height: Math.max(
        14,
        longest(
          columns.map((c) => (c.at ? formatPlus(c.at) : '')),
          AXIS,
        ) + 5,
      ),
    },
    { label: 'Главный путь', height: 8 },
    { label: 'Станц. путей, шт.', height: 7 },
    { label: 'Станц. пути, км', height: 7 },
    { label: 'Стрелочные переводы, шт.', height: 7 },
    { label: 'Линейный участок, руководитель', height: 13 },
    { label: 'Главный путь ПД, км', height: 8 },
    { label: 'Границы ПД, км+м', height: boundsHeight },
    { label: 'Эксплуатационный участок', height: 11 },
  ]
  const tops: number[] = []
  let y = y0
  for (const row of rows) {
    tops.push(y)
    y += row.height
  }
  const top = (i: number) => tops[i] ?? y0
  const height = (i: number) => rows[i]?.height ?? 0
  const back: SheetPrimitive[] = [],
    front: SheetPrimitive[] = []
  for (const [i, row] of rows.entries()) {
    back.push(cell(LEFT, top(i), LABEL_WIDTH, row.height, LABEL_FILL))
    const lines = wrapText(row.label, LABEL_WIDTH - 4, LABEL, measurer)
    const words = lines.ok ? lines.value : [row.label]
    const first = top(i) + row.height / 2 - ((words.length - 1) * 3.2) / 2 + 0.85
    for (const [k, w] of words.entries()) front.push(text(w, LEFT + 2, first + k * 3.2, LABEL))
  }
  /** Подряд идущие столбцы с одинаковым ключом — одна объединённая ячейка. */
  const groups = <T>(key: (c: Column) => T) => {
    const result: { from: number; to: number; value: T }[] = []
    for (const [i, c] of columns.entries()) {
      const last = result.at(-1)
      const value = key(c)
      if (last && last.value === value && last.to === i - 1) last.to = i
      else result.push({ from: i, to: i, value })
    }
    return result
  }
  // Направления.
  for (const g of groups((c) => c.line)) {
    const x = xOf(g.from),
      w = (g.to - g.from + 1) * width
    back.push(cell(x, top(0), w, height(0)))
    const value = measurer.width(g.value, CELL_BOLD).value <= w - 1 ? g.value : ''
    if (value) front.push(centered(value, x + w / 2, top(0), height(0), CELL_BOLD))
    // Главный путь направления — сплошная линия через его столбцы.
    const middle = top(3) + height(3) / 2
    front.push(thick(x, middle, x + w, middle, 0.7))
  }
  const stats = source.stationStats ?? {}
  for (const [i, c] of columns.entries()) {
    const x = xOf(i),
      center = x + width / 2
    for (const r of [1, 2, 3, 4, 5, 6]) back.push(cell(x, top(r), width, height(r)))
    if (c.name) {
      const w = measurer.width(c.name, NAME).value
      front.push(
        text(c.name, center + NAME.size.value * 0.35, top(1) + height(1) / 2 + w / 2, NAME, {
          rotate: -90,
        }),
      )
    }
    if (c.at) {
      const value = formatPlus(c.at)
      const w = measurer.width(value, AXIS).value
      front.push(
        text(value, center + AXIS.size.value * 0.35, top(2) + height(2) / 2 + w / 2, AXIS, {
          rotate: -90,
        }),
      )
    }
    if (c.name)
      front.push({
        kind: 'rect',
        x: mm(center - 1.8),
        y: mm(top(3) + height(3) / 2 - 1.3),
        width: mm(3.6),
        height: mm(2.6),
        shade: false,
        border: true,
        fill: WHITE,
      })
    const own = stats[c.name]
    const values = !c.name
      ? ['', '', '']
      : c.repeated
        ? ['*', '*', '*']
        : own
          ? [String(own.tracks), kmText(own.meters), String(own.switches)]
          : ['—', '—', '—']
    for (const [k, value] of values.entries())
      if (value)
        front.push(centered(value, center, top(4 + k), height(4 + k), k === 2 ? CELL_BOLD : CELL))
  }
  const heads = source.heads ?? {}
  // Участки ПД: подпись, длина, границы.
  for (const g of groups((c) => c.span)) {
    const x = xOf(g.from),
      w = (g.to - g.from + 1) * width
    const span = g.value
    back.push(
      cell(x, top(7), w, height(7), span ? PD_FILL : undefined),
      cell(x, top(8), w, height(8)),
      cell(x, top(9), w, height(9)),
    )
    if (!span) {
      front.push(centered('—', x + w / 2, top(7), height(7), CELL))
      continue
    }
    const words = caption(span.code, heads[span.code], w, measurer)
    if (words[0]) front.push(centered(words[0], x + w / 2, top(7) - 2.2, height(7), CELL_BOLD))
    if (words[1]) front.push(centered(words[1], x + w / 2, top(7) + 2.2, height(7), CELL))
    front.push(centered(kmText(span.meters), x + w / 2, top(8), height(8), CELL_BOLD))
    const lines = boundsLines.get(span) ?? []
    const first = top(9) + height(9) / 2 - ((lines.length - 1) * BOUNDS_STEP) / 2
    for (const [k, line] of lines.entries())
      front.push(
        centered(
          line,
          x + w / 2,
          first + k * BOUNDS_STEP - height(9) / 2,
          height(9),
          BOUNDS,
          DISTRICT_RED,
        ),
      )
  }
  // Участки ПЧУ: подряд идущие ПД одного ПЧУ — одна ячейка.
  // Ключ включает направление: ПЧУ соседних направлений — разные ячейки.
  for (const g of groups((c) => (c.span ? `${c.line}\n${c.span.pchu ?? ''}` : undefined))) {
    const x = xOf(g.from),
      w = (g.to - g.from + 1) * width
    const pchu = g.value?.split('\n')[1]
    if (!pchu) {
      back.push(cell(x, top(10), w, height(10)))
      front.push(centered('—', x + w / 2, top(10), height(10), CELL))
      continue
    }
    const fill = PCHU_FILLS[Math.max(0, pchuOrder.indexOf(pchu)) % PCHU_FILLS.length] ?? ''
    back.push(cell(x, top(10), w, height(10), fill))
    const words = caption(pchu, heads[pchu], w, measurer)
    if (words[0])
      front.push(centered(words[0], x + w / 2, top(10) - 2, height(10), CELL_BOLD, WHITE))
    if (words[1]) front.push(centered(words[1], x + w / 2, top(10) + 2, height(10), CELL, WHITE))
  }
  // Внешняя рамка таблицы.
  const right = xOf(columns.length)
  for (const [a, b, c, d] of [
    [LEFT, y0, right, y0],
    [LEFT, y, right, y],
    [LEFT, y0, LEFT, y],
    [right, y0, right, y],
  ] as const)
    front.push(thick(a, b, c, d, 0.5))
  return { shapes: [...back, ...front], height: y - y0 }
}

interface Totals {
  meters: number
  stationMeters: number
  switches: number
  stations: number
  pds: string[]
}

/** Итоги по ПЧУ: главный путь по участкам ПД, станции без повторов примыкания. */
function totals(prepared: readonly Prepared[], source: OverviewSource): Map<string, Totals> {
  const result = new Map<string, Totals>()
  const of = (pchu: string) => {
    const existing = result.get(pchu)
    if (existing) return existing
    const created: Totals = { meters: 0, stationMeters: 0, switches: 0, stations: 0, pds: [] }
    result.set(pchu, created)
    return created
  }
  for (const line of prepared) {
    for (const span of line.spans) {
      const t = of(span.pchu ?? '')
      t.meters += span.meters
      if (!t.pds.includes(span.code)) t.pds.push(span.code)
    }
    for (const c of line.columns) {
      if (!c.span || !c.name || c.repeated) continue
      const t = of(c.span.pchu ?? '')
      const own = source.stationStats?.[c.name]
      t.stations++
      t.stationMeters += own?.meters ?? 0
      t.switches += own?.switches ?? 0
    }
  }
  return result
}

function summary(
  prepared: readonly Prepared[],
  source: OverviewSource,
  measurer: TextMeasurer,
): Summary {
  const byPchu = totals(prepared, source)
  const codes = [...byPchu.keys()].toSorted((a, b) =>
    a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ru', { numeric: true }),
  )
  const heads = source.heads ?? {}
  const widths = [20, 32, 104, 31, 29, 28, 20]
  const titles = [
    'ПЧУ',
    'Руководитель',
    'Линейные участки',
    'Главный путь, км',
    'Станц. пути, км',
    'Стрел. переводы',
    'Станций',
  ]
  const xs = widths.map((_, i) => LEFT + widths.slice(0, i).reduce((n, w) => n + w, 0))
  const title = text('Итоги по эксплуатационным участкам', LEFT, 4, bold(3))
  const rowsOut: Piece[] = []
  /** Строка итогов: длинный перечень ПД переносится, высота строки растёт. */
  const row = (
    values: readonly string[],
    options: { fill?: string; color?: string; font: SheetFont },
  ) => {
    const color = options.color ? { color: options.color } : {}
    const lines = values.map((value, i) => {
      const w = (widths[i] ?? 0) - 3
      if (i !== 2) return [fit(value, w, options.font, measurer)]
      const wrapped = wrapText(value, w, options.font, measurer)
      return wrapped.ok && wrapped.value.length
        ? wrapped.value
        : [fit(value, w, options.font, measurer)]
    })
    const rows = Math.max(1, ...lines.map((l) => l.length))
    const h = Math.max(7, rows * 3.4 + 3)
    const y = 0
    const shapes: SheetPrimitive[] = []
    for (const [i, words] of lines.entries()) {
      const x = xs[i] ?? LEFT,
        w = widths[i] ?? 0
      shapes.push(cell(x, y, w, h, options.fill))
      for (const [k, word] of words.entries()) {
        if (!word) continue
        const baseline =
          y + h / 2 - ((words.length - 1) * 3.4) / 2 + options.font.size.value * 0.35 + k * 3.4
        shapes.push(
          text(
            word,
            i >= 3 ? x + w - 1.5 - measurer.width(word, options.font).value : x + 1.5,
            baseline,
            options.font,
            color,
          ),
        )
      }
    }
    rowsOut.push({ shapes, height: h })
  }
  row(titles, { fill: LABEL_FILL, font: LABEL })
  const all: Totals = { meters: 0, stationMeters: 0, switches: 0, stations: 0, pds: [] }
  for (const code of codes) {
    const t = byPchu.get(code)
    if (!t) continue
    all.meters += t.meters
    all.stationMeters += t.stationMeters
    all.switches += t.switches
    all.stations += t.stations
    all.pds.push(...t.pds.filter((p) => !all.pds.includes(p)))
    row(
      [
        code || 'Без ПЧУ',
        code ? (heads[code] ?? '') : '',
        t.pds
          .toSorted((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
          .map((p) => (heads[p] ? `${p} (${heads[p]})` : p))
          .join(', '),
        kmText(t.meters),
        kmText(t.stationMeters),
        String(t.switches),
        String(t.stations),
      ],
      { font: CELL },
    )
  }
  const pchus = codes.filter(Boolean).length
  row(
    [
      'ВСЕГО',
      '',
      `${pchus} ПЧУ · ${all.pds.length} ПД`,
      kmText(all.meters),
      kmText(all.stationMeters),
      String(all.switches),
      String(all.stations),
    ],
    { fill: '#141414', color: WHITE, font: CELL_BOLD },
  )
  // Примечания справа от итогов.
  const notesX = LEFT + widths.reduce((n, w) => n + w, 0) + 6
  const junctions = new Map<string, string>()
  for (const line of prepared)
    for (const c of line.columns)
      if (c.name && !c.repeated && !junctions.has(c.name)) junctions.set(c.name, line.line)
  const repeated = [
    ...new Set(prepared.flatMap((l) => l.columns.filter((c) => c.repeated).map((c) => c.name))),
  ]
  const notes: { text: string; color?: string }[] = [
    { text: 'Станционные пути — без главных, по полной длине.' },
    ...repeated.map((name) => ({
      text: `* ${name} — станция примыкания направлений; показатели учтены один раз (${junctions.get(name) ?? ''}).`,
    })),
    ...prepared.flatMap((l) => l.gaps.map((g) => ({ text: g }))),
    ...(source.unboundStations?.length
      ? [
          {
            text: `Не входят в привязку к ПД: ${source.unboundStations.join(', ')}.`,
            color: DISTRICT_RED,
          },
        ]
      : []),
  ]
  const noteLines: Piece[] = []
  for (const note of notes) {
    const wrapped = wrapText(note.text, RIGHT - notesX, regular(2.6), measurer)
    const lines = wrapped.ok ? wrapped.value : [note.text]
    for (const [k, line] of lines.entries())
      noteLines.push({
        shapes: [text(line, notesX, 2, regular(2.6), note.color ? { color: note.color } : {})],
        height: k === lines.length - 1 ? 5 : 3.6,
      })
  }
  const [header, ...body] = rowsOut
  return {
    title: { shapes: [title], height: 7 },
    header: header ?? { shapes: [], height: 0 },
    rows: body,
    notes: noteLines,
  }
}

interface Piece {
  readonly shapes: readonly SheetPrimitive[]
  readonly height: number
}
/** Итоги по частям: заголовок, шапка таблицы, строки и строки примечаний справа. */
interface Summary {
  readonly title: Piece
  readonly header: Piece
  readonly rows: readonly Piece[]
  readonly notes: readonly Piece[]
}
const sum = (pieces: readonly Piece[]) => pieces.reduce((n, p) => n + p.height, 0)

/** Текст, укороченный многоточием до ширины ячейки итогов. */
function fit(value: string, width: number, font: SheetFont, measurer: TextMeasurer): string {
  if (measurer.width(value, font).value <= width) return value
  let cut = value
  while (cut.length > 1 && measurer.width(`${cut}…`, font).value > width) cut = cut.slice(0, -1)
  return `${cut}…`
}

/** Столбцы листа: целые направления, пока помещаются; длинное направление делится. */
function chunks(columns: readonly Column[]): Column[][] {
  const capacity = Math.floor(TABLE_WIDTH / MIN_COLUMN + EPS)
  const result: Column[][] = []
  let current: Column[] = []
  const lines: Column[][] = []
  for (const c of columns) {
    const last = lines.at(-1)
    if (last && last[0]?.line === c.line) last.push(c)
    else lines.push([c])
  }
  for (const line of lines) {
    if (current.length && current.length + line.length > capacity) {
      result.push(current)
      current = []
    }
    for (const c of line) {
      if (current.length >= capacity) {
        result.push(current)
        current = []
      }
      current.push(c)
    }
  }
  if (current.length) result.push(current)
  return result
}

export function buildDistrictSchemeC(
  source: OverviewSource,
  measurer: TextMeasurer,
): Result<OverviewDocument, SheetError> {
  const prepared = districtLines(source)
  if (!prepared.ok) return prepared
  const warnings = [...source.warnings]
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
  const outside = prepared.value.flatMap((l) => l.columns.filter((c) => c.name && !c.span))
  if (outside.length)
    warnings.push(
      `Станции вне участков ПД (в итоги не входят): ${outside.map((c) => c.name).join(', ')}.`,
    )
  const pchuOrder = [
    ...new Set(source.boundaries.flatMap((b) => (b.pchu ? [b.pchu] : []))),
  ].toSorted((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
  const bodies: SheetPrimitive[][] = [[]]
  let y = TOP + 4
  for (const columns of chunks(prepared.value.flatMap((l) => l.columns))) {
    const block = table(columns, 0, source, pchuOrder, measurer)
    if (y + block.height > BOTTOM && y > TOP + 4) {
      if (bodies.length >= MAX_PAGES) return err({ message: 'Документ превышает 50 листов.' })
      bodies.push([])
      y = TOP + 4
    }
    bodies.at(-1)?.push(...moveShapes(block.shapes, y))
    y += block.height + 8
  }
  if (!prepared.value.length)
    bodies[0]?.push(
      text('Нет направлений. Загрузите оргструктуру паспорта.', LEFT, TOP + 10, regular()),
    )
  // Итоги: целиком, если помещаются на лист; иначе строки таблицы и примечания по листам.
  const parts = summary(prepared.value, source, measurer)
  const tableHeight = parts.title.height + parts.header.height + sum(parts.rows)
  const notes = 2 + sum(parts.notes)
  const whole = Math.max(tableHeight, parts.title.height + notes)
  const page = () => {
    bodies.push([])
    y = TOP + 4
  }
  const put = (piece: Piece) => {
    bodies.at(-1)?.push(...moveShapes(piece.shapes, y))
    y += piece.height
  }
  if (whole <= BOTTOM - TOP - 4) {
    if (y + whole > BOTTOM) page()
    const top = y
    put(parts.title)
    put(parts.header)
    for (const r of parts.rows) put(r)
    y = top + parts.title.height + 2
    for (const n of parts.notes) put(n)
  } else {
    if (y + parts.title.height + parts.header.height + (parts.rows[0]?.height ?? 0) > BOTTOM) page()
    put(parts.title)
    put(parts.header)
    for (const r of parts.rows) {
      if (y + r.height > BOTTOM) {
        page()
        put(parts.header)
      }
      put(r)
    }
    y += 4
    for (const n of parts.notes) {
      if (y + n.height > BOTTOM) page()
      put(n)
    }
  }
  if (bodies.length > MAX_PAGES) return err({ message: 'Документ превышает 50 листов.' })
  const pages: SheetPage[] = bodies.map((body, i) => ({
    width: mm(420),
    height: mm(297),
    number: i + 1,
    primitives: [
      ...districtHeader(
        source,
        'Схема-таблица: станции по направлениям в порядке осей, под ними — линейные (ПД) и эксплуатационные (ПЧУ) участки',
        measurer,
      ),
      ...body,
      colored(thick(LEFT, 288, RIGHT, 288, 0.3), CAPTION),
      text(
        `Редакция от ${source.edition.date.split('-').toReversed().join('.')} · Лист ${i + 1}`,
        LEFT,
        292.5,
        regular(2.2),
        { color: CAPTION },
      ),
      ...(warnings.length
        ? [
            text(
              `Замечаний: ${warnings.length}; список — в предпросмотре.`,
              RIGHT -
                measurer.width(
                  `Замечаний: ${warnings.length}; список — в предпросмотре.`,
                  regular(2.2),
                ).value,
              292.5,
              regular(2.2),
              { color: DISTRICT_RED },
            ),
          ]
        : []),
    ],
  }))
  return ok({ pages, warnings })
}
