import {
  chainage,
  compareChainage,
  describeChainageError,
  distance,
  err,
  formatPlus,
  KmLengths,
  offset,
  ok,
  type Chainage,
  type Result,
} from '@eow/shared/kernel'
import {
  mm,
  type OverviewDocument,
  type OverviewLine,
  type OverviewScale,
  type OverviewSource,
  type SheetError,
  type SheetPage,
  type SheetPrimitive,
  type TextMeasurer,
} from './sheet-model'
import { bold, narrow, regular, textBlock } from './sheet-text'

const LEFT = 15,
  RIGHT = 405,
  TRACK_X = 35,
  TRACK_WIDTH = 350
const TOP = 42,
  ROW_HEIGHT = 43,
  BOTTOM = 231
const MAX_PAGES = 200,
  MAX_RANGE_KM = 100000
const line = (x1: number, y1: number, x2: number, y2: number, dashed = false): SheetPrimitive => ({
  kind: 'line',
  x1: mm(x1),
  y1: mm(y1),
  x2: mm(x2),
  y2: mm(y2),
  dashed,
})
const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  shade = false,
  border = true,
): SheetPrimitive => ({
  kind: 'rect',
  x: mm(x),
  y: mm(y),
  width: mm(width),
  height: mm(height),
  shade,
  border,
})
const text = (value: string, x: number, y: number, font = regular()): SheetPrimitive => ({
  kind: 'text',
  text: value,
  x: mm(x),
  y: mm(y),
  font,
})
interface Row {
  readonly line: OverviewLine
  readonly from: Chainage
  readonly to: Chainage
  readonly lengths: KmLengths
}
interface Summary {
  readonly name: string
  readonly length: number
  readonly axes: number
}

function prepareRows(
  source: OverviewSource,
  scale: OverviewScale,
): Result<{ rows: Row[]; summary: Summary[] }, SheetError> {
  const rows: Row[] = [],
    summary: Summary[] = []
  if (source.lines.length > 1000 || source.axes.length > 50000 || source.boundaries.length > 50000)
    return err({ message: 'Слишком много объектов для одного документа.' })
  const ids = new Set<string>()
  for (const current of source.lines) {
    if (ids.has(current.id)) return err({ message: 'Повторяется идентификатор направления.' })
    ids.add(current.id)
    const lengths = KmLengths.of(current.kmLengths)
    if (!lengths.ok) return err({ message: describeChainageError(lengths.error) })
    const extents = current.extents.toSorted((a, b) => compareChainage(a.from, b.from))
    let total = 0
    let previous: Chainage | undefined
    for (const span of extents) {
      const a = chainage(span.from.km, span.from.m, lengths.value),
        b = chainage(span.to.km, span.to.m, lengths.value)
      if (!a.ok) return err({ message: `${current.name}: ${describeChainageError(a.error)}` })
      if (!b.ok) return err({ message: `${current.name}: ${describeChainageError(b.error)}` })
      if (compareChainage(a.value, b.value) >= 0 || b.value.km - a.value.km > MAX_RANGE_KM)
        return err({ message: `${current.name}: недопустимый диапазон направления.` })
      if (previous && compareChainage(previous, a.value) > 0)
        return err({ message: `${current.name}: части протяжения перекрываются.` })
      previous = b.value
      let from = a.value
      const metersPerRow = Math.floor((TRACK_WIDTH * scale) / 1000)
      while (compareChainage(from, b.value) < 0) {
        if (rows.length >= MAX_PAGES * 4)
          return err({ message: 'Документ превышает 200 листов. Выберите меньший масштаб.' })
        const remaining = distance(from, b.value, lengths.value)
        const end = offset(from, Math.min(remaining, metersPerRow), lengths.value)
        if (!end.ok) return err({ message: describeChainageError(end.error) })
        rows.push({ line: current, from, to: end.value, lengths: lengths.value })
        total += Math.min(remaining, metersPerRow)
        from = end.value
      }
    }
    summary.push({
      name: current.name,
      length: total,
      axes: source.axes.filter(
        (a) =>
          a.lineId === current.id &&
          extents.some(
            (e) => compareChainage(e.from, a.at) <= 0 && compareChainage(a.at, e.to) <= 0,
          ),
      ).length,
    })
  }
  return ok({ rows, summary })
}

function drawRow(
  row: Row,
  source: OverviewSource,
  scale: OverviewScale,
  y: number,
  measurer: TextMeasurer,
): Result<readonly SheetPrimitive[], SheetError> {
  const primitives: SheetPrimitive[] = []
  const labels: SheetPrimitive[] = []
  const title = textBlock(
    `${row.line.name} · ${formatPlus(row.from)} – ${formatPlus(row.to)}`,
    LEFT,
    y,
    RIGHT - LEFT,
    1,
    bold(3),
    measurer,
  )
  if (!title.ok) return title
  primitives.push(...title.value)
  const x = (point: Chainage): number =>
    TRACK_X + (distance(row.from, point, row.lengths) * 1000) / scale
  const endX = x(row.to),
    baseline = y + 16
  primitives.push(
    line(TRACK_X, baseline, endX, baseline),
    line(TRACK_X, baseline - 1, TRACK_X, baseline + 1),
    line(endX, baseline - 1, endX, baseline + 1),
  )
  primitives.push(text(formatPlus(row.from), TRACK_X, y + 21, narrow(2.4)))
  const endLabel = formatPlus(row.to),
    endWidth = measurer.width(endLabel, narrow(2.4)).value
  if (endX - TRACK_X > endWidth + 20)
    primitives.push(text(endLabel, endX - endWidth, y + 21, narrow(2.4)))
  const boundaries = source.boundaries.filter(
    (b) =>
      b.lineId === row.line.id &&
      compareChainage(b.from, row.to) < 0 &&
      compareChainage(b.to, row.from) > 0,
  )
  const spans: { from: number; to: number }[] = []
  const pdLabels: { from: number; to: number }[][] = [[], []]
  for (const b of boundaries) {
    const from = chainage(b.from.km, b.from.m, row.lengths),
      to = chainage(b.to.km, b.to.m, row.lengths)
    if (!from.ok || !to.ok || compareChainage(b.from, b.to) >= 0)
      return err({ message: `${b.code}: недопустимая граница ПД.` })
    const left = x(compareChainage(b.from, row.from) < 0 ? row.from : b.from)
    const right = x(compareChainage(b.to, row.to) > 0 ? row.to : b.to)
    if (spans.some((s) => s.from < right && left < s.to))
      return err({ message: `${row.line.name}: границы ПД перекрываются; проверьте оргструктуру.` })
    spans.push({ from: left, to: right })
    const width = measurer.width(b.code, narrow(2.6)).value
    const labelLeft = Math.max(TRACK_X, Math.min((left + right - width) / 2, RIGHT - width))
    const lane = pdLabels.findIndex((occupied) =>
      occupied.every((p) => p.to + 2 <= labelLeft || labelLeft + width + 2 <= p.from),
    )
    if (lane < 0 || width > TRACK_WIDTH)
      return err({ message: 'Подписи ПД не помещаются. Выберите более крупный масштаб.' })
    pdLabels[lane]?.push({ from: labelLeft, to: labelLeft + width })
    const labelY = y + 6 + lane * 4
    primitives.push(
      line(left, y + 12, right, y + 12, true),
      line(left, y + 11, left, baseline),
      line(right, y + 11, right, baseline),
      line((left + right) / 2, y + 12, labelLeft + width / 2, labelY + 1),
    )
    labels.push(
      rect(labelLeft - 0.6, labelY - 2.6, width + 1.2, 3.4, false, false),
      text(b.code, labelLeft, labelY, narrow(2.6)),
    )
  }
  const lanes: { from: number; to: number }[][] = [[], [], []]
  const axes = source.axes.filter(
    (a) =>
      a.lineId === row.line.id &&
      compareChainage(a.at, row.from) >= 0 &&
      (compareChainage(a.at, row.to) < 0 ||
        (compareChainage(a.at, row.to) === 0 &&
          row.line.extents.some((e) => compareChainage(e.to, row.to) === 0) &&
          !row.line.extents.some((e) => compareChainage(e.from, row.to) === 0))),
  )
  for (const axis of axes.toSorted(
    (a, b) => compareChainage(a.at, b.at) || a.name.localeCompare(b.name),
  )) {
    const at = chainage(axis.at.km, axis.at.m, row.lengths)
    if (!at.ok) return err({ message: `${axis.name}: ${describeChainageError(at.error)}` })
    const label = `${axis.name} (${formatPlus(at.value)})`
    const font = narrow(2.5)
    const width = Math.min(70, Math.max(25, measurer.width(label, font).value))
    const left = Math.max(TRACK_X, Math.min(x(at.value) - width / 2, RIGHT - width))
    const lane = lanes.findIndex((occupied) =>
      occupied.every((p) => p.to + 2 <= left || left + width + 2 <= p.from),
    )
    if (lane < 0)
      return err({
        message: `${row.line.name}: подписи осей не помещаются. Выберите более крупный масштаб.`,
      })
    lanes[lane]?.push({ from: left, to: left + width })
    const labelY = y + 26 + lane * 6
    const wrapped = textBlock(label, left, labelY, width, 1, font, measurer)
    if (!wrapped.ok) return wrapped
    primitives.push(
      { kind: 'circle', x: mm(x(at.value)), y: mm(baseline), radius: mm(0.9) },
      line(x(at.value), baseline + 1, x(at.value), labelY - 2),
      line(x(at.value), labelY - 2, left, labelY - 2),
    )
    labels.push(
      rect(left - 0.6, labelY - font.size.value, width + 1.2, 3.4, false, false),
      ...wrapped.value,
    )
  }
  return ok([...primitives, ...labels])
}

/** Геометрия А3 в миллиметрах. Данные из разных частей протяжения не соединяются через разрыв. */
export function buildOverview(
  source: OverviewSource,
  scale: OverviewScale,
  measurer: TextMeasurer,
): Result<OverviewDocument, SheetError> {
  if (![25000, 50000, 100000].includes(scale))
    return err({ message: 'Выберите поддерживаемый масштаб.' })
  const prepared = prepareRows(source, scale)
  if (!prepared.ok) return prepared
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
  const pages: SheetPage[] = []
  let primitives: SheetPrimitive[] = [],
    y = TOP
  const page = (): Result<null, SheetError> => {
    if (pages.length >= MAX_PAGES) return err({ message: 'Документ превышает 200 листов.' })
    const header = textBlock(
      `Общая схема дистанции · ${source.edition.label}`,
      LEFT,
      19,
      RIGHT - LEFT,
      2,
      bold(4),
      measurer,
    )
    if (!header.ok) return header
    const footer = textBlock(
      `Редакция от ${source.edition.date} · Масштаб 1:${scale} · Лист ${pages.length + 1}`,
      LEFT,
      281,
      RIGHT - LEFT,
      1,
      regular(2.8),
      measurer,
    )
    if (!footer.ok) return footer
    const legend = [
      line(LEFT, 265, LEFT + 12, 265),
      text('Главный путь', LEFT + 15, 266),
      line(110, 265, 122, 265, true),
      text('Участок ПД', 125, 266),
      { kind: 'circle' as const, x: mm(225), y: mm(265), radius: mm(0.9) },
      text('Ось станции', 229, 266),
    ]
    const warning = warnings.length
      ? [
          text(
            `Замечаний: ${warnings.length}. Проверьте список в предпросмотре.`,
            LEFT,
            274,
            regular(2.6),
          ),
        ]
      : []
    pages.push({
      width: mm(420),
      height: mm(297),
      number: pages.length + 1,
      primitives: [
        rect(10, 10, 400, 277),
        ...header.value,
        ...primitives,
        ...legend,
        ...warning,
        ...footer.value,
      ],
    })
    primitives = []
    y = TOP
    return ok(null)
  }
  for (const row of prepared.value.rows) {
    if (y + ROW_HEIGHT > BOTTOM) {
      const saved = page()
      if (!saved.ok) return saved
    }
    const drawn = drawRow(row, source, scale, y, measurer)
    if (!drawn.ok) return drawn
    primitives.push(...drawn.value)
    y += ROW_HEIGHT
  }
  const tableRow = (
    name: string,
    meters: string,
    axes: string,
    heading = false,
  ): Result<null, SheetError> => {
    const nameText = textBlock(
      name,
      LEFT + 2,
      y + 5,
      280,
      1,
      heading ? bold(2.8) : regular(2.8),
      measurer,
    )
    if (!nameText.ok) return nameText
    primitives.push(
      rect(LEFT, y, RIGHT - LEFT, 8, heading),
      line(300, y, 300, y + 8),
      line(360, y, 360, y + 8),
      ...nameText.value,
      text(meters, 303, y + 5),
      text(axes, 363, y + 5),
    )
    y += 8
    return ok(null)
  }
  const tableHeader = (): Result<null, SheetError> => {
    primitives.push(text('Сводка по направлениям', LEFT, y + 3, bold(3.2)))
    y += 7
    return tableRow('Направление', 'Длина, м', 'Осей', true)
  }
  if (y + 23 > BOTTOM) {
    const saved = page()
    if (!saved.ok) return saved
  }
  let result = tableHeader()
  if (!result.ok) return result
  for (const summary of prepared.value.summary) {
    if (y + 8 > BOTTOM) {
      const saved = page()
      if (!saved.ok) return saved
      result = tableHeader()
      if (!result.ok) return result
    }
    result = tableRow(summary.name, String(summary.length), String(summary.axes))
    if (!result.ok) return result
  }
  if (!source.lines.length)
    primitives.push(text('Нет направлений. Загрузите оргструктуру паспорта.', LEFT, y + 10))
  const saved = page()
  if (!saved.ok) return saved
  return ok({ pages, warnings })
}
