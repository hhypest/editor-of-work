import {
  formatPlaceItem,
  placeLength,
  spanContains,
  spanContainsPoint,
  type Brand,
  type PlaceItem,
  type PlaceSpec,
} from '@eow/shared/kernel'
import { measuredByLength, type BasisLine, type PlanBasis, type WorkKind } from './plan-basis'
import type { PlanError } from './plan-error'

export type WorkId = Brand<string, 'WorkId'>

/** Идентификатор работы из строки генератора или файла плана. */
export function workId(id: string): WorkId {
  // Бренд не проверяет содержимое: он только не даёт спутать id работы с другим id.
  return id as WorkId
}

/** Объект станции, к которому привязана работа. */
export type StationObject =
  | { readonly kind: 'track'; readonly number: string }
  | { readonly kind: 'switch'; readonly number: string }

/** Место работы: участки на направлении или станция, путь или стрелочный перевод. */
export type WorkPlace =
  | { readonly kind: 'line'; readonly spec: PlaceSpec }
  | { readonly kind: 'station'; readonly station: string; readonly object?: StationObject }

/** Данные работы, которые вводит пользователь. */
export interface WorkInput {
  /** Код вида работ из нормативов редакции. */
  readonly kind: string
  readonly place: WorkPlace
  /** Введённый объём; undefined — посчитать по участкам (только для единиц «км»). */
  readonly volume: number | undefined
  readonly note: string
  /** Показывать ли выноску с местом и объёмом на схеме. */
  readonly callout: boolean
}

/** Работа годового плана. */
export interface PlannedWork extends WorkInput {
  readonly id: WorkId
}

export interface Volume {
  readonly amount: number
  readonly unit: string
}

function itemOnLine(item: PlaceItem, line: BasisLine): boolean {
  return line.extent.some((span) =>
    item.kind === 'span' ? spanContains(span, item) : spanContainsPoint(span, item),
  )
}

function linePlaceErrors(spec: PlaceSpec, basis: PlanBasis): PlanError[] {
  const line = basis.lines.get(spec.line)
  if (!line) return [{ kind: 'unknown-line', line: spec.line }]
  if (spec.items.length === 0) return [{ kind: 'empty-place' }]
  return spec.items
    .filter((item) => !itemOnLine(item, line))
    .map((item) => ({
      kind: 'outside-line',
      line: { id: line.id, name: line.name },
      place: formatPlaceItem(item),
    }))
}

function stationPlaceErrors(
  place: Extract<WorkPlace, { kind: 'station' }>,
  basis: PlanBasis,
): PlanError[] {
  const station = basis.stations.get(place.station)
  if (!station) return [{ kind: 'unknown-station', station: place.station }]
  const object = place.object
  if (!object) return []
  const ref = { id: station.id, name: station.name }
  switch (object.kind) {
    case 'track':
      return station.tracks.includes(object.number)
        ? []
        : [{ kind: 'unknown-track', station: ref, number: object.number }]
    case 'switch':
      return station.switches.includes(object.number)
        ? []
        : [{ kind: 'unknown-switch', station: ref, number: object.number }]
  }
}

function placeErrors(place: WorkPlace, basis: PlanBasis): PlanError[] {
  return place.kind === 'line'
    ? linePlaceErrors(place.spec, basis)
    : stationPlaceErrors(place, basis)
}

function volumeErrors(input: WorkInput, kind: WorkKind): PlanError[] {
  if (input.volume !== undefined) {
    return Number.isFinite(input.volume) && input.volume >= 0
      ? []
      : [{ kind: 'invalid-volume', volume: input.volume }]
  }
  return input.place.kind === 'line' && measuredByLength(kind)
    ? []
    : [{ kind: 'volume-required', code: kind.code, unit: kind.unit }]
}

/**
 * Инварианты работы (раздел 6.2): вид и место — из той же редакции, участки лежат
 * на протяжении направления, объём неотрицателен или считается по участкам.
 */
export function workErrors(input: WorkInput, basis: PlanBasis): PlanError[] {
  const kind = basis.workKinds.get(input.kind)
  const errors = placeErrors(input.place, basis)
  if (!kind) return [{ kind: 'unknown-work-kind', code: input.kind }, ...errors]
  return [...errors, ...volumeErrors(input, kind)]
}

/**
 * Объём работы: введённый, а если его нет — сумма длин участков в километрах.
 * Вызывается для работ, прошедших {@link workErrors}.
 */
export function workVolume(work: WorkInput, basis: PlanBasis): Volume {
  const unit = basis.workKinds.get(work.kind)?.unit ?? ''
  if (work.volume !== undefined) return { amount: work.volume, unit }
  if (work.place.kind !== 'line') return { amount: 0, unit }
  const line = basis.lines.get(work.place.spec.line)
  const meters = line ? placeLength(work.place.spec, line.kmLengths) : 0
  return { amount: meters / 1000, unit }
}
