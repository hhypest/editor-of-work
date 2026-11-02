import type {
  Cell,
  LayoutNodeKind,
  LayoutTrackKind,
  LayoutTrackState,
  StationLayout,
} from '@eow/stations/domain'

/** Размеры рисунка схемы в пикселях экрана: колонка — половина междупутья. */
export const DRAWING_GRID = { col: 16, row: 32, margin: 40 } as const

export interface DrawingPoint {
  readonly x: number
  readonly y: number
}

export interface DrawnTrack {
  readonly id: string
  readonly points: readonly DrawingPoint[]
  readonly kind: LayoutTrackKind
  readonly state: LayoutTrackState
  /** Подпись над самым длинным горизонтальным отрезком: номер и длина со схемы. */
  readonly label: { readonly at: DrawingPoint; readonly text: string } | null
}

export interface DrawnNode extends DrawingPoint {
  readonly id: string
  readonly kind: LayoutNodeKind
  readonly end: 'stop' | 'open' | null
  /** Номер стрелки у её узла. */
  readonly label: string | null
}

export interface LayoutDrawing {
  readonly width: number
  readonly height: number
  readonly tracks: readonly DrawnTrack[]
  readonly nodes: readonly DrawnNode[]
  readonly derailers: readonly (DrawingPoint & { readonly id: string; readonly label: string })[]
  readonly bridges: readonly {
    readonly id: string
    readonly from: DrawingPoint
    readonly to: DrawingPoint
    readonly label: string | null
  }[]
  readonly crossings: readonly {
    readonly id: string
    readonly x: number
    readonly top: number
    readonly bottom: number
    readonly label: string
  }[]
}

export const cellPoint = (c: Cell): DrawingPoint => ({
  x: DRAWING_GRID.margin + c.col * DRAWING_GRID.col,
  y: DRAWING_GRID.margin + c.row * DRAWING_GRID.row,
})

/** Ближайшая клетка сетки к точке рисунка: привязка перетаскивания. */
export function cellAt(p: DrawingPoint): Cell {
  return {
    col: Math.max(0, Math.round((p.x - DRAWING_GRID.margin) / DRAWING_GRID.col)),
    row: Math.max(0, Math.round((p.y - DRAWING_GRID.margin) / DRAWING_GRID.row)),
  }
}

/** Точка ломаной на заданной колонке: остряк и мост лежат на линии своего пути. */
function pointAtCol(points: readonly DrawingPoint[], x: number): DrawingPoint | undefined {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (!a || !b || x < Math.min(a.x, b.x) || x > Math.max(a.x, b.x)) continue
    const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x)
    return { x, y: a.y + (b.y - a.y) * t }
  }
  return undefined
}

function trackLabel(points: readonly DrawingPoint[], text: string): DrawnTrack['label'] {
  let best: { a: DrawingPoint; b: DrawingPoint } | undefined
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i]
    if (a && b && (!best || Math.abs(b.x - a.x) > Math.abs(best.b.x - best.a.x))) best = { a, b }
  }
  if (!best || !text) return null
  return { at: { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 - 6 }, text }
}

export function layoutDrawing(layout: StationLayout): LayoutDrawing {
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]))
  const switchNumbers = new Map(layout.switches.map((s) => [s.node, s.number]))
  const tracks: DrawnTrack[] = layout.tracks.map((t) => {
    const points = t.nodes.flatMap((id) => {
      const n = nodes.get(id)
      return n ? [cellPoint(n)] : []
    })
    const parts = [t.number, t.fullLength === null ? null : `${t.fullLength} м`].filter(Boolean)
    return {
      id: t.id,
      points,
      kind: t.kind,
      state: t.state,
      label: trackLabel(points, parts.join(' · ')),
    }
  })
  const byTrack = new Map(tracks.map((t) => [t.id, t.points]))
  const onTrack = (track: string, col: number): DrawingPoint | undefined => {
    const x = cellPoint({ col, row: 0 }).x
    return pointAtCol(byTrack.get(track) ?? [], x)
  }
  const maxCol = Math.max(
    0,
    ...layout.nodes.map((n) => n.col),
    ...layout.crossings.map((c) => c.col),
  )
  const maxRow = Math.max(
    0,
    ...layout.nodes.map((n) => n.row),
    ...layout.crossings.map((c) => c.toRow),
  )
  const far = cellPoint({ col: maxCol, row: maxRow })
  return {
    width: far.x + DRAWING_GRID.margin,
    height: far.y + DRAWING_GRID.margin,
    tracks,
    nodes: layout.nodes.map((n) => ({
      id: n.id,
      ...cellPoint(n),
      kind: n.kind,
      end: n.end ?? null,
      label: n.kind === 'switch' ? (switchNumbers.get(n.id) ?? '?') : null,
    })),
    derailers: layout.derailers.flatMap((d) => {
      const p = onTrack(d.track, d.col)
      return p ? [{ id: d.id, ...p, label: d.number }] : []
    }),
    bridges: layout.bridges.flatMap((b) => {
      const from = onTrack(b.track, b.fromCol),
        to = onTrack(b.track, b.toCol)
      return from && to ? [{ id: b.id, from, to, label: b.label }] : []
    }),
    crossings: layout.crossings.map((c) => {
      const top = cellPoint({ col: c.col, row: c.fromRow }),
        bottom = cellPoint({ col: c.col, row: c.toRow })
      return {
        id: c.id,
        x: top.x,
        top: top.y - DRAWING_GRID.row / 2,
        bottom: bottom.y + DRAWING_GRID.row / 2,
        label: c.label,
      }
    }),
  }
}
