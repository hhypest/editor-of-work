/**
 * Раскладка путевого развития станции в таблице `station_layout` (JSON, версия 1).
 * Координаты — целые клетки сетки: ряд — междупутье, колонка — половина междупутья.
 * Пути и съезды — ломаные по узлам; стрелка — узел на пути, от которого отходит ветвь.
 * Остряки, мосты и переезды привязаны к колонкам, поэтому всегда лежат на своих путях.
 */
export const STATION_LAYOUT_VERSION = 1
/** Колонок в одном междупутье: наклон съезда 1 : 2 выглядит как обычный стрелочный угол. */
export const LAYOUT_COLUMNS_PER_ROW = 2

export type LayoutNodeKind = 'switch' | 'end' | 'bend' | 'crossing'
export type LayoutTrackKind = 'main' | 'station' | 'connector' | 'siding'
export type LayoutTrackState = 'normal' | 'closed' | 'conserved'

export interface LayoutNode {
  readonly id: string
  readonly col: number
  readonly row: number
  readonly kind: LayoutNodeKind
  /** У конца пути: упор или выход за пределы схемы. */
  readonly end?: 'stop' | 'open' | undefined
}

export interface LayoutTrack {
  readonly id: string
  /** Номер как на схеме; null — съезд или путь без номера. */
  readonly number: string | null
  readonly kind: LayoutTrackKind
  readonly state: LayoutTrackState
  /** Узлы слева направо. */
  readonly nodes: readonly string[]
  /** Полная длина и вместимость — подписи схемы, а не экспликация. */
  readonly fullLength: number | null
  readonly capacity: string | null
}

export interface LayoutSwitch {
  readonly id: string
  readonly number: string | null
  readonly node: string
  /** Путь, по которому проходит прямое направление: на нём лежит стрелка. */
  readonly track: string
  /** Путь или съезд, который начинается или заканчивается в узле стрелки. */
  readonly branch: string
}

export interface LayoutDerailer {
  readonly id: string
  readonly number: string
  readonly track: string
  readonly col: number
}

export interface LayoutBridge {
  readonly id: string
  readonly label: string | null
  readonly track: string
  readonly fromCol: number
  readonly toCol: number
}

export interface LayoutCrossing {
  readonly id: string
  /** Подпись схемы: «переезд 51км». */
  readonly label: string
  readonly km: number | null
  readonly pk: number | null
  readonly col: number
  readonly fromRow: number
  readonly toRow: number
}

export interface StationLayout {
  readonly version: typeof STATION_LAYOUT_VERSION
  readonly nodes: readonly LayoutNode[]
  readonly tracks: readonly LayoutTrack[]
  readonly switches: readonly LayoutSwitch[]
  readonly derailers: readonly LayoutDerailer[]
  readonly bridges: readonly LayoutBridge[]
  readonly crossings: readonly LayoutCrossing[]
}

/** Колонки, которые занимает путь: от самой левой до самой правой вершины. */
export function trackColumns(
  layout: StationLayout,
  track: LayoutTrack,
): { readonly from: number; readonly to: number } | undefined {
  const cols = track.nodes.flatMap((id) => layout.nodes.find((n) => n.id === id)?.col ?? [])
  return cols.length ? { from: Math.min(...cols), to: Math.max(...cols) } : undefined
}

/** Нарушения правил раскладки; пустой список — раскладку можно записать. */
export function checkStationLayout(layout: StationLayout): string[] {
  const errors: string[] = []
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]))
  const tracks = new Map(layout.tracks.map((t) => [t.id, t]))
  const ids = [
    ...layout.nodes,
    ...layout.tracks,
    ...layout.switches,
    ...layout.derailers,
    ...layout.bridges,
    ...layout.crossings,
  ].map((x) => x.id)
  if (new Set(ids).size !== ids.length) errors.push('Идентификаторы элементов повторяются.')
  for (const n of layout.nodes)
    if (!Number.isInteger(n.col) || !Number.isInteger(n.row) || n.col < 0 || n.row < 0)
      errors.push(`Узел ${n.id} не в клетке сетки.`)
  for (const t of layout.tracks) {
    if (t.nodes.length < 2) errors.push(`У пути ${t.id} меньше двух узлов.`)
    t.nodes.forEach((id, i) => {
      if (!nodes.has(id)) errors.push(`Путь ${t.id} ссылается на неизвестный узел ${id}.`)
      if (i > 0 && t.nodes[i - 1] === id) errors.push(`Путь ${t.id} повторяет узел ${id}.`)
    })
  }
  for (const s of layout.switches) {
    const parent = tracks.get(s.track),
      branch = tracks.get(s.branch)
    if (nodes.get(s.node)?.kind !== 'switch') errors.push(`Стрелка ${s.id}: узел не стрелочный.`)
    if (!parent?.nodes.includes(s.node))
      errors.push(`Стрелка ${s.number ?? s.id} не лежит на своём пути.`)
    if (
      !branch ||
      s.track === s.branch ||
      (branch.nodes[0] !== s.node && branch.nodes.at(-1) !== s.node)
    )
      errors.push(`Ветвь стрелки ${s.number ?? s.id} не начинается в её узле.`)
  }
  const onTrack = (track: string, col: number): boolean => {
    const t = tracks.get(track)
    const span = t && trackColumns(layout, t)
    return !!span && col >= span.from && col <= span.to
  }
  for (const d of layout.derailers)
    if (!onTrack(d.track, d.col)) errors.push(`Остряк ${d.number} не лежит на пути.`)
  for (const b of layout.bridges)
    if (b.fromCol > b.toCol || !onTrack(b.track, b.fromCol) || !onTrack(b.track, b.toCol))
      errors.push(`Мост ${b.label ?? b.id} не лежит на пути.`)
  for (const c of layout.crossings)
    if (c.fromRow > c.toRow || c.col < 0) errors.push(`Переезд ${c.label}: неверная ось.`)
  return errors
}
