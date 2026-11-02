import type { SchemeDrawing } from './scheme-drawing'
import { along, dist, distToSegment, dot, sinBetween, sub, type Point } from './scheme-geometry'
import {
  buildTrackGraph,
  collinearOpposite,
  edgeSegment,
  otherEnd,
  outgoing,
  type GraphEdge,
  type TrackGraph,
  type TrackStyle,
} from './scheme-graph'
import { findObjects, type SchemeObjects } from './scheme-objects'
import {
  CAPACITY_LABEL,
  LENGTH_LABEL,
  TRACK_NUMBER,
  placeTexts,
  stationTitle,
  type PlacedText,
} from './scheme-texts'

export type SchemeNodeKind = 'switch' | 'end' | 'bend' | 'crossing'
export type SchemeTrackKind = 'main' | 'station' | 'connector' | 'siding'
export type SchemeTrackState = 'normal' | 'closed' | 'conserved'

export interface SchemeNode {
  readonly id: string
  readonly at: Point
  readonly kind: SchemeNodeKind
  /** Только у концов: упор или путь уходит за пределы схемы. */
  readonly end?: 'stop' | 'open'
}

/** Путь, съезд или путь без номера: ломаная по узлам слева направо. */
export interface SchemeTrack {
  readonly id: string
  readonly number: string | null
  readonly kind: SchemeTrackKind
  readonly state: SchemeTrackState
  readonly nodes: readonly string[]
  /** Полная длина, м — подпись на схеме, а не экспликация. */
  readonly fullLength: number | null
  /** Вместимость в вагонах как подписана: «58», «54/63». */
  readonly capacity: string | null
}

export interface SchemeSwitch {
  readonly id: string
  /** Номер как подписан, без «ав»; null — подпись не найдена. */
  readonly number: string | null
  readonly node: string
  /** Путь, по которому проходит прямое направление стрелки. */
  readonly track: string
  /** Путь или съезд, который отходит от стрелки. */
  readonly branch: string
}

export interface RecognizedScheme extends SchemeObjects {
  /** Название станции из заголовка листа без «ст.». */
  readonly station: string | null
  /** Пунктов листа в одной единице схемы (междупутье — 160 единиц). */
  readonly unit: number
  readonly nodes: readonly SchemeNode[]
  readonly tracks: readonly SchemeTrack[]
  readonly switches: readonly SchemeSwitch[]
  readonly remarks: readonly string[]
}

export type RecognizeError = { readonly message: string }

interface NodeInfo {
  kind: SchemeNodeKind | 'joint'
  /** Пары рёбер, по которым линия проходит через узел. */
  pass: Map<number, number>
}

interface Route {
  readonly nodes: number[]
  readonly edges: number[]
}

interface LabelItem {
  readonly text: PlacedText
  readonly position: number
}

interface LabelGroup {
  readonly number: string | null
  readonly length: number | null
  readonly capacity: string | null
  readonly position: number
  readonly raw: string
}

export function recognizeScheme(
  drawing: SchemeDrawing,
): { ok: true; value: RecognizedScheme } | { ok: false; error: RecognizeError } {
  const graph = buildTrackGraph(drawing)
  if (!graph || !graph.edges.length)
    return { ok: false, error: { message: 'На листе не найдено линий путей.' } }
  const remarks: string[] = []
  const texts = placeTexts(drawing.texts)
  const info = graph.nodes.map((n) => analyzeNode(graph, n.id, remarks))
  const routes = traceRoutes(graph, info)
  const labelUse = new Set<number>()
  const items = routeLabels(graph, routes, texts, labelUse)
  const split = splitRoutes(graph, info, routes, items, remarks)
  const objects = findObjects(
    graph,
    info.map((i) => i.kind),
    texts,
    labelUse,
    drawing,
  )
  const built = buildTracks(graph, info, split, objects.stops)
  remarks.push(...built.remarks, ...objects.remarks)
  const switches = buildSwitches(graph, info, built, objects.switchLabels, remarks)
  for (const t of built.tracks.filter((x) => x.kind === 'siding')) {
    const from = switches.filter((s) => s.branch === t.id).map((s) => s.number ?? '?')
    remarks.push(
      from.length
        ? `Путь без номера отходит от стрелки ${from.join(', ')}.`
        : `Путь без номера не примыкает к стрелкам: начало ${coord(built.nodes.find((n) => n.id === t.nodes[0])?.at)}.`,
    )
  }
  const title = stationTitle(texts)
  if (!title) remarks.push('Не найден заголовок «ст.…»: станцию нужно указать вручную.')
  return {
    ok: true,
    value: {
      station: title ?? null,
      unit: graph.unit,
      nodes: built.nodes,
      tracks: built.tracks,
      switches,
      derailers: objects.derailers.map((d) => ({ ...d, track: built.trackOfEdge(d.edge) })),
      crossings: objects.crossings,
      bridges: objects.bridges.map((b) => ({
        ...b,
        track: b.edge === null ? null : built.trackOfEdge(b.edge),
      })),
      remarks,
    },
  }
}

function analyzeNode(graph: TrackGraph, id: number, remarks: string[]): NodeInfo {
  const node = graph.nodes[id]
  const edges = (node?.edges ?? []).flatMap((e) => graph.edges[e] ?? [])
  const dirs = new Map(edges.map((e) => [e.id, outgoing(graph, e, id)]))
  const pass = new Map<number, number>()
  const link = (a: GraphEdge, b: GraphEdge): void => {
    pass.set(a.id, b.id)
    pass.set(b.id, a.id)
  }
  const dir = (e: GraphEdge): Point => dirs.get(e.id) ?? { x: 0, y: 0 }
  if (edges.length === 1) return { kind: 'end', pass }
  if (edges.length === 2) {
    const [a, b] = edges
    if (a && b) link(a, b)
    return { kind: a && b && collinearOpposite(dir(a), dir(b)) ? 'joint' : 'bend', pass }
  }
  const pairs: [GraphEdge, GraphEdge][] = []
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i],
        b = edges[j]
      if (a && b && collinearOpposite(dir(a), dir(b))) pairs.push([a, b])
    }
  if (edges.length === 4 && pairs.length === 2) {
    for (const [a, b] of pairs) link(a, b)
    return { kind: 'crossing', pass }
  }
  const through = pairs[0] ?? mostOpposite(edges, dir)
  if (!through) return { kind: 'switch', pass }
  const [p, q] = through
  const branches = edges.filter((e) => e !== p && e !== q)
  if (!pairs.length || edges.length > 3)
    remarks.push(
      `Узел ${coord(node?.at)}: ${edges.length} линии сходятся без прямого прохода — проверьте стрелку.`,
    )
  const branch = branches[0]
  if (branch && edges.length === 3) {
    // The straight route is the through edge on the branch side; the other one is the toe.
    const [straight, toe] = dot(dir(branch), dir(p)) > dot(dir(branch), dir(q)) ? [p, q] : [q, p]
    // A main track that continues over the diverging route keeps its colour.
    if (straight.style !== toe.style && branch.style === toe.style) link(toe, branch)
    else link(toe, straight)
    return { kind: 'switch', pass }
  }
  link(p, q)
  return { kind: 'switch', pass }
}

function mostOpposite(
  edges: readonly GraphEdge[],
  dir: (e: GraphEdge) => Point,
): [GraphEdge, GraphEdge] | undefined {
  let best: [GraphEdge, GraphEdge] | undefined
  let bestDot = -0.5
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i],
        b = edges[j]
      if (!a || !b) continue
      const d = dir(a).x * dir(b).x + dir(a).y * dir(b).y
      if (d < bestDot) {
        bestDot = d
        best = [a, b]
      }
    }
  return best
}

/** Место на листе для замечаний: миллиметры от левого верхнего угла, как в просмотрщике PDF. */
const MM_PER_POINT = 25.4 / 72
const coord = (p: Point | undefined): string =>
  p ? `(${Math.round(p.x * MM_PER_POINT)}; ${Math.round(p.y * MM_PER_POINT)} мм)` : '(?)'

/** Maximal lines that pass straight through switches and bends. */
function traceRoutes(graph: TrackGraph, info: readonly NodeInfo[]): Route[] {
  const used = new Set<number>()
  const routes: Route[] = []
  for (const start of graph.edges) {
    if (used.has(start.id)) continue
    used.add(start.id)
    const forward = walk(graph, info, start, start.to, used)
    const backward = walk(graph, info, start, start.from, used)
    routes.push({
      nodes: [...backward.nodes.reverse(), start.from, start.to, ...forward.nodes],
      edges: [...backward.edges.reverse(), start.id, ...forward.edges],
    })
  }
  return routes
}

function walk(
  graph: TrackGraph,
  info: readonly NodeInfo[],
  from: GraphEdge,
  node: number,
  used: Set<number>,
): { nodes: number[]; edges: number[] } {
  const nodes: number[] = [],
    edges: number[] = []
  let edge = from,
    at = node
  for (;;) {
    const next = info[at]?.pass.get(edge.id)
    const e = next === undefined ? undefined : graph.edges[next]
    if (!e || used.has(e.id)) return { nodes, edges }
    used.add(e.id)
    at = otherEnd(e, at)
    edge = e
    edges.push(e.id)
    nodes.push(at)
  }
}

/** Texts written on a track line, in order along each route. */
function routeLabels(
  graph: TrackGraph,
  routes: readonly Route[],
  texts: readonly PlacedText[],
  used: Set<number>,
): LabelItem[][] {
  const out: LabelItem[][] = routes.map(() => [])
  for (const t of texts) {
    let best: { route: number; position: number; d: number } | undefined
    routes.forEach((r, ri) => {
      let offset = 0
      for (const eid of r.edges) {
        const e = graph.edges[eid]
        const s = e && edgeSegment(graph.nodes, e)
        if (!s) continue
        const len = dist(s.a, s.b)
        const forward = r.nodes[r.edges.indexOf(eid)] === e.from
        const t0 = along(s, t.center)
        const d = distToSegment(t.center, s)
        if (
          sinBetween(t.dir, sub(s.b, s.a)) < 0.15 &&
          d < t.size * 0.5 &&
          t0 > -0.02 &&
          t0 < 1.02 &&
          (!best || d < best.d)
        )
          best = { route: ri, position: offset + (forward ? t0 : 1 - t0) * len, d }
        offset += len
      }
    })
    if (best) {
      out[best.route]?.push({ text: t, position: best.position })
      used.add(t.index)
    }
  }
  for (const list of out) list.sort((a, b) => a.position - b.position)
  return out
}

/**
 * «2—849—56»: number, full length and blue capacity follow each other in reading order.
 * Labels of different tracks on one line are far apart; capacity may stand further off.
 */
function labelGroups(items: readonly LabelItem[]): LabelGroup[] {
  const ordered = readingOrder(items)
  const clusters: LabelItem[][] = []
  for (const item of ordered) {
    const last = clusters.at(-1)
    const prev = last?.at(-1)
    const gap = prev
      ? Math.abs(item.position - prev.position) - (prev.text.width + item.text.width) / 2
      : 0
    // Compressed-length marks «>—<» often stand between the number and the length.
    const size = Math.max(prev?.text.size ?? 0, item.text.size)
    const limit = size * 12
    if (last && prev && gap < limit) last.push(item)
    else clusters.push([item])
  }
  return clusters.map((cluster) => {
    let number: string | null = null,
      length: number | null = null,
      capacity: string | null = null
    for (const { text } of cluster) {
      const value = text.text.replace(/\s+/gu, '')
      if (text.color === 'blue' && CAPACITY_LABEL.test(value)) capacity = value
      else if (number === null && TRACK_NUMBER.test(value)) number = value
      else if (length === null && LENGTH_LABEL.test(value)) length = Number(value)
    }
    const position = cluster.reduce((s, i) => s + i.position, 0) / cluster.length
    return { number, length, capacity, position, raw: cluster.map((i) => i.text.text).join('—') }
  })
}

/** Route order may run against the text; labels are read the way they are written. */
function readingOrder(items: readonly LabelItem[]): LabelItem[] {
  if (items.length < 2) return [...items]
  const first = items[0],
    last = items.at(-1)
  if (!first || !last) return [...items]
  const along = sub(last.text.center, first.text.center)
  const forward = along.x * first.text.dir.x + along.y * first.text.dir.y >= 0
  return forward ? [...items] : [...items].reverse()
}

interface SplitRoute extends Route {
  readonly group: LabelGroup | null
}

/** A route carrying two numbers holds two tracks end to end; cut it between the labels. */
function splitRoutes(
  graph: TrackGraph,
  info: readonly NodeInfo[],
  routes: readonly Route[],
  items: readonly LabelItem[][],
  remarks: string[],
): SplitRoute[] {
  const out: SplitRoute[] = []
  routes.forEach((route, ri) => {
    const groups = labelGroups(items[ri] ?? [])
    const numbered = groups.filter((g) => g.number !== null)
    for (const g of groups)
      if (g.number === null)
        remarks.push(`Подпись на линии пути «${g.raw}» не похожа на номер пути.`)
    const distinct = numbered
      .filter((g, i) => numbered.findIndex((h) => h.number === g.number) === i)
      .sort((a, b) => a.position - b.position)
    if (distinct.length <= 1) {
      out.push({ ...route, group: distinct[0] ?? null })
      return
    }
    const offsets = cumulative(graph, route)
    let startIndex = 0
    for (let k = 0; k + 1 < distinct.length; k++) {
      const a = distinct[k],
        b = distinct[k + 1]
      if (!a || !b) continue
      const cut = cutIndex(info, route, offsets, a.position, b.position, startIndex)
      if (cut === undefined) {
        remarks.push(
          `Пути «${a.number}» и «${b.number}» нарисованы одной линией без узла между ними.`,
        )
        continue
      }
      out.push(slice(route, startIndex, cut, a))
      startIndex = cut
    }
    out.push(slice(route, startIndex, route.nodes.length - 1, distinct.at(-1) ?? null))
  })
  return out
}

function cumulative(graph: TrackGraph, route: Route): number[] {
  const offsets = [0]
  route.edges.forEach((eid, i) => {
    const a = graph.nodes[route.nodes[i] ?? -1]?.at,
      b = graph.nodes[route.nodes[i + 1] ?? -1]?.at
    offsets.push((offsets[i] ?? 0) + (a && b ? dist(a, b) : 0))
  })
  return offsets
}

function cutIndex(
  info: readonly NodeInfo[],
  route: Route,
  offsets: readonly number[],
  from: number,
  to: number,
  after: number,
): number | undefined {
  const middle = (from + to) / 2
  let best: { i: number; score: number } | undefined
  route.nodes.forEach((n, i) => {
    const o = offsets[i] ?? 0
    if (i <= after || i >= route.nodes.length - 1 || o <= from || o >= to) return
    // Switches are natural track boundaries; otherwise the vertex nearest the middle.
    const score = Math.abs(o - middle) - (info[n]?.kind === 'switch' ? 1e6 : 0)
    if (!best || score < best.score) best = { i, score }
  })
  return best?.i
}

function slice(route: Route, from: number, to: number, group: LabelGroup | null): SplitRoute {
  return {
    nodes: route.nodes.slice(from, to + 1),
    edges: route.edges.slice(from, to),
    group,
  }
}

interface BuiltTracks {
  readonly nodes: SchemeNode[]
  readonly tracks: SchemeTrack[]
  readonly remarks: string[]
  /** Track of a graph edge, for objects found on lines. */
  readonly trackOfEdge: (edge: number) => string
  readonly edgeTrack: ReadonlyMap<number, string>
  readonly nodeId: (n: number) => string
}

function buildTracks(
  graph: TrackGraph,
  info: readonly NodeInfo[],
  routes: readonly SplitRoute[],
  stops: ReadonlySet<number>,
): BuiltTracks {
  const remarks: string[] = []
  const edgeTrack = new Map<number, string>()
  const kept = new Set<number>()
  const tracks: SchemeTrack[] = routes.map((route, i) => {
    const id = `t${i + 1}`
    for (const e of route.edges) edgeTrack.set(e, id)
    const ordered = leftToRight(graph, route.nodes)
    const nodes = ordered.filter(
      (n, k) => k === 0 || k === ordered.length - 1 || info[n]?.kind !== 'joint',
    )
    for (const n of nodes) kept.add(n)
    const style = dominant(graph, route.edges)
    const hatch = route.edges.reduce((s, e) => s + (graph.edges[e]?.hatch ?? 0), 0)
    const lengthPt = cumulative(graph, route).at(-1) ?? 0
    const conserved = style === 'station' && hatch >= 3 && hatch * graph.unit * 60 >= lengthPt
    const ends = [route.nodes[0], route.nodes.at(-1)]
    const kind: SchemeTrackKind = route.group?.number
      ? style === 'main'
        ? 'main'
        : 'station'
      : ends.every((n) => n !== undefined && info[n]?.kind === 'switch')
        ? 'connector'
        : 'siding'
    return {
      id,
      number: route.group?.number ?? null,
      kind,
      state: style === 'closed' ? 'closed' : conserved ? 'conserved' : 'normal',
      nodes: nodes.map((n) => `n${n}`),
      fullLength: route.group?.length ?? null,
      capacity: route.group?.capacity ?? null,
    }
  })
  const nodes: SchemeNode[] = [...kept].map((n) => {
    const kind = info[n]?.kind ?? 'end'
    const at = graph.nodes[n]?.at ?? { x: 0, y: 0 }
    if (kind === 'end') return { id: `n${n}`, at, kind, end: stops.has(n) ? 'stop' : 'open' }
    return { id: `n${n}`, at, kind: kind === 'joint' ? 'bend' : kind }
  })
  return {
    nodes,
    tracks,
    remarks,
    edgeTrack,
    trackOfEdge: (e) => edgeTrack.get(e) ?? '',
    nodeId: (n) => `n${n}`,
  }
}

function leftToRight(graph: TrackGraph, nodes: readonly number[]): number[] {
  const a = graph.nodes[nodes[0] ?? -1]?.at,
    b = graph.nodes[nodes.at(-1) ?? -1]?.at
  if (!a || !b) return [...nodes]
  const reverse = b.x < a.x - 1e-6 || (Math.abs(b.x - a.x) <= 1e-6 && b.y < a.y)
  return reverse ? [...nodes].reverse() : [...nodes]
}

function dominant(graph: TrackGraph, edges: readonly number[]): TrackStyle {
  const totals = new Map<TrackStyle, number>()
  for (const id of edges) {
    const e = graph.edges[id]
    const s = e && edgeSegment(graph.nodes, e)
    if (e && s) totals.set(e.style, (totals.get(e.style) ?? 0) + dist(s.a, s.b))
  }
  let best: TrackStyle = 'station',
    max = -1
  for (const [style, total] of totals)
    if (total > max) {
      best = style
      max = total
    }
  return best
}

function buildSwitches(
  graph: TrackGraph,
  info: readonly NodeInfo[],
  built: BuiltTracks,
  labels: ReadonlyMap<number, string>,
  remarks: string[],
): SchemeSwitch[] {
  const out: SchemeSwitch[] = []
  info.forEach((node, n) => {
    if (node.kind !== 'switch') return
    const edges = graph.nodes[n]?.edges ?? []
    const through = edges.find((e) => node.pass.has(e))
    const branches = edges.filter((e) => !node.pass.has(e))
    const track = through === undefined ? undefined : built.edgeTrack.get(through)
    for (const b of branches) {
      const branch = built.edgeTrack.get(b)
      if (!track || !branch) continue
      out.push({
        id: `s${out.length + 1}`,
        number: labels.get(n) ?? null,
        node: built.nodeId(n),
        track,
        branch,
      })
    }
    if (!labels.has(n)) remarks.push(`Стрелка в узле ${coord(graph.nodes[n]?.at)} без номера.`)
  })
  return out
}
