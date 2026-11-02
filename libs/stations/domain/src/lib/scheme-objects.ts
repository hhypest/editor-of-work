import {
  err,
  LAYOUT_OBJECT_LIMITS,
  ok,
  type Cell,
  type LayoutCrossing,
  type LayoutObject,
  type LayoutObjectKind,
  type Result,
  type StationLayout,
} from '@eow/shared/kernel'
import type { LayoutError } from './station-layout'

/**
 * Здания, платформы и переезды на схеме станции (ADR-0049). Объект — прямоугольник на
 * сетке раскладки, переезд — вертикальная ось через ряды путей. Правка, нарушающая
 * пределы, отклоняется целиком с причиной.
 */
const MAX_CELL = 100_000
const MAX_OBJECTS = 1_000
const fail = (message: string): Result<never, LayoutError> => err({ message })

export const OBJECT_TITLES: Readonly<Record<LayoutObjectKind, string>> = {
  building: 'Здание',
  platform: 'Платформа',
}

const objectsOf = (layout: StationLayout): readonly LayoutObject[] => layout.objects ?? []

/** Новый идентификатор с префиксом, которого ещё нет среди элементов раскладки. */
function nextId(layout: StationLayout, prefix: string): string {
  const used = new Set(
    [
      ...layout.nodes,
      ...layout.tracks,
      ...layout.switches,
      ...layout.derailers,
      ...layout.bridges,
      ...layout.crossings,
      ...objectsOf(layout),
    ].map((x) => x.id),
  )
  for (let n = 1; ; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`
}

/** Колонки и ряды, занятые путями и переездами: новые объекты ставятся под ними. */
function extent(layout: StationLayout): { minCol: number; maxCol: number; maxRow: number } {
  const cols = [...layout.nodes.map((n) => n.col), ...layout.crossings.map((c) => c.col)]
  const rows = [
    ...layout.nodes.map((n) => n.row),
    ...layout.crossings.map((c) => c.toRow),
    ...objectsOf(layout).map((o) => o.row + o.height - 1),
  ]
  return {
    minCol: cols.length ? Math.min(...cols) : 0,
    maxCol: cols.length ? Math.max(...cols) : 0,
    maxRow: rows.length ? Math.max(...rows) : -1,
  }
}

const inGrid = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= MAX_CELL

/** Нарушения правил объектов и переездов; пустой список — раскладку можно записать. */
export function objectProblems(layout: StationLayout): string[] {
  const problems: string[] = []
  const objects = objectsOf(layout)
  if (objects.length > MAX_OBJECTS) problems.push('На схеме больше 1000 объектов.')
  for (const o of objects) {
    const name = o.label || OBJECT_TITLES[o.kind]
    if (!inGrid(o.col) || !inGrid(o.row)) problems.push(`${name}: вне сетки.`)
    if (
      !Number.isInteger(o.width) ||
      !Number.isInteger(o.height) ||
      o.width < 1 ||
      o.height < 1 ||
      o.width > LAYOUT_OBJECT_LIMITS.width ||
      o.height > LAYOUT_OBJECT_LIMITS.height
    )
      problems.push(
        `${name}: ширина — от 1 до ${LAYOUT_OBJECT_LIMITS.width} колонок, высота — от 1 до ${LAYOUT_OBJECT_LIMITS.height} рядов.`,
      )
    if (o.label.length > LAYOUT_OBJECT_LIMITS.label)
      problems.push(`${name}: подпись длиннее ${LAYOUT_OBJECT_LIMITS.label} знаков.`)
  }
  for (const c of layout.crossings) {
    if (!inGrid(c.col) || !inGrid(c.fromRow) || !inGrid(c.toRow) || c.fromRow > c.toRow)
      problems.push(`Переезд ${c.label}: неверная ось.`)
    if (!c.label.trim()) problems.push('У переезда нет подписи.')
    if (c.label.length > LAYOUT_OBJECT_LIMITS.label)
      problems.push(`Переезд: подпись длиннее ${LAYOUT_OBJECT_LIMITS.label} знаков.`)
    if (c.km !== null && (!Number.isInteger(c.km) || c.km < 0))
      problems.push(`Переезд ${c.label}: километр — целое неотрицательное число.`)
    if (c.pk !== null && (!Number.isInteger(c.pk) || c.pk < 1 || c.pk > 10))
      problems.push(`Переезд ${c.label}: пикет — от 1 до 10.`)
  }
  return problems
}

function checked(next: StationLayout): Result<StationLayout, LayoutError> {
  const first = objectProblems(next)[0]
  return first ? fail(first) : ok(next)
}

/** Новый объект под схемой, у левого края путей: оттуда его перетаскивают на место. */
export function addObject(
  layout: StationLayout,
  kind: LayoutObjectKind,
): Result<StationLayout, LayoutError> {
  const { minCol, maxRow } = extent(layout)
  const object: LayoutObject = {
    id: nextId(layout, kind),
    kind,
    label: '',
    col: minCol,
    row: maxRow + 1,
    width: kind === 'platform' ? 16 : 6,
    height: 1,
  }
  return checked({ ...layout, objects: [...objectsOf(layout), object] })
}

/** Перенос объекта: to — левая верхняя клетка. */
export function moveObject(
  layout: StationLayout,
  id: string,
  to: Cell,
): Result<StationLayout, LayoutError> {
  const object = objectsOf(layout).find((o) => o.id === id)
  if (!object) return fail('Объект не найден.')
  if (object.col === to.col && object.row === to.row) return ok(layout)
  if (!inGrid(to.col) || !inGrid(to.row)) return fail('Объект должен остаться в пределах сетки.')
  return checked({
    ...layout,
    objects: objectsOf(layout).map((o) => (o.id === id ? { ...o, col: to.col, row: to.row } : o)),
  })
}

export interface ObjectChange {
  readonly kind?: LayoutObjectKind
  readonly label?: string
  readonly width?: number
  readonly height?: number
}

export function editObject(
  layout: StationLayout,
  id: string,
  change: ObjectChange,
): Result<StationLayout, LayoutError> {
  const object = objectsOf(layout).find((o) => o.id === id)
  if (!object) return fail('Объект не найден.')
  const next: LayoutObject = {
    ...object,
    ...(change.kind === undefined ? {} : { kind: change.kind }),
    ...(change.label === undefined ? {} : { label: change.label.trim() }),
    ...(change.width === undefined ? {} : { width: change.width }),
    ...(change.height === undefined ? {} : { height: change.height }),
  }
  if (
    next.kind === object.kind &&
    next.label === object.label &&
    next.width === object.width &&
    next.height === object.height
  )
    return ok(layout)
  return checked({
    ...layout,
    objects: objectsOf(layout).map((o) => (o.id === id ? next : o)),
  })
}

export function removeObject(
  layout: StationLayout,
  id: string,
): Result<StationLayout, LayoutError> {
  if (!objectsOf(layout).some((o) => o.id === id)) return fail('Объект не найден.')
  return ok({ ...layout, objects: objectsOf(layout).filter((o) => o.id !== id) })
}

/**
 * Новый переезд посередине схемы через все её ряды; если колонка занята переездом,
 * берётся ближайшая свободная справа.
 */
export function addCrossing(layout: StationLayout): Result<StationLayout, LayoutError> {
  const { minCol, maxCol } = extent(layout)
  const rows = layout.nodes.map((n) => n.row)
  const taken = new Set(layout.crossings.map((c) => c.col))
  let col = Math.round((minCol + maxCol) / 2)
  while (taken.has(col)) col++
  const crossing: LayoutCrossing = {
    id: nextId(layout, 'crossing'),
    label: 'переезд',
    km: null,
    pk: null,
    col,
    fromRow: rows.length ? Math.min(...rows) : 0,
    toRow: rows.length ? Math.max(...rows) : 0,
  }
  return checked({ ...layout, crossings: [...layout.crossings, crossing] })
}

/** Ось переезда сдвигается вдоль схемы: меняется только колонка. */
export function moveCrossing(
  layout: StationLayout,
  id: string,
  col: number,
): Result<StationLayout, LayoutError> {
  const crossing = layout.crossings.find((c) => c.id === id)
  if (!crossing) return fail('Переезд не найден.')
  if (crossing.col === col) return ok(layout)
  if (!inGrid(col)) return fail('Переезд должен остаться в пределах сетки.')
  return checked({
    ...layout,
    crossings: layout.crossings.map((c) => (c.id === id ? { ...c, col } : c)),
  })
}

export interface CrossingChange {
  readonly label?: string
  readonly km?: number | null
  readonly pk?: number | null
  readonly fromRow?: number
  readonly toRow?: number
}

export function editCrossing(
  layout: StationLayout,
  id: string,
  change: CrossingChange,
): Result<StationLayout, LayoutError> {
  const crossing = layout.crossings.find((c) => c.id === id)
  if (!crossing) return fail('Переезд не найден.')
  const next: LayoutCrossing = {
    ...crossing,
    ...(change.label === undefined ? {} : { label: change.label.trim() }),
    ...(change.km === undefined ? {} : { km: change.km }),
    ...(change.pk === undefined ? {} : { pk: change.pk }),
    ...(change.fromRow === undefined ? {} : { fromRow: change.fromRow }),
    ...(change.toRow === undefined ? {} : { toRow: change.toRow }),
  }
  if (JSON.stringify(next) === JSON.stringify(crossing)) return ok(layout)
  return checked({
    ...layout,
    crossings: layout.crossings.map((c) => (c.id === id ? next : c)),
  })
}

export function removeCrossing(
  layout: StationLayout,
  id: string,
): Result<StationLayout, LayoutError> {
  if (!layout.crossings.some((c) => c.id === id)) return fail('Переезд не найден.')
  return ok({ ...layout, crossings: layout.crossings.filter((c) => c.id !== id) })
}
