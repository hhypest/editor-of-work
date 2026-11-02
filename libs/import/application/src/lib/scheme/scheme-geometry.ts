import type { DrawingPoint } from './scheme-drawing'

/** Plane geometry of sheet points (y down) used by scheme recognition. */
export type Point = DrawingPoint

export interface Segment {
  readonly a: Point
  readonly b: Point
}

export const sub = (p: Point, q: Point): Point => ({ x: p.x - q.x, y: p.y - q.y })
export const add = (p: Point, q: Point): Point => ({ x: p.x + q.x, y: p.y + q.y })
export const scale = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k })
export const dot = (p: Point, q: Point): number => p.x * q.x + p.y * q.y
export const cross = (p: Point, q: Point): number => p.x * q.y - p.y * q.x
export const dist = (p: Point, q: Point): number => Math.hypot(p.x - q.x, p.y - q.y)
export const length = (s: Segment): number => dist(s.a, s.b)
export const mid = (s: Segment): Point => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 })

export function unit(v: Point): Point {
  const n = Math.hypot(v.x, v.y)
  return n === 0 ? { x: 0, y: 0 } : { x: v.x / n, y: v.y / n }
}

export const direction = (s: Segment): Point => unit(sub(s.b, s.a))

/** Parameter of the projection of p onto the line of s: 0 at a, 1 at b. */
export function along(s: Segment, p: Point): number {
  const v = sub(s.b, s.a)
  const n = dot(v, v)
  return n === 0 ? 0 : dot(sub(p, s.a), v) / n
}

export function at(s: Segment, t: number): Point {
  return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }
}

export function distToSegment(p: Point, s: Segment): number {
  const t = Math.min(1, Math.max(0, along(s, p)))
  return dist(p, at(s, t))
}

/** |sin| of the angle between two directions: 0 — parallel, 1 — perpendicular. */
export const sinBetween = (u: Point, v: Point): number => Math.abs(cross(unit(u), unit(v)))

/** Groups sorted values whose neighbours differ by at most `gap`; returns group means. */
export function clusterValues(values: readonly number[], gap: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const groups: number[][] = []
  for (const v of sorted) {
    const last = groups.at(-1)
    const prev = last?.at(-1)
    if (last && prev !== undefined && v - prev <= gap) last.push(v)
    else groups.push([v])
  }
  return groups.map((g) => g.reduce((s, v) => s + v, 0) / g.length)
}

/** Value of the most populated bucket of width `step`, averaged inside the bucket. */
export function mode(values: readonly number[], step: number): number | undefined {
  const buckets = new Map<number, number[]>()
  for (const v of values) {
    const k = Math.round(v / step)
    const list = buckets.get(k) ?? []
    list.push(v)
    buckets.set(k, list)
  }
  let best: number[] | undefined
  for (const list of buckets.values()) if (!best || list.length > best.length) best = list
  return best ? best.reduce((s, v) => s + v, 0) / best.length : undefined
}

/** Intersection point of two segments strictly inside both, if any. */
export function intersection(s: Segment, t: Segment, margin: number): Point | undefined {
  const r = sub(s.b, s.a),
    q = sub(t.b, t.a)
  const den = cross(r, q)
  if (Math.abs(den) < 1e-9) return undefined
  const w = sub(t.a, s.a)
  const u = cross(w, q) / den,
    v = cross(w, r) / den
  const ms = margin / Math.max(length(s), 1e-9),
    mt = margin / Math.max(length(t), 1e-9)
  if (u <= ms || u >= 1 - ms || v <= mt || v >= 1 - mt) return undefined
  return at(s, u)
}
