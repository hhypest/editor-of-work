import type { DrawingColor, SchemeDrawing } from './scheme-drawing'
import {
  along,
  at,
  clusterValues,
  dist,
  distToSegment,
  dot,
  length,
  mode,
  sinBetween,
  sub,
  unit,
  type Point,
  type Segment,
} from './scheme-geometry'

/**
 * Track lines of the scheme as a planar graph. ЕК АСУИ draws every track with the widest
 * line of the sheet: red main tracks, black station tracks, grey tracks closed for traffic.
 * Conservation is a black line with small crosses, closure adds small slashes.
 */
export type TrackStyle = 'main' | 'station' | 'closed'

export interface GraphNode {
  readonly id: number
  readonly at: Point
  readonly edges: number[]
}

export interface GraphEdge {
  readonly id: number
  readonly from: number
  readonly to: number
  readonly style: TrackStyle
  /** Hatch ticks counted along the edge: conservation crosses or closure slashes. */
  hatch: number
}

export interface TrackGraph {
  /** Scheme unit: the track spacing is 160 units in every ЕК АСУИ export seen so far. */
  readonly unit: number
  readonly trackWidth: number
  readonly nodes: GraphNode[]
  readonly edges: GraphEdge[]
}

export const TRACK_SPACING_UNITS = 160

function styleOf(c: DrawingColor): TrackStyle | undefined {
  const [r, g, b] = c
  if (r > 0.7 && g < 0.35 && b < 0.35) return 'main'
  if (r < 0.2 && g < 0.2 && b < 0.2) return 'station'
  if (Math.abs(r - g) < 0.1 && Math.abs(g - b) < 0.1 && r >= 0.2 && r <= 0.8) return 'closed'
  return undefined
}

interface RawSegment extends Segment {
  readonly style: TrackStyle
}

/** Widest stroked line: tracks. Thin decorations never reach it. */
export function trackWidth(drawing: SchemeDrawing): number | undefined {
  let width: number | undefined
  for (const p of drawing.paths)
    if (p.stroke && !p.fill && styleOf(p.stroke)) width = Math.max(width ?? 0, p.width)
  return width
}

function rawSegments(drawing: SchemeDrawing, width: number): RawSegment[] {
  const out: RawSegment[] = []
  for (const p of drawing.paths) {
    if (!p.stroke || p.fill || p.dash.length || Math.abs(p.width - width) > width * 0.1) continue
    const style = styleOf(p.stroke)
    if (!style) continue
    for (const sp of p.subpaths)
      for (let i = 1; i < sp.length; i++) {
        const a = sp[i - 1],
          b = sp[i]
        if (a && b && dist(a, b) > 1e-6) out.push({ a, b, style })
      }
  }
  return out
}

/** Track spacing from horizontal track levels; the most frequent gap wins. */
function spacing(segments: readonly RawSegment[], width: number): number {
  const levels = clusterValues(
    segments
      .filter((s) => Math.abs(s.a.y - s.b.y) < width * 0.2 && length(s) > width * 8)
      .map((s) => s.a.y),
    width * 0.5,
  )
  const gaps: number[] = []
  for (let i = 1; i < levels.length; i++) {
    const g = (levels[i] ?? 0) - (levels[i - 1] ?? 0)
    if (g > width * 4) gaps.push(g)
  }
  return mode(gaps, width) ?? width * 16
}

export function buildTrackGraph(drawing: SchemeDrawing): TrackGraph | undefined {
  const width = trackWidth(drawing)
  if (width === undefined) return undefined
  const all = rawSegments(drawing, width)
  const u = spacing(all, width) / TRACK_SPACING_UNITS
  // Hatch ticks are 2–4 units long; real track pieces are tens of units.
  const tickLimit = Math.max(width * 2.5, u * 25)
  const ticks = all.filter((s) => length(s) <= tickLimit)
  const lines = dedupe(
    all.filter((s) => length(s) > tickLimit),
    u,
  )
  const graph = planarize(lines, u)
  countHatch(graph, ticks, u)
  return { unit: u, trackWidth: width, nodes: graph.nodes, edges: graph.edges }
}

/** The same line is sometimes stroked twice; keep one copy. */
function dedupe(segments: readonly RawSegment[], u: number): RawSegment[] {
  const out: RawSegment[] = []
  for (const s of segments) {
    const twin = out.some(
      (o) =>
        (dist(o.a, s.a) < u * 2 && dist(o.b, s.b) < u * 2) ||
        (dist(o.a, s.b) < u * 2 && dist(o.b, s.a) < u * 2),
    )
    if (!twin) out.push(s)
  }
  return out
}

function planarize(
  segments: readonly RawSegment[],
  u: number,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const snap = u * 4
  const points: Point[] = []
  const nodeOf = (p: Point): number => {
    const found = points.findIndex((q) => dist(p, q) <= snap)
    if (found >= 0) return found
    points.push(p)
    return points.length - 1
  }
  for (const s of segments) {
    nodeOf(s.a)
    nodeOf(s.b)
  }
  // A track that leaves another one mid-line ends on it without a shared vertex: split there.
  const pieces: { a: number; b: number; style: TrackStyle }[] = []
  for (const s of segments) {
    const ia = nodeOf(s.a),
      ib = nodeOf(s.b)
    const inner = points
      .map((p, i) => ({ p, i, t: along(s, p) }))
      .filter(
        ({ p, i, t }) => i !== ia && i !== ib && t > 0 && t < 1 && distToSegment(p, s) <= snap,
      )
      .sort((x, y) => x.t - y.t)
    let prev = ia
    for (const { i } of inner) {
      if (i !== prev) pieces.push({ a: prev, b: i, style: s.style })
      prev = i
    }
    if (prev !== ib) pieces.push({ a: prev, b: ib, style: s.style })
  }
  const nodes: GraphNode[] = points.map((p, id) => ({ id, at: p, edges: [] }))
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  for (const piece of pieces) {
    const key = piece.a < piece.b ? `${piece.a}-${piece.b}` : `${piece.b}-${piece.a}`
    if (seen.has(key)) continue
    seen.add(key)
    const edge: GraphEdge = {
      id: edges.length,
      from: piece.a,
      to: piece.b,
      style: piece.style,
      hatch: 0,
    }
    edges.push(edge)
    nodes[piece.a]?.edges.push(edge.id)
    nodes[piece.b]?.edges.push(edge.id)
  }
  return { nodes, edges }
}

function countHatch(
  graph: { nodes: readonly GraphNode[]; edges: GraphEdge[] },
  ticks: readonly RawSegment[],
  u: number,
): void {
  for (const tick of ticks) {
    const center = at(tick, 0.5)
    let best: GraphEdge | undefined
    let bestDistance = u * 3
    for (const e of graph.edges) {
      const s = edgeSegment(graph.nodes, e)
      if (!s) continue
      const d = distToSegment(center, s)
      if (d < bestDistance) {
        best = e
        bestDistance = d
      }
    }
    if (best) best.hatch++
  }
}

export function edgeSegment(nodes: readonly GraphNode[], e: GraphEdge): Segment | undefined {
  const a = nodes[e.from]?.at,
    b = nodes[e.to]?.at
  return a && b ? { a, b } : undefined
}

export function otherEnd(e: GraphEdge, node: number): number {
  return e.from === node ? e.to : e.from
}

/** Unit vector from the node along the edge. */
export function outgoing(graph: TrackGraph, e: GraphEdge, node: number): Point {
  const p = graph.nodes[node]?.at,
    q = graph.nodes[otherEnd(e, node)]?.at
  return p && q ? unit(sub(q, p)) : { x: 0, y: 0 }
}

export const collinearOpposite = (u: Point, v: Point): boolean =>
  sinBetween(u, v) < 0.09 && dot(u, v) < 0
