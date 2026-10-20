import { err, ok, type KmLengths, type Result, type TrackSpan } from '@eow/shared/kernel'
import type { BasisPart, PlanError } from './plan-error'

/**
 * Срез редакции паспорта, по которой составлен план. План хранит его в себе
 * и не читает паспорт напрямую: старый план открывается с теми же данными (раздел 5).
 */
export interface PlanBasis {
  readonly edition: EditionRef
  readonly lines: ReadonlyMap<string, BasisLine>
  readonly stations: ReadonlyMap<string, BasisStation>
  readonly workKinds: ReadonlyMap<string, WorkKind>
}

export interface EditionRef {
  readonly number: string
  /** Дата введения редакции, ГГГГ-ММ-ДД. */
  readonly date: string
}

/** Направление (главный путь) в пределах дистанции. */
export interface BasisLine {
  readonly id: string
  readonly name: string
  /** Протяжение в дистанции; бывает из нескольких участков, между ними — чужая дистанция. */
  readonly extent: readonly TrackSpan[]
  readonly kmLengths: KmLengths
}

export interface BasisStation {
  readonly id: string
  readonly name: string
  /** Номера станционных путей. */
  readonly tracks: readonly string[]
  /** Номера стрелочных переводов. */
  readonly switches: readonly string[]
}

/** Вид работ из нормативов редакции. */
export interface WorkKind {
  readonly code: string
  readonly name: string
  /** Единица объёма: «км», «шт», «компл», … */
  readonly unit: string
  /** Код строки плана, в которую объём входит дополнительно (ППРК → ППР). */
  readonly includedIn?: string
}

export interface PlanBasisInput {
  readonly edition: EditionRef
  readonly lines: readonly BasisLine[]
  readonly stations: readonly BasisStation[]
  readonly workKinds: readonly WorkKind[]
}

function index<T>(
  items: readonly T[],
  key: (item: T) => string,
  what: BasisPart,
): Result<ReadonlyMap<string, T>, PlanError> {
  const map = new Map<string, T>()
  for (const item of items) {
    const id = key(item)
    if (map.has(id)) return err({ kind: 'duplicate-basis', what, id })
    map.set(id, item)
  }
  return ok(map)
}

/** Собрать срез: идентификаторы уникальны, протяжение лежит на своём направлении. */
export function planBasis(input: PlanBasisInput): Result<PlanBasis, PlanError> {
  const lines = index(input.lines, (l) => l.id, 'line')
  if (!lines.ok) return lines
  const stations = index(input.stations, (s) => s.id, 'station')
  if (!stations.ok) return stations
  const workKinds = index(input.workKinds, (k) => k.code, 'work-kind')
  if (!workKinds.ok) return workKinds
  for (const line of input.lines) {
    if (line.extent.some((span) => span.line !== line.id))
      return err({ kind: 'extent-off-line', line: line.id })
  }
  for (const kind of input.workKinds) {
    if (kind.includedIn !== undefined && !workKinds.value.has(kind.includedIn))
      return err({ kind: 'unknown-included-in', code: kind.code, includedIn: kind.includedIn })
  }
  return ok({
    edition: input.edition,
    lines: lines.value,
    stations: stations.value,
    workKinds: workKinds.value,
  })
}

/** Объём вида считается по длине участков только в километрах. */
export function measuredByLength(kind: WorkKind): boolean {
  return kind.unit.trim() === 'км'
}
