import {
  formatPlaceItem,
  mergeSpans,
  placeLength,
  spanContains,
  spanContainsPoint,
  type Brand,
  type Chainage,
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

/** Протяжение может быть задано смежными кусками: участок на их стыке лежит на нём. */
function itemOnLine(item: PlaceItem, line: BasisLine): boolean {
  return mergeSpans(line.extent).some((span) =>
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

function volumeErrors(input: WorkInput, kind: WorkKind | undefined): PlanError[] {
  if (input.volume !== undefined) {
    return Number.isFinite(input.volume) && input.volume >= 0
      ? []
      : [{ kind: 'invalid-volume', volume: input.volume }]
  }
  // Без вида неизвестна единица — обязательность объёма проверится, когда вид будет исправлен.
  if (!kind) return []
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
  return [
    ...(kind ? [] : [{ kind: 'unknown-work-kind', code: input.kind } as const]),
    ...placeErrors(input.place, basis),
    ...volumeErrors(input, kind),
  ]
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

function ownPlace(place: WorkPlace): WorkPlace {
  if (place.kind === 'line') {
    const items = place.spec.items.map((item): PlaceItem =>
      item.kind === 'span'
        ? Object.freeze({
            kind: 'span',
            line: item.line,
            from: Object.freeze({ ...item.from }),
            to: Object.freeze({ ...item.to }),
          })
        : Object.freeze({ kind: 'point', line: item.line, at: Object.freeze({ ...item.at }) }),
    )
    return Object.freeze({
      kind: 'line',
      spec: Object.freeze({ line: place.spec.line, items: Object.freeze(items) }),
    })
  }
  const object = place.object
  return Object.freeze(
    object
      ? { kind: 'station', station: place.station, object: Object.freeze({ ...object }) }
      : { kind: 'station', station: place.station },
  )
}

/**
 * Работа, которой план владеет сам: вложенные объекты скопированы и заморожены.
 * Иначе изменение объекта команды после вызова поменяло бы работу во всех снимках истории.
 */
export function ownWork(id: WorkId, input: WorkInput): PlannedWork {
  return Object.freeze({
    id,
    kind: input.kind,
    place: ownPlace(input.place),
    volume: input.volume,
    note: input.note,
    callout: input.callout,
  })
}

function samePoint(a: Chainage, b: Chainage): boolean {
  return a.km === b.km && a.m === b.m
}

function sameItem(a: PlaceItem, b: PlaceItem): boolean {
  if (a.kind === 'span' && b.kind === 'span')
    return a.line === b.line && samePoint(a.from, b.from) && samePoint(a.to, b.to)
  if (a.kind === 'point' && b.kind === 'point') return a.line === b.line && samePoint(a.at, b.at)
  return false
}

function samePlace(a: WorkPlace, b: WorkPlace): boolean {
  if (a.kind === 'line' && b.kind === 'line') {
    return (
      a.spec.line === b.spec.line &&
      a.spec.items.length === b.spec.items.length &&
      a.spec.items.every((item, i) => {
        const other = b.spec.items[i]
        return other !== undefined && sameItem(item, other)
      })
    )
  }
  if (a.kind === 'station' && b.kind === 'station') {
    return (
      a.station === b.station &&
      a.object?.kind === b.object?.kind &&
      a.object?.number === b.object?.number
    )
  }
  return false
}

/** Данные работы совпадают — правка ничего не меняет и не становится шагом отмены. */
export function sameWorkInput(a: WorkInput, b: WorkInput): boolean {
  return (
    a.kind === b.kind &&
    Object.is(a.volume, b.volume) &&
    a.note === b.note &&
    a.callout === b.callout &&
    samePlace(a.place, b.place)
  )
}
