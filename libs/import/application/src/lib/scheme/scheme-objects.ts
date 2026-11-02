import type { SchemeDrawing } from './scheme-drawing'
import {
  along,
  at,
  cross,
  dot,
  dist,
  distToSegment,
  intersection,
  length,
  sinBetween,
  sub,
  type Point,
  type Segment,
} from './scheme-geometry'
import { TRACK_SPACING_UNITS, edgeSegment, type TrackGraph } from './scheme-graph'
import { crossingPlace, objectLabel, type PlacedText } from './scheme-texts'

/** Сбрасывающий остряк на пути. */
export interface SchemeDerailer {
  readonly id: string
  readonly number: string
  readonly track: string
  readonly at: Point
}

/** Переезд: ось поперёк путей от крайнего пересечённого пути до другого. */
export interface SchemeCrossing {
  readonly id: string
  readonly label: string
  readonly km: number | null
  readonly pk: number | null
  readonly from: Point
  readonly to: Point
}

/** Мост: знак фермы на пути или подписанный мост. */
export interface SchemeBridge {
  readonly id: string
  readonly label: string | null
  readonly track: string | null
  readonly from: Point
  readonly to: Point
}

export interface SchemeObjects {
  readonly derailers: readonly SchemeDerailer[]
  readonly crossings: readonly SchemeCrossing[]
  readonly bridges: readonly SchemeBridge[]
}

export interface FoundObjects {
  readonly stops: ReadonlySet<number>
  readonly switchLabels: ReadonlyMap<number, string>
  readonly derailers: readonly (Omit<SchemeDerailer, 'track'> & { readonly edge: number })[]
  readonly crossings: readonly SchemeCrossing[]
  readonly bridges: readonly (Omit<SchemeBridge, 'track'> & { readonly edge: number | null })[]
  readonly remarks: readonly string[]
}

interface ThinLine extends Segment {
  readonly dashed: boolean
  readonly path: number
}

type NodeKind = 'switch' | 'end' | 'bend' | 'crossing' | 'joint'

/** Symbols drawn with thin lines next to the track graph, anchored to tracks and labels. */
export function findObjects(
  graph: TrackGraph,
  kinds: readonly NodeKind[],
  texts: readonly PlacedText[],
  labelUse: Set<number>,
  drawing: SchemeDrawing,
): FoundObjects {
  const u = graph.unit
  const spacing = u * TRACK_SPACING_UNITS
  const remarks: string[] = []
  const thin: ThinLine[] = []
  drawing.paths.forEach((p, index) => {
    if (!p.stroke || p.width >= graph.trackWidth * 0.9) return
    for (const sp of p.subpaths)
      for (let i = 1; i < sp.length; i++) {
        const a = sp[i - 1],
          b = sp[i]
        if (a && b && dist(a, b) > u) thin.push({ a, b, dashed: p.dash.length > 0, path: index })
      }
  })
  const segments = graph.edges.flatMap((e) => {
    const s = edgeSegment(graph.nodes, e)
    return s ? [{ edge: e.id, s }] : []
  })
  const stops = new Set<number>()
  kinds.forEach((kind, n) => {
    const node = graph.nodes[n]
    const edge = graph.edges[node?.edges[0] ?? -1]
    const s = edge && edgeSegment(graph.nodes, edge)
    if (kind !== 'end' || !node || !s) return
    const bar = thin.some(
      (line) =>
        !line.dashed &&
        sinBetween(sub(line.b, line.a), sub(s.b, s.a)) > 0.9 &&
        distToSegment(node.at, line) < u * 4 &&
        length(line) > u * 30 &&
        length(line) < u * 150,
    )
    if (bar) stops.add(n)
  })
  const switchLabels = matchSwitchLabels(graph, kinds, texts, labelUse, spacing, remarks)
  const derailers = findDerailers(graph, segments, thin, texts, labelUse, spacing, remarks)
  const crossings = findCrossings(segments, thin, texts, labelUse, spacing, remarks)
  const bridges = findBridges(graph, segments, thin, texts, labelUse, spacing)
  return { stops, switchLabels, derailers, crossings, bridges, remarks }
}

function matchSwitchLabels(
  graph: TrackGraph,
  kinds: readonly NodeKind[],
  texts: readonly PlacedText[],
  labelUse: Set<number>,
  spacing: number,
  remarks: string[],
): Map<number, string> {
  const numbers = new Map<number, string>()
  for (const t of texts) {
    if (labelUse.has(t.index)) continue
    const label = objectLabel(t.text)
    if (label?.kind === 'switch') numbers.set(t.index, label.number)
    // «сб» не стрелка и не остряк: подпись не должна достаться ближайшей стрелке.
    if (label?.kind === 'ignored') labelUse.add(t.index)
  }
  const candidates = texts.filter((t) => numbers.has(t.index))
  const pairs: { node: number; text: PlacedText; d: number }[] = []
  kinds.forEach((kind, n) => {
    const node = graph.nodes[n]
    if (kind !== 'switch' || !node) return
    for (const t of candidates) {
      const d = dist(node.at, t.center)
      if (d < spacing * 0.9) pairs.push({ node: n, text: t, d })
    }
  })
  pairs.sort((a, b) => a.d - b.d)
  const out = new Map<number, string>()
  for (const { node, text } of pairs) {
    if (out.has(node) || labelUse.has(text.index)) continue
    const number = numbers.get(text.index)
    if (!number) continue
    out.set(node, number)
    labelUse.add(text.index)
  }
  for (const t of candidates)
    if (!labelUse.has(t.index) && /\bав$/iu.test(t.text))
      remarks.push(`Подпись стрелки «${t.text}» не отнесена ни к одному узлу.`)
  return out
}

function nearestOnTrack(
  segments: readonly { edge: number; s: Segment }[],
  p: Point,
  limit: number,
): { edge: number; at: Point; d: number } | undefined {
  let best: { edge: number; at: Point; d: number } | undefined
  for (const { edge, s } of segments) {
    const t = Math.min(1, Math.max(0, along(s, p)))
    const q = at(s, t)
    const d = dist(p, q)
    if (d < limit && (!best || d < best.d)) best = { edge, at: q, d }
  }
  return best
}

/** Остряк: тонкий косой отросток от линии пути с подписью «…со» рядом. */
function findDerailers(
  graph: TrackGraph,
  segments: readonly { edge: number; s: Segment }[],
  thin: readonly ThinLine[],
  texts: readonly PlacedText[],
  labelUse: Set<number>,
  spacing: number,
  remarks: string[],
): FoundObjects['derailers'] {
  const u = graph.unit
  const roots: { edge: number; at: Point }[] = []
  for (const line of thin) {
    if (line.dashed || length(line) < u * 40 || length(line) > u * 260) continue
    for (const end of [line.a, line.b]) {
      const hit = segments.find(
        ({ s }) =>
          distToSegment(end, s) < u * 2 &&
          dist(end, s.a) > u * 8 &&
          dist(end, s.b) > u * 8 &&
          sinBetween(sub(line.b, line.a), sub(s.b, s.a)) > 0.3,
      )
      if (hit) roots.push({ edge: hit.edge, at: end })
    }
  }
  const out: (Omit<SchemeDerailer, 'track'> & { edge: number })[] = []
  const usedRoots = new Set<number>()
  for (const t of texts) {
    const label = objectLabel(t.text)
    if (label?.kind !== 'derailer' || labelUse.has(t.index)) continue
    const number = label.number
    let best = -1
    roots.forEach((r, i) => {
      const d = dist(r.at, t.center)
      if (
        !usedRoots.has(i) &&
        d < spacing &&
        (best < 0 || d < dist(roots[best]?.at ?? r.at, t.center))
      )
        best = i
    })
    const root = roots[best]
    labelUse.add(t.index)
    if (root) {
      usedRoots.add(best)
      out.push({ id: `d${out.length + 1}`, number, edge: root.edge, at: root.at })
      continue
    }
    const near = nearestOnTrack(segments, t.center, spacing)
    if (!near) {
      remarks.push(`Остряк «${t.text}» не найден на путях.`)
      continue
    }
    remarks.push(`Остряк «${t.text}»: знак не найден, место взято по подписи.`)
    out.push({ id: `d${out.length + 1}`, number, edge: near.edge, at: near.at })
  }
  return out
}

/** Переезд — подпись «переезд …» и штрихпунктирная ось рядом с ней. */
function findCrossings(
  segments: readonly { edge: number; s: Segment }[],
  thin: readonly ThinLine[],
  texts: readonly PlacedText[],
  labelUse: Set<number>,
  spacing: number,
  remarks: string[],
): SchemeCrossing[] {
  const out: SchemeCrossing[] = []
  const usedAxes = new Set<number>()
  for (const t of texts) {
    if (!/переезд/iu.test(t.text)) continue
    labelUse.add(t.index)
    const axes = thin
      .map((line, i) => ({ line, i }))
      .filter(
        ({ line, i }) =>
          line.dashed &&
          !usedAxes.has(i) &&
          sinBetween(sub(line.b, line.a), t.dir) < 0.1 &&
          distToSegment(t.center, line) < spacing * 1.5,
      )
      .sort((a, b) => distToSegment(t.center, a.line) - distToSegment(t.center, b.line))
    const axis = axes[0]
    if (!axis) {
      remarks.push(`Переезд «${t.text}»: ось не найдена, переезд пропущен.`)
      continue
    }
    usedAxes.add(axis.i)
    const span = axisSpan(axis.line, segments, spacing)
    if (!span) {
      remarks.push(`Переезд «${t.text}»: ось не пересекает пути, переезд пропущен.`)
      continue
    }
    out.push({ id: `c${out.length + 1}`, label: t.text, ...crossingPlace(t.text), ...span })
  }
  return out
}

function axisSpan(
  axis: Segment,
  segments: readonly { edge: number; s: Segment }[],
  spacing: number,
): { from: Point; to: Point } | undefined {
  // The dashed axis may stop short of the tracks it marks: extend it before intersecting.
  const d = sub(axis.b, axis.a)
  const n = Math.hypot(d.x, d.y) || 1
  const long: Segment = {
    a: { x: axis.a.x - (d.x / n) * spacing * 4, y: axis.a.y - (d.y / n) * spacing * 4 },
    b: { x: axis.b.x + (d.x / n) * spacing * 4, y: axis.b.y + (d.y / n) * spacing * 4 },
  }
  const hits = segments.flatMap(({ s }) => {
    const p = intersection(long, s, 0)
    return p ? [{ p, t: along(long, p) }] : []
  })
  if (!hits.length) return undefined
  hits.sort((a, b) => a.t - b.t)
  const first = hits[0],
    last = hits.at(-1)
  return first && last ? { from: first.p, to: last.p } : undefined
}

/** Ферма моста: прямоугольник с зигзагом внутри; подпись «мост» рядом, если есть. */
function findBridges(
  graph: TrackGraph,
  segments: readonly { edge: number; s: Segment }[],
  thin: readonly ThinLine[],
  texts: readonly PlacedText[],
  labelUse: Set<number>,
  spacing: number,
): FoundObjects['bridges'] {
  const u = graph.unit
  const out: (Omit<SchemeBridge, 'track'> & { edge: number | null })[] = []
  const boxes = rectangles(thin, u)
  for (const box of boxes) {
    const inside = thin.filter(
      (l) =>
        l.path !== box.path &&
        contains(box, l.a, u) &&
        contains(box, l.b, u) &&
        sinBetween(sub(l.b, l.a), box.axis) > 0.3 &&
        sinBetween(sub(l.b, l.a), box.axis) < 0.98,
    )
    // A truss zigzags: diagonals lean both ways. Hatching of other symbols leans one way.
    const lean = inside.map((l) =>
      Math.sign(cross(box.axis, sub(l.b, l.a)) * dot(box.axis, sub(l.b, l.a))),
    )
    if (lean.filter((s) => s > 0).length < 2 || lean.filter((s) => s < 0).length < 2) continue
    const center = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 }
    const near = nearestOnTrack(segments, center, spacing * 0.5)
    // Only a truss standing on a track is a railway bridge; others are scenery.
    if (!near) continue
    const label = texts.find(
      (t) =>
        /мост/iu.test(t.text) && !labelUse.has(t.index) && dist(t.center, center) < spacing * 3,
    )
    if (label) labelUse.add(label.index)
    const s = segments.find((x) => x.edge === near.edge)?.s
    if (!s) continue
    const corners = [
      box.min,
      box.max,
      { x: box.min.x, y: box.max.y },
      { x: box.max.x, y: box.min.y },
    ]
    const ends = [
      Math.min(...corners.map((c) => along(s, c))),
      Math.max(...corners.map((c) => along(s, c))),
    ]
      .map((t) => at(s, Math.min(1, Math.max(0, t))))
      .sort((p, q) => p.x - q.x || p.y - q.y)
    out.push({
      id: `b${out.length + 1}`,
      label: label?.text ?? null,
      edge: near.edge,
      from: ends[0] ?? near.at,
      to: ends[1] ?? near.at,
    })
  }
  return out
}

interface Box {
  readonly min: Point
  readonly max: Point
  readonly axis: Point
  readonly path: number
}

/** Closed axis-aligned rectangles drawn by one thin path. */
function rectangles(thin: readonly ThinLine[], u: number): Box[] {
  const byPath = new Map<number, ThinLine[]>()
  for (const l of thin) byPath.set(l.path, [...(byPath.get(l.path) ?? []), l])
  const out: Box[] = []
  for (const [path, lines] of byPath) {
    if (lines.length !== 4) continue
    const pts = lines.flatMap((l) => [l.a, l.b])
    const xs = pts.map((p) => p.x),
      ys = pts.map((p) => p.y)
    const min = { x: Math.min(...xs), y: Math.min(...ys) },
      max = { x: Math.max(...xs), y: Math.max(...ys) }
    const axisAligned = lines.every(
      (l) => Math.abs(l.a.x - l.b.x) < u * 2 || Math.abs(l.a.y - l.b.y) < u * 2,
    )
    if (!axisAligned || max.x - min.x < u * 20 || max.y - min.y < u * 20) continue
    const axis = max.x - min.x >= max.y - min.y ? { x: 1, y: 0 } : { x: 0, y: 1 }
    out.push({ min, max, axis, path })
  }
  return out
}

const contains = (box: Box, p: Point, u: number): boolean =>
  p.x >= box.min.x - u * 2 &&
  p.x <= box.max.x + u * 2 &&
  p.y >= box.min.y - u * 2 &&
  p.y <= box.max.y + u * 2
