import {
  LAYOUT_COLUMNS_PER_ROW,
  STATION_LAYOUT_VERSION,
  type LayoutNode,
  type LayoutTrack,
  type StationLayout,
} from '@eow/passport/import-api'
import { clusterValues } from './scheme-geometry'
import { TRACK_SPACING_UNITS } from './scheme-graph'
import type { RecognizedScheme } from './recognize-scheme'

/** Monotone piecewise-linear map through knots; straight lines with the end slope outside. */
function piecewise(
  knots: readonly (readonly [number, number])[],
  slope: number,
): (v: number) => number {
  return (v) => {
    const first = knots[0],
      last = knots.at(-1)
    if (!first || !last) return v * slope
    if (v <= first[0]) return first[1] - (first[0] - v) * slope
    if (v >= last[0]) return last[1] + (v - last[0]) * slope
    for (let i = 1; i < knots.length; i++) {
      const [x0, y0] = knots[i - 1] ?? first,
        [x1, y1] = knots[i] ?? last
      if (v <= x1) return x1 === x0 ? y1 : y0 + ((v - x0) / (x1 - x0)) * (y1 - y0)
    }
    return last[1]
  }
}

/**
 * Topology on a grid: horizontal track levels become consecutive rows, so the order top to
 * bottom is kept and gaps are even; columns follow the sheet in half-spacing steps, keeping
 * the order left to right. Turnout legs get the standard slope where the bend is free to move.
 */
export function schemeToLayout(scheme: RecognizedScheme): StationLayout {
  const spacing = scheme.unit * TRACK_SPACING_UNITS
  const byId = new Map(scheme.nodes.map((n) => [n.id, n]))
  const neighbours = new Map<string, string[]>()
  for (const t of scheme.tracks)
    t.nodes.forEach((id, i) => {
      const list = neighbours.get(id) ?? []
      for (const other of [t.nodes[i - 1], t.nodes[i + 1]]) if (other) list.push(other)
      neighbours.set(id, list)
    })
  // A node is on a level when a horizontal line leaves it.
  const levelYs = scheme.nodes
    .filter((n) =>
      (neighbours.get(n.id) ?? []).some((o) => {
        const q = byId.get(o)?.at
        return (
          q && Math.abs(q.y - n.at.y) < spacing * 0.08 && Math.abs(q.x - n.at.x) > spacing * 0.3
        )
      }),
    )
    .map((n) => n.at.y)
  const levels = clusterValues(levelYs, spacing * 0.3)
  const toRow = piecewise(
    levels.map((y, i) => [y, i] as const),
    1 / spacing,
  )
  const colUnit = spacing / LAYOUT_COLUMNS_PER_ROW
  const xs = clusterValues(
    scheme.nodes.map((n) => n.at.x),
    scheme.unit * 4,
  )
  const knotsX: [number, number][] = []
  for (const x of xs) {
    const prev = knotsX.at(-1)
    const want = Math.round(x / colUnit)
    knotsX.push([x, prev ? Math.max(want, prev[1] + 1) : want])
  }
  const toCol = piecewise(knotsX, 1 / colUnit)
  const raw = scheme.nodes.map((n) => ({
    n,
    col: Math.round(toCol(n.at.x)),
    row: Math.round(toRow(n.at.y)),
  }))
  const minCol = Math.min(...raw.map((r) => r.col)),
    minRow = Math.min(...raw.map((r) => r.row))
  const place = new Map(raw.map((r) => [r.n.id, { col: r.col - minCol, row: r.row - minRow }]))
  straightenLegs(scheme, place)
  const nodes: LayoutNode[] = scheme.nodes.map((n) => {
    const p = place.get(n.id) ?? { col: 0, row: 0 }
    return n.end ? { id: n.id, ...p, kind: n.kind, end: n.end } : { id: n.id, ...p, kind: n.kind }
  })
  const colOf = (x: number): number => Math.round(toCol(x)) - minCol
  const rowOf = (y: number): number => Math.round(toRow(y)) - minRow
  const tracks: LayoutTrack[] = scheme.tracks.map((t) => ({
    id: t.id,
    number: t.number,
    kind: t.kind,
    state: t.state,
    nodes: orderByColumn(t.nodes, place),
    fullLength: t.fullLength,
    capacity: t.capacity,
  }))
  const layout: StationLayout = {
    version: STATION_LAYOUT_VERSION,
    nodes,
    tracks,
    switches: scheme.switches.map((s) => ({ ...s })),
    derailers: [],
    bridges: [],
    crossings: [],
  }
  const clamp = (track: string, col: number): number => {
    const cols = (tracks.find((t) => t.id === track)?.nodes ?? []).map(
      (id) => place.get(id)?.col ?? 0,
    )
    return cols.length ? Math.min(Math.max(...cols), Math.max(Math.min(...cols), col)) : col
  }
  return {
    ...layout,
    derailers: scheme.derailers
      .filter((d) => d.track)
      .map((d) => ({
        id: d.id,
        number: d.number,
        track: d.track,
        col: clamp(d.track, colOf(d.at.x)),
      })),
    bridges: scheme.bridges.flatMap((b) =>
      b.track
        ? [
            {
              id: b.id,
              label: b.label,
              track: b.track,
              fromCol: clamp(b.track, colOf(Math.min(b.from.x, b.to.x))),
              toCol: clamp(b.track, colOf(Math.max(b.from.x, b.to.x))),
            },
          ]
        : [],
    ),
    crossings: scheme.crossings.map((c) => {
      const rows = [rowOf(c.from.y), rowOf(c.to.y)].sort((a, b) => a - b)
      return {
        id: c.id,
        label: c.label,
        km: c.km,
        pk: c.pk,
        col: Math.max(0, colOf((c.from.x + c.to.x) / 2)),
        fromRow: Math.max(0, rows[0] ?? 0),
        toRow: Math.max(0, rows[1] ?? 0),
      }
    }),
  }
}

function orderByColumn(
  ids: readonly string[],
  place: ReadonlyMap<string, { col: number; row: number }>,
): string[] {
  const first = place.get(ids[0] ?? ''),
    last = place.get(ids.at(-1) ?? '')
  if (!first || !last) return [...ids]
  return last.col < first.col || (last.col === first.col && last.row < first.row)
    ? [...ids].reverse()
    : [...ids]
}

/**
 * A turnout leg goes from a switch to a bend one row away. The bend moves along its own
 * level so the leg spans exactly two columns per row, if that keeps the order on the track.
 */
function straightenLegs(
  scheme: RecognizedScheme,
  place: Map<string, { col: number; row: number }>,
): void {
  const kinds = new Map(scheme.nodes.map((n) => [n.id, n.kind]))
  const taken = new Set([...place.values()].map((p) => `${p.col}:${p.row}`))
  for (const t of scheme.tracks)
    t.nodes.forEach((id, i) => {
      if (kinds.get(id) !== 'bend') return
      const p = place.get(id)
      if (!p) return
      for (const [sw, other] of [
        [t.nodes[i - 1], t.nodes[i + 1]],
        [t.nodes[i + 1], t.nodes[i - 1]],
      ] as const) {
        const s = sw ? place.get(sw) : undefined
        const o = other ? place.get(other) : undefined
        if (!sw || kinds.get(sw) !== 'switch' || !s || s.row === p.row) continue
        const side = Math.sign(p.col - s.col) || 1
        const col = s.col + side * LAYOUT_COLUMNS_PER_ROW * Math.abs(p.row - s.row)
        const keepsOrder = !o || Math.sign(o.col - col) === side || o.row !== p.row
        if (col === p.col || col < 0 || !keepsOrder || taken.has(`${col}:${p.row}`)) continue
        taken.delete(`${p.col}:${p.row}`)
        taken.add(`${col}:${p.row}`)
        place.set(id, { col, row: p.row })
        return
      }
    })
}
