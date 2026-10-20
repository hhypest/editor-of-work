import {
  intersectSpans,
  spanContainsPoint,
  spanLength,
  type Chainage,
  type TrackSpan,
} from '@eow/shared/kernel'
import type { PlanBasis } from './plan-basis'
import type { PlannedWork } from './planned-work'

/** Область, для которой считается таблица плана: вся дистанция, ПД или станция. */
export type PlanArea =
  | { readonly kind: 'district' }
  | { readonly kind: 'pd'; readonly pd: string }
  | { readonly kind: 'station'; readonly station: string }

/** Ключ области в плане: «district», «pd:ПД-1», «station:S1». */
export function areaKey(area: PlanArea): string {
  switch (area.kind) {
    case 'district':
      return 'district'
    case 'pd':
      return `pd:${area.pd}`
    case 'station':
      return `station:${area.station}`
  }
}

/** Подпись области для текстов ошибок. */
export function areaLabel(area: PlanArea): string {
  switch (area.kind) {
    case 'district':
      return 'Дистанция'
    case 'pd':
      return `ПД «${area.pd}»`
    case 'station':
      return `Станция «${area.station}»`
  }
}

/** Область есть в срезе редакции плана. */
export function areaExists(area: PlanArea, basis: PlanBasis): boolean {
  switch (area.kind) {
    case 'district':
      return true
    case 'pd':
      return basis.pds.has(area.pd)
    case 'station':
      return basis.stations.has(area.station)
  }
}

// --- Принадлежность места ---------------------------------------------------

/** ПД, в границах которого лежит точка; undefined — вне всех действующих ПД. */
export function pdAtPoint(basis: PlanBasis, line: string, at: Chainage): string | undefined {
  for (const pd of basis.pds.values()) {
    if (pd.segments.some((span) => spanContainsPoint(span, { line, at }))) return pd.id
  }
  return undefined
}

/** ПД станции — по привязке «Станции → ПД». */
export function pdOfStation(basis: PlanBasis, station: string): string | undefined {
  return basis.stations.get(station)?.pd
}

// --- Распределение объёма ---------------------------------------------------

/**
 * Доли работы по ПД: от 0 до 1, в сумме с долей вне ПД — 1.
 * Участки делятся по длине; работа только из точек делится поровну между точками;
 * станционная работа целиком уходит в ПД станции (раздел 6.4).
 */
export interface WorkShares {
  readonly byPd: ReadonlyMap<string, number>
  /** Доля, которая не попала ни в один действующий ПД. */
  readonly outside: number
}

function addShare(map: Map<string, number>, key: string | undefined, share: number): number {
  if (key === undefined) return share
  map.set(key, (map.get(key) ?? 0) + share)
  return 0
}

function spanShares(spans: readonly TrackSpan[], line: string, basis: PlanBasis): WorkShares {
  const lengths = basis.lines.get(line)?.kmLengths
  const byPd = new Map<string, number>()
  if (!lengths) return { byPd, outside: 1 }
  const total = spans.reduce((sum, s) => sum + spanLength(s, lengths), 0)
  let inside = 0
  for (const pd of basis.pds.values()) {
    let meters = 0
    for (const s of spans) {
      for (const segment of pd.segments) {
        const common = intersectSpans(s, segment)
        if (common) meters += spanLength(common, lengths)
      }
    }
    if (meters > 0) byPd.set(pd.id, meters / total)
    inside += meters
  }
  return { byPd, outside: (total - inside) / total }
}

function pointShares(points: readonly Chainage[], line: string, basis: PlanBasis): WorkShares {
  const byPd = new Map<string, number>()
  const each = 1 / points.length
  let outside = 0
  for (const at of points) outside += addShare(byPd, pdAtPoint(basis, line, at), each)
  return { byPd, outside }
}

export function workShares(work: PlannedWork, basis: PlanBasis): WorkShares {
  const place = work.place
  if (place.kind === 'station') {
    const byPd = new Map<string, number>()
    const outside = addShare(byPd, pdOfStation(basis, place.station), 1)
    return { byPd, outside }
  }
  const spans = place.spec.items.flatMap((i) => (i.kind === 'span' ? [i] : []))
  if (spans.length > 0) return spanShares(spans, place.spec.line, basis)
  const points = place.spec.items.flatMap((i) => (i.kind === 'point' ? [i.at] : []))
  return pointShares(points, place.spec.line, basis)
}

/** Доля работы в области: вся дистанция — 1, ПД — по долям, станция — работы этой станции. */
export function shareIn(work: PlannedWork, area: PlanArea, basis: PlanBasis): number {
  switch (area.kind) {
    case 'district':
      return 1
    case 'pd':
      return workShares(work, basis).byPd.get(area.pd) ?? 0
    case 'station':
      return work.place.kind === 'station' && work.place.station === area.station ? 1 : 0
  }
}
