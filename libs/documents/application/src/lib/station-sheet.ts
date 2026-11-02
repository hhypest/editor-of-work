import { err, ok, type Result, type StationLayout } from '@eow/shared/kernel'
import type { PlanSheetData, PlanSheetStation } from '@eow/planning/sheet-api'
import { mm, type SheetError, type SheetPrimitive, type TextMeasurer } from './sheet-model'
import { bold, narrow, textBlock } from './sheet-text'
import { sheetLine as line, sheetRect as rect, sheetText as text } from './sheet-drawing'
import { packCallouts, type CalloutInput } from './callout-packing'
import type { SheetWriter } from './sheet-pages'

type Pd = PlanSheetData['pds'][number]
interface Point {
  readonly x: number
  readonly y: number
}

/** Колонка сетки (половина междупутья по горизонтали) не шире 4 мм. */
const MAX_COL = 4
const SCHEME_WIDTH = 380
/** Высота рядов схемы не больше 90 мм; междупутье — не больше 8 мм. */
const SCHEME_ROWS_HEIGHT = 90
const MAX_ROW = 8
/** Поля над и под схемой для подписей путей и стрелок, мм. */
const PAD = 8
const LABEL = narrow(2.5)
const TRACK_WEIGHT = { main: 0.6, station: 0.4, connector: 0.3, siding: 0.3 } as const

const objectText = (object: PlanSheetStation['works'][number]['object']): string =>
  object === null
    ? 'вся станция'
    : `${object.kind === 'track' ? 'путь' : 'стрелка'} № ${object.number}`

const thick = (
  a: Point,
  b: Point,
  weight: number,
  options: { readonly dashed?: boolean; readonly shade?: boolean } = {},
): SheetPrimitive => ({
  kind: 'line',
  x1: mm(a.x),
  y1: mm(a.y),
  x2: mm(b.x),
  y2: mm(b.y),
  dashed: options.dashed ?? false,
  weight: mm(weight),
  ...(options.shade ? { shade: true } : {}),
})

const segments = (points: readonly Point[]): (readonly [Point, Point])[] =>
  points.flatMap((b, i) => {
    const a = points[i - 1]
    return a ? [[a, b] as const] : []
  })

/** Точка ломаной на колонке: остряк и мост лежат на линии своего пути. */
function pointAt(points: readonly Point[], x: number): Point | undefined {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (!a || !b || x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) continue
    const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
    return { x, y: a.y + (b.y - a.y) * t }
  }
  return undefined
}

/** Середина самого длинного горизонтального отрезка (или любого, если таких нет). */
function trackMiddle(points: readonly Point[]): Point | undefined {
  let best: { a: Point; b: Point; score: number } | undefined
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (!a || !b) continue
    // Горизонтальный отрезок всегда предпочтительнее наклонного.
    const score = Math.abs(b.x - a.x) + (Math.abs(a.y - b.y) < 0.001 ? 10_000 : 0)
    if (!best || score > best.score) best = { a, b, score }
  }
  return best && { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 }
}

interface Scheme {
  readonly height: number
  /** Фигуры схемы относительно верха блока. */
  readonly shapes: readonly SheetPrimitive[]
  readonly anchors: ReadonlyMap<string, Point>
  readonly center: Point
  readonly missing: readonly string[]
}

/** Схема по раскладке: сетка вписывается в ширину листа, ряды — не выше 90 мм. */
function drawScheme(
  layout: StationLayout,
  works: PlanSheetStation['works'],
  measurer: TextMeasurer,
): Result<Scheme, SheetError> {
  if (
    layout.nodes.length > 20_000 ||
    layout.tracks.length > 5_000 ||
    layout.switches.length + layout.derailers.length > 10_000 ||
    layout.bridges.length + layout.crossings.length > 2_000
  )
    return err({ message: 'схема слишком велика для листа.' })
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]))
  if (
    layout.tracks.some((t) => t.nodes.some((id) => !nodes.has(id))) ||
    layout.switches.some((s) => !nodes.has(s.node))
  )
    return err({ message: 'раскладка схемы ссылается на неизвестные узлы.' })
  const cols = [...layout.nodes.map((n) => n.col), ...layout.crossings.map((c) => c.col)]
  const rows = [
    ...layout.nodes.map((n) => n.row),
    ...layout.crossings.flatMap((c) => [c.fromRow, c.toRow]),
  ]
  const minCol = Math.min(0, ...cols),
    minRow = Math.min(0, ...rows)
  const width = Math.max(1, Math.max(0, ...cols) - minCol),
    height = Math.max(0, ...rows) - minRow
  const unit = Math.min(MAX_COL, SCHEME_WIDTH / width)
  // Междупутье растягивается до 8 мм, чтобы номера путей и стрелок не наползали друг на друга.
  const step = height
    ? Math.min(Math.max(2 * unit, MAX_ROW), SCHEME_ROWS_HEIGHT / height)
    : 2 * unit
  if (unit < 0.5 || step < 1) return err({ message: 'схема слишком велика для листа А3.' })
  const left = 15 + (390 - width * unit) / 2
  const at = (col: number, row: number): Point => ({
    x: left + (col - minCol) * unit,
    y: PAD + (row - minRow) * step,
  })
  const trackPoints = new Map(
    layout.tracks.map((t) => [
      t.id,
      t.nodes.flatMap((id) => {
        const n = nodes.get(id)
        return n ? [at(n.col, n.row)] : []
      }),
    ]),
  )
  const onTrack = (track: string, col: number): Point | undefined =>
    pointAt(trackPoints.get(track) ?? [], at(col, 0).x)
  const background: SheetPrimitive[] = [],
    highlight: SheetPrimitive[] = [],
    lines: SheetPrimitive[] = [],
    labels: SheetPrimitive[] = []
  const label = (value: string, x: number, y: number): void => {
    const w = measurer.width(value, LABEL).value
    labels.push(rect(x - 0.4, y - 2.2, w + 0.8, 2.8, false, false), text(value, x, y, LABEL))
  }
  for (const c of layout.crossings) {
    const top = at(c.col, c.fromRow),
      bottom = at(c.col, c.toRow)
    background.push(line(top.x, top.y - step / 2, bottom.x, bottom.y + step / 2, true))
    label(c.label, top.x + 0.8, Math.max(2.5, top.y - step / 2 - 0.8))
  }
  const anchors = new Map<string, Point>()
  const trackByNumber = new Map(
    layout.tracks.flatMap((t) => (t.number === null ? [] : [[t.number, t] as const])),
  )
  const switchByNumber = new Map(
    layout.switches.flatMap((s) => (s.number === null ? [] : [[s.number, s] as const])),
  )
  const missing: string[] = []
  for (const w of works) {
    if (!w.object) continue
    if (w.object.kind === 'track') {
      const track = trackByNumber.get(w.object.number)
      const points = track ? (trackPoints.get(track.id) ?? []) : []
      const middle = trackMiddle(points)
      if (!track || !middle) {
        missing.push(objectText(w.object))
        continue
      }
      for (const [a, b] of segments(points)) highlight.push(thick(a, b, 2.4, { shade: true }))
      anchors.set(w.id, middle)
    } else {
      const s = switchByNumber.get(w.object.number)
      const node = s && nodes.get(s.node)
      if (!node) {
        missing.push(objectText(w.object))
        continue
      }
      const p = at(node.col, node.row)
      highlight.push({ kind: 'circle', x: mm(p.x), y: mm(p.y), radius: mm(1.6), shade: true })
      anchors.set(w.id, p)
    }
  }
  for (const t of layout.tracks) {
    const points = trackPoints.get(t.id) ?? []
    for (const [a, b] of segments(points))
      lines.push(thick(a, b, TRACK_WEIGHT[t.kind], { dashed: t.state !== 'normal' }))
    const middle = trackMiddle(points)
    if (t.number !== null && middle) {
      const w = measurer.width(t.number, LABEL).value
      label(t.number, middle.x - w / 2, middle.y - 0.8)
    }
  }
  for (const b of layout.bridges) {
    const from = onTrack(b.track, b.fromCol),
      to = onTrack(b.track, b.toCol)
    if (!from || !to) continue
    lines.push(line(from.x, from.y - 1, to.x, to.y - 1), line(from.x, from.y + 1, to.x, to.y + 1))
  }
  for (const d of layout.derailers) {
    const p = onTrack(d.track, d.col)
    if (!p) continue
    lines.push(line(p.x, p.y, p.x + 1.5, p.y + 1.5))
    label(d.number, p.x + 1.8, p.y + 3.8)
  }
  const tracks = new Map(layout.tracks.map((t) => [t.id, t]))
  for (const n of layout.nodes) {
    const p = at(n.col, n.row)
    if (n.end === 'stop') lines.push(thick({ x: p.x, y: p.y - 1.2 }, { x: p.x, y: p.y + 1.2 }, 0.4))
  }
  for (const s of layout.switches) {
    const node = nodes.get(s.node)
    if (!node) continue
    const p = at(node.col, node.row)
    // Подпись ставится с той стороны пути, куда не уходит ответвление.
    const branch = tracks.get(s.branch)?.nodes ?? []
    const next = nodes.get((branch[0] === s.node ? branch[1] : branch.at(-2)) ?? '')
    const down = next !== undefined && next.row > node.row
    label(s.number ?? '?', p.x + 0.6, down ? p.y - 1 : p.y + 3.4)
  }
  const extent = at(minCol + width, minRow + height)
  return ok({
    height: extent.y + PAD,
    shapes: [...background, ...highlight, ...lines, ...labels],
    anchors,
    center: { x: 210, y: extent.y / 2 + PAD / 2 },
    missing,
  })
}

const move = (shapes: readonly SheetPrimitive[], dy: number): SheetPrimitive[] =>
  shapes.map((s) =>
    s.kind === 'line'
      ? { ...s, y1: mm(s.y1.value + dy), y2: mm(s.y2.value + dy) }
      : { ...s, y: mm(s.y.value + dy) },
  )

/**
 * Листы станции после листов её ПД (ADR-0048): схема из раскладки с серой подсветкой путей
 * и стрелок, на которых есть работы, выноски с номером строки ведомости, затем таблицы станции.
 * Избыток выносок повторяет схему на следующем блоке, как ряд на листе ПД.
 */
export function drawStationSheets(
  writer: SheetWriter,
  data: PlanSheetData,
  pd: Pd,
  station: PlanSheetStation,
  measurer: TextMeasurer,
): Result<readonly string[], SheetError> {
  if (
    station.works.length > 10_000 ||
    station.tables.reduce((n, t) => n + t.rows.length, 0) > 20_000
  )
    return err({ message: `Станция «${station.name}»: слишком много работ или строк таблиц.` })
  const warnings: string[] = []
  writer.setFrame({
    title: `ППР ${data.year} · станция ${station.name} · ${pd.name} · ${pd.pchu}`,
    notes: [
      'Серая подсветка — путь или стрелка с работой; № выноски — строка ведомости работ станции.',
      '* — ручное значение плана; объёмы относятся ко всей станции.',
    ],
    footer: (number) =>
      `Редакция ${data.edition.number} от ${data.edition.date} · схема станции без масштаба · Лист ${number}`,
  })
  if (!station.layout) {
    writer.add([
      text(
        'Схема станции не загружена в редакцию паспорта, по которой составлен план. Работы — в ведомости.',
        15,
        writer.y + 4,
      ),
    ])
    writer.y += 12
    if (station.works.length)
      warnings.push(`Станция «${station.name}»: схемы нет в срезе плана, работы — в ведомости.`)
  } else {
    const scheme = drawScheme(station.layout, station.works, measurer)
    if (!scheme.ok) return err({ message: `Станция «${station.name}»: ${scheme.error.message}` })
    for (const object of new Set(scheme.value.missing))
      warnings.push(`Станция «${station.name}»: на схеме нет объекта с работой — ${object}.`)
    const callouts: CalloutInput[] = []
    const points = new Map<string, Point>()
    for (const [index, w] of station.works.entries()) {
      if (!w.callout) continue
      const point = scheme.value.anchors.get(w.id) ?? scheme.value.center
      points.set(w.id, point)
      callouts.push({
        id: w.id,
        anchor: Math.min(385, Math.max(35, point.x)),
        text: `${index + 1}. ${w.name} · ${String(w.volume).replace('.', ',')} ${w.unit} · ${objectText(w.object)}`,
      })
    }
    const packed = packCallouts(callouts, measurer)
    if (!packed.ok) return packed
    for (const [bandIndex, band] of packed.value.entries()) {
      const height = 6 + scheme.value.height + (band.height ? band.height + 6 : 0)
      if (!writer.fits(height)) {
        if (writer.empty)
          return err({
            message: `Выноски станции «${station.name}» не помещаются на лист со схемой. Сократите тексты выносок.`,
          })
        const saved = writer.flush()
        if (!saved.ok) return saved
      }
      const y = writer.y
      const title = textBlock(
        `Схема станции ${station.name}${bandIndex ? ' · выноски (продолжение)' : ''}`,
        15,
        y + 3,
        390,
        1,
        bold(3),
        measurer,
      )
      if (!title.ok) return title
      const top = y + 6
      const boxesTop = top + scheme.value.height + 6
      const leaders = band.boxes.flatMap((b) => {
        const p = points.get(b.id)
        return p ? [line(p.x, top + p.y, b.x + b.width / 2, boxesTop + b.y)] : []
      })
      const boxes = band.boxes.flatMap((b) => [
        rect(b.x, boxesTop + b.y, b.width, b.height),
        ...b.lines.map((s, i) => text(s, b.x + 2, boxesTop + b.y + 4 + i * 3.5, narrow(2.5))),
      ])
      writer.add([...title.value, ...move(scheme.value.shapes, top), ...leaders, ...boxes])
      for (const w of station.works) if (scheme.value.anchors.has(w.id)) writer.addWork(w.id)
      for (const b of band.boxes) writer.addWork(b.id)
      writer.y += height + 4
    }
  }
  for (const table of station.tables) {
    const added = writer.table(table)
    if (!added.ok) return added
  }
  const saved = writer.flush()
  return saved.ok ? ok(warnings) : saved
}
