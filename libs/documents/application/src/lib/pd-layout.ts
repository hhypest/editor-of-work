import type { PlanSheetData } from '@eow/planning/sheet-api'
import {
  chainage,
  compareChainage,
  distance,
  err,
  formatPlus,
  KmLengths,
  mergeSpans,
  offset,
  ok,
  spanContains,
  type Chainage,
  type Result,
  type TrackSpan,
} from '@eow/shared/kernel'
import type {
  OverviewDocument,
  OverviewScale,
  SheetError,
  SheetPrimitive,
  TextMeasurer,
} from './sheet-model'
import { bold, narrow, textBlock } from './sheet-text'
import {
  sheetLine as line,
  sheetRect as rect,
  sheetText as text,
  moveShapes,
} from './sheet-drawing'
import { drawCallouts, packCallouts, type CalloutInput } from './callout-packing'
import { SheetWriter } from './sheet-pages'
import { drawStationSheets } from './station-sheet'

export interface PdSheetClient {
  load(open: boolean): Promise<Result<PlanSheetData | null | 'cancelled', SheetError>>
}
export interface EditorSheetClient {
  source(revision: number, pd: string): Promise<Result<PlanSheetData, SheetError>>
}
export interface PdDocument extends OverviewDocument {
  readonly workIdsByPage: readonly (readonly string[])[]
  /** Первый лист каждой станции ПД (индекс в pages): переход к листу станции. */
  readonly stations: readonly { readonly id: string; readonly page: number }[]
}
interface Row {
  readonly span: TrackSpan
  readonly lengths: KmLengths
  readonly name: string
  readonly first: boolean
  readonly last: boolean
}

function prepare(
  data: PlanSheetData,
  pdId: string,
  scale: OverviewScale,
): Result<readonly Row[], SheetError> {
  if (![25000, 50000, 100000].includes(scale))
    return err({ message: 'Выберите поддерживаемый масштаб.' })
  if (
    data.lines.length > 1000 ||
    data.pds.length > 2000 ||
    data.pds.reduce((n, p) => n + p.segments.length, 0) > 50000
  )
    return err({ message: 'Слишком много направлений или границ для одного документа.' })
  const selected = data.pds.find((p) => p.id === pdId)
  if (!selected) return err({ message: 'ПД отсутствует в срезе плана.' })
  if (
    new Set(data.pds.map((p) => p.id)).size !== data.pds.length ||
    new Set(data.lines.map((l) => l.id)).size !== data.lines.length
  )
    return err({ message: 'Повторяется идентификатор ПД или направления.' })
  const lines = new Map<
    string,
    { lengths: KmLengths; extents: readonly TrackSpan[]; name: string }
  >()
  for (const l of data.lines) {
    const lengths = KmLengths.of(l.kmLengths)
    if (!lengths.ok) return err({ message: `${l.name}: неверные длины километров.` })
    const extents = l.extents
      .map((s) => ({ ...s, line: l.id }))
      .toSorted((a, b) => compareChainage(a.from, b.from))
    for (const [i, s] of extents.entries()) {
      const previous = extents[i - 1]
      if (
        !chainage(s.from.km, s.from.m, lengths.value).ok ||
        !chainage(s.to.km, s.to.m, lengths.value).ok ||
        compareChainage(s.from, s.to) >= 0 ||
        s.to.km - s.from.km > 100000 ||
        (previous && compareChainage(previous.to, s.from) > 0)
      )
        return err({ message: `${l.name}: недопустимое протяжение направления.` })
    }
    lines.set(l.id, { lengths: lengths.value, extents: mergeSpans(extents), name: l.name })
  }
  const all = data.pds
    .flatMap((p) => p.segments.map((span) => ({ pd: p.id, span })))
    .toSorted(
      (a, b) => a.span.line.localeCompare(b.span.line) || compareChainage(a.span.from, b.span.from),
    )
  for (const [i, entry] of all.entries()) {
    const l = lines.get(entry.span.line),
      s = entry.span,
      prev = all[i - 1]?.span
    if (
      !l ||
      !chainage(s.from.km, s.from.m, l.lengths).ok ||
      !chainage(s.to.km, s.to.m, l.lengths).ok ||
      compareChainage(s.from, s.to) >= 0 ||
      !l.extents.some((e) => spanContains(e, s))
    )
      return err({ message: 'Граница ПД вне протяжения направления или пересекает его разрыв.' })
    if (prev?.line === s.line && compareChainage(prev.to, s.from) > 0)
      return err({ message: 'Границы ПД перекрываются.' })
  }
  const rows: Row[] = []
  for (const entry of all.filter((a) => a.pd === pdId)) {
    const l = lines.get(entry.span.line)
    if (!l) return err({ message: 'Направление границы ПД отсутствует.' })
    let from = entry.span.from
    while (compareChainage(from, entry.span.to) < 0) {
      if (rows.length >= 1000)
        return err({ message: 'Слишком много рядов. Выберите меньший масштаб.' })
      const end = offset(
        from,
        Math.min(distance(from, entry.span.to, l.lengths), (350 * scale) / 1000),
        l.lengths,
      )
      if (!end.ok) return err({ message: 'Не удалось разбить направление на ряды.' })
      rows.push({
        span: { line: entry.span.line, from, to: end.value },
        lengths: l.lengths,
        name: l.name,
        first: compareChainage(from, entry.span.from) === 0,
        last: compareChainage(end.value, entry.span.to) === 0,
      })
      from = end.value
    }
  }
  return ok(rows)
}

function neighbor(data: PlanSheetData, pdId: string, row: Row, side: 'from' | 'to'): string {
  const at = row.span[side]
  if (!(side === 'from' ? row.first : row.last)) return 'Продолжение ряда'
  const adjacent = data.pds.filter(
    (p) =>
      p.id !== pdId &&
      p.segments.some(
        (s) =>
          s.line === row.span.line && compareChainage(s[side === 'from' ? 'to' : 'from'], at) === 0,
      ),
  )
  if (adjacent.length)
    return `${side === 'from' ? 'От' : 'К'} ${adjacent.map((p) => p.name).join(', ')}`
  if (
    data.pds
      .find((p) => p.id === pdId)
      ?.segments.some(
        (s) =>
          s.line === row.span.line && compareChainage(s[side === 'from' ? 'to' : 'from'], at) === 0,
      )
  )
    return 'Продолжение этого ПД'
  const l = data.lines.find((v) => v.id === row.span.line)
  const inside = l?.extents.some((s) =>
    side === 'from'
      ? compareChainage(s.from, at) < 0 && compareChainage(at, s.to) <= 0
      : compareChainage(s.from, at) <= 0 && compareChainage(at, s.to) < 0,
  )
  return inside ? 'Вне действующих ПД' : 'Граница направления'
}

/** Листы одного ПД по неизменяемому срезу плана. Таблицы продолжаются с заголовками. */
export function buildPdSheets(
  data: PlanSheetData,
  pdId: string,
  scale: OverviewScale,
  measurer: TextMeasurer,
): Result<PdDocument, SheetError> {
  const prepared = prepare(data, pdId, scale)
  if (!prepared.ok) return prepared
  const pd = data.pds.find((p) => p.id === pdId)
  if (!pd) return err({ message: 'ПД отсутствует в срезе плана.' })
  if (pd.works.length > 10000 || pd.tables.reduce((n, t) => n + t.rows.length, 0) > 20000)
    return err({ message: 'Слишком много работ или строк таблиц.' })
  const knownWorks = new Set(pd.works.map((w) => w.id))
  if (
    knownWorks.size !== pd.works.length ||
    pd.tables.some(
      (t) =>
        t.workIds !== undefined &&
        (t.workIds.length !== t.rows.length || t.workIds.some((id) => !knownWorks.has(id))),
    )
  )
    return err({ message: 'Неверные ссылки строк ведомости на работы ПД.' })
  const warnings: string[] = []
  const hasStatement = pd.tables.some((table) => table.workIds !== undefined)
  // Выноски станционных работ стоят на листах станций; без листа станции остаётся ведомость.
  const onStationSheets = new Set(pd.stations.flatMap((s) => s.works.map((w) => w.id)))
  if (
    hasStatement &&
    pd.works.some((w) => w.lineId === null && w.callout && !onStationSheets.has(w.id))
  )
    warnings.push('Станционные работы показаны в ведомости: в срезе плана нет координат их осей.')
  if (!hasStatement && pd.works.some((w) => w.lineId === null && !onStationSheets.has(w.id)))
    warnings.push('Ведомость работ не выведена. Станционные работы не показаны на листах ПД.')
  const footer = (number: number) =>
    `Редакция ${data.edition.number} от ${data.edition.date} · 1:${scale} · Лист ${number}`
  const writer = new SheetWriter(data, measurer, {
    title: `ППР ${data.year} · ${pd.name} · ${pd.pchu}`,
    notes: [
      'Линия — главный путь; серый участок — работа; № выноски — строка ведомости.',
      '* — ручное значение плана; объёмы относятся ко всему ПД, а не к отдельной странице.',
    ],
    footer,
  })
  for (const row of prepared.value) {
    const x = (at: Chainage) => 35 + (distance(row.span.from, at, row.lengths) * 1000) / scale
    const marks: SheetPrimitive[] = [],
      rowWorks: string[] = [],
      callouts: CalloutInput[] = []
    for (const [index, w] of pd.works.entries()) {
      if (w.lineId !== row.span.line) continue
      const anchors: number[] = []
      for (const item of w.items) {
        if (item.line !== row.span.line)
          return err({ message: 'Место работы относится к другому направлению.' })
        const points = item.kind === 'span' ? [item.from, item.to] : [item.at]
        if (points.some((p) => !chainage(p.km, p.m, row.lengths).ok))
          return err({ message: 'Недопустимая координата работы.' })
        if (item.kind === 'span') {
          if (compareChainage(item.from, item.to) >= 0)
            return err({ message: 'Недопустимый участок работы.' })
          const from = compareChainage(item.from, row.span.from) < 0 ? row.span.from : item.from
          const to = compareChainage(item.to, row.span.to) > 0 ? row.span.to : item.to
          if (compareChainage(from, to) >= 0) continue
          const left = x(from),
            right = x(to)
          marks.push(rect(left, 9 - (index % 3) * 2, right - left, 1.3, true, true))
          anchors.push((left + right) / 2)
        } else {
          const last =
            row.last &&
            !pd.segments.some(
              (s) => s.line === row.span.line && compareChainage(s.from, row.span.to) === 0,
            )
          // Точка на стыке ПД принадлежит следующему, как в расчёте Планирования.
          const owned = pd.segments.some(
            (s) =>
              s.line === item.line &&
              compareChainage(s.from, item.at) <= 0 &&
              compareChainage(item.at, s.to) < 0,
          )
          if (
            !owned ||
            compareChainage(item.at, row.span.from) < 0 ||
            compareChainage(item.at, row.span.to) > 0 ||
            (!last && compareChainage(item.at, row.span.to) === 0)
          )
            continue
          const at = x(item.at)
          marks.push(line(at, 7, at, 12))
          anchors.push(at)
        }
      }
      const anchor = anchors[0]
      if (anchor !== undefined) rowWorks.push(w.id)
      if (w.callout && anchor !== undefined)
        callouts.push({
          id: w.id,
          anchor,
          text: `${index + 1}. ${w.name} · ${String(w.volume).replace('.', ',')} ${w.unit} в ПД · ${w.place}`,
        })
    }
    const packed = packCallouts(callouts, measurer)
    if (!packed.ok) return packed
    for (const [bandIndex, band] of packed.value.entries()) {
      const height = 30 + band.height
      if (!writer.fits(height)) {
        const saved = writer.flush()
        if (!saved.ok) return saved
      }
      const y = writer.y
      const title = textBlock(
        `${row.name} · ${formatPlus(row.span.from)} – ${formatPlus(row.span.to)}${bandIndex ? ' · выноски (продолжение)' : ''}`,
        15,
        y,
        390,
        1,
        bold(3),
        measurer,
      )
      if (!title.ok) return title
      const left = textBlock(
        `${neighbor(data, pdId, row, 'from')} · ${formatPlus(row.span.from)}`,
        15,
        y + 18,
        180,
        1,
        narrow(2.5),
        measurer,
      )
      const right = textBlock(
        `${neighbor(data, pdId, row, 'to')} · ${formatPlus(row.span.to)}`,
        Math.max(
          15,
          Math.min(
            x(row.span.to) -
              measurer.width(
                `${neighbor(data, pdId, row, 'to')} · ${formatPlus(row.span.to)}`,
                narrow(2.5),
              ).value,
            215,
          ),
        ),
        y + 22,
        190,
        1,
        narrow(2.5),
        measurer,
      )
      if (!left.ok) return left
      if (!right.ok) return right
      writer.add([
        ...title.value,
        line(35, y + 12, x(row.span.to), y + 12),
        ...moveShapes(marks, y),
        ...drawCallouts(band, y + 27, y + 12),
        ...[...left.value, ...right.value].flatMap((label) =>
          label.kind === 'text'
            ? [
                rect(
                  label.x.value - 0.6,
                  label.y.value - label.font.size.value,
                  measurer.width(label.text, label.font).value + 1.2,
                  label.font.size.value + 1,
                  false,
                  false,
                ),
                label,
              ]
            : [label],
        ),
      ])
      for (const id of rowWorks) writer.addWork(id)
      writer.y += height + 4
    }
  }
  if (!prepared.value.length) {
    writer.add([
      text(
        hasStatement
          ? 'У ПД нет границ на главных путях. Станционные работы — в ведомости.'
          : 'У ПД нет границ на главных путях.',
        15,
        writer.y + 4,
      ),
    ])
    writer.y += 12
  }
  for (const table of pd.tables) {
    const added = writer.table(table)
    if (!added.ok) return added
  }
  const saved = writer.flush()
  if (!saved.ok) return saved
  const stations: { id: string; page: number }[] = []
  for (const station of pd.stations) {
    stations.push({ id: station.id, page: writer.pages.length })
    const drawn = drawStationSheets(writer, data, pd, station, measurer)
    if (!drawn.ok) return drawn
    warnings.push(...drawn.value)
  }
  return ok({ pages: writer.pages, warnings, workIdsByPage: writer.workIdsByPage, stations })
}
