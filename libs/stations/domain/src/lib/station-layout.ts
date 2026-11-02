import {
  err,
  ok,
  type Cell,
  type LayoutTrack,
  type LayoutTrackKind,
  type Result,
  type StationLayout,
} from '@eow/shared/kernel'

/** Формат раскладки — общий с паспортом и планом (ядро); здесь правила правки. */
export type {
  Cell,
  LayoutNodeKind,
  LayoutTrackKind,
  LayoutTrackState,
  LayoutNode,
  LayoutTrack,
  LayoutSwitch,
  LayoutDerailer,
  LayoutBridge,
  LayoutCrossing,
  StationLayout,
} from '@eow/shared/kernel'

export interface LayoutError {
  readonly message: string
}

const MAX_CELL = 100_000
const MAX_NUMBER = 20

const fail = (message: string): Result<never, LayoutError> => err({ message })

/** Колонки пути от самой левой до самой правой вершины. */
export function trackSpan(
  layout: StationLayout,
  track: LayoutTrack,
): { readonly from: number; readonly to: number } | undefined {
  const cols = track.nodes.flatMap((id) => layout.nodes.find((n) => n.id === id)?.col ?? [])
  return cols.length ? { from: Math.min(...cols), to: Math.max(...cols) } : undefined
}

/**
 * Нарушения правил раскладки. К правилам формата паспорта добавляется порядок: узлы пути
 * идут слева направо, без двух узлов в одной клетке.
 */
export function layoutProblems(layout: StationLayout): string[] {
  const problems: string[] = []
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]))
  const tracks = new Map(layout.tracks.map((t) => [t.id, t]))
  const cells = new Set<string>()
  for (const n of layout.nodes) {
    const key = `${n.col}:${n.row}`
    if (cells.has(key)) problems.push(`Два узла в одной клетке (${n.col}; ${n.row}).`)
    cells.add(key)
  }
  for (const t of layout.tracks) {
    const name = t.number ?? 'без номера'
    const points = t.nodes.map((id) => nodes.get(id))
    if (points.length < 2 || points.some((p) => !p))
      problems.push(`Путь ${name}: неизвестные узлы.`)
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i]
      if (a && b && b.col < a.col) problems.push(`Путь ${name} идёт справа налево.`)
    }
  }
  for (const s of layout.switches) {
    const parent = tracks.get(s.track),
      branch = tracks.get(s.branch)
    if (!parent?.nodes.includes(s.node))
      problems.push(`Стрелка ${s.number ?? '?'} не лежит на своём пути.`)
    if (!branch || (branch.nodes[0] !== s.node && branch.nodes.at(-1) !== s.node))
      problems.push(`Ветвь стрелки ${s.number ?? '?'} не начинается в её узле.`)
  }
  const onTrack = (track: string, col: number): boolean => {
    const t = tracks.get(track)
    const span = t && trackSpan(layout, t)
    return !!span && col >= span.from && col <= span.to
  }
  for (const d of layout.derailers)
    if (!onTrack(d.track, d.col)) problems.push(`Остряк ${d.number} оказался вне своего пути.`)
  for (const b of layout.bridges)
    if (!onTrack(b.track, b.fromCol) || !onTrack(b.track, b.toCol))
      problems.push(`Мост ${b.label ?? ''} оказался вне своего пути.`.replace('  ', ' '))
  return problems
}

/**
 * Перенос узла в клетку. Стрелка сдвигается только вдоль своего ряда, чтобы путь прямого
 * направления не изгибался; правка, нарушающая правила раскладки, отклоняется целиком.
 */
export function moveNode(
  layout: StationLayout,
  nodeId: string,
  to: Cell,
): Result<StationLayout, LayoutError> {
  const node = layout.nodes.find((n) => n.id === nodeId)
  if (!node) return fail('Узел не найден.')
  if (node.col === to.col && node.row === to.row) return ok(layout)
  if (
    !Number.isInteger(to.col) ||
    !Number.isInteger(to.row) ||
    to.col < 0 ||
    to.row < 0 ||
    to.col > MAX_CELL ||
    to.row > MAX_CELL
  )
    return fail('Узел должен остаться в пределах сетки.')
  if (node.kind === 'switch' && to.row !== node.row)
    return fail('Стрелка сдвигается только вдоль своего пути.')
  if (layout.nodes.some((n) => n.id !== nodeId && n.col === to.col && n.row === to.row))
    return fail('Клетка занята другим узлом.')
  const next: StationLayout = {
    ...layout,
    nodes: layout.nodes.map((n) => (n.id === nodeId ? { ...n, col: to.col, row: to.row } : n)),
  }
  const problems = layoutProblems(next)
  const first = problems[0]
  return first ? fail(first) : ok(next)
}

function cleanNumber(value: string | null): Result<string | null, LayoutError> {
  if (value === null) return ok(null)
  const trimmed = value.trim()
  if (!trimmed) return ok(null)
  if (trimmed.length > MAX_NUMBER) return fail(`Номер длиннее ${MAX_NUMBER} знаков.`)
  return ok(trimmed)
}

/** Новый номер пути; пустой — путь без номера. Номера путей станции не повторяются. */
export function renumberTrack(
  layout: StationLayout,
  trackId: string,
  number: string | null,
): Result<StationLayout, LayoutError> {
  const track = layout.tracks.find((t) => t.id === trackId)
  if (!track) return fail('Путь не найден.')
  const clean = cleanNumber(number)
  if (!clean.ok) return clean
  const value = clean.value
  if (value === track.number) return ok(layout)
  if (value !== null && layout.tracks.some((t) => t.id !== trackId && t.number === value))
    return fail(`Путь ${value} уже есть на схеме.`)
  if (track.kind === 'connector' && value !== null) return fail('Съезд не получает номер пути.')
  return ok({
    ...layout,
    tracks: layout.tracks.map((t) =>
      t.id !== trackId ? t : { ...t, number: value, kind: numberedKind(t.kind, value) },
    ),
  })
}

/** Станционный путь без номера становится путём без номера, и наоборот. */
function numberedKind(kind: LayoutTrackKind, number: string | null): LayoutTrackKind {
  if (number === null && kind === 'station') return 'siding'
  if (number !== null && kind === 'siding') return 'station'
  return kind
}

/** Новый номер стрелки; пустой — стрелка без номера. */
export function renumberSwitch(
  layout: StationLayout,
  switchId: string,
  number: string | null,
): Result<StationLayout, LayoutError> {
  const target = layout.switches.find((s) => s.id === switchId)
  if (!target) return fail('Стрелка не найдена.')
  const clean = cleanNumber(number)
  if (!clean.ok) return clean
  if (clean.value === target.number) return ok(layout)
  return ok({
    ...layout,
    switches: layout.switches.map((s) => (s.id === switchId ? { ...s, number: clean.value } : s)),
  })
}
