import {
  err,
  ok,
  spansOverlap,
  type KmLengths,
  type Result,
  type TrackSpan,
} from '@eow/shared/kernel'
import type { BasisPart, PlanError } from './plan-error'

/**
 * Срез редакции паспорта, по которой составлен план. План хранит его в себе
 * и не читает паспорт напрямую: старый план открывается с теми же данными (раздел 5).
 */
export interface PlanBasis {
  readonly edition: EditionRef
  readonly lines: ReadonlyMap<string, BasisLine>
  readonly stations: ReadonlyMap<string, BasisStation>
  /** Линейные участки (ПД), отмеченные действующими при импорте. */
  readonly pds: ReadonlyMap<string, BasisPd>
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
  /** ПД, к которому относится станция (форма «Станции → ПД»). */
  readonly pd: string | undefined
}

/** Линейный участок (ПД) и его границы на главных путях. */
export interface BasisPd {
  readonly id: string
  /** Обозначение для листов: «ПД-1». */
  readonly name: string
  /** ПЧУ, в который входит ПД. */
  readonly pchu: string
  readonly segments: readonly TrackSpan[]
}

/** Группа вида работ: строка какой таблицы плана. */
export type WorkGroup = 'current' | 'capital' | 'other'

/** Вид работ из нормативов редакции. */
export interface WorkKind {
  readonly code: string
  readonly name: string
  /** Единица объёма: «км», «шт», «компл», … */
  readonly unit: string
  readonly group: WorkGroup
  /** Показывать ли вид строкой в таблице плана. */
  readonly inPlanTable: boolean
  /** Код строки плана, в которую объём входит дополнительно (ППРК → ППР). */
  readonly includedIn?: string
}

export interface PlanBasisInput {
  readonly edition: EditionRef
  readonly lines: readonly BasisLine[]
  readonly stations: readonly BasisStation[]
  readonly pds: readonly BasisPd[]
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
  const pds = index(input.pds, (d) => d.id, 'pd')
  if (!pds.ok) return pds
  for (const line of input.lines) {
    if (line.extent.some((span) => span.line !== line.id))
      return err({ kind: 'extent-off-line', line: line.id })
  }
  const pdProblem = pdErrors(input.pds, lines.value)
  if (pdProblem) return err(pdProblem)
  for (const station of input.stations) {
    if (station.pd !== undefined && !pds.value.has(station.pd))
      return err({ kind: 'unknown-pd', station: station.id, pd: station.pd })
  }
  for (const kind of input.workKinds) {
    if (kind.includedIn === undefined) continue
    const target = workKinds.value.get(kind.includedIn)
    if (!target)
      return err({ kind: 'unknown-included-in', code: kind.code, includedIn: kind.includedIn })
    if (kind.code === target.code) return err({ kind: 'self-included-in', code: kind.code })
    if (kind.unit.trim() !== target.unit.trim())
      return err({
        kind: 'included-in-unit-mismatch',
        code: kind.code,
        includedIn: target.code,
        unit: kind.unit,
        targetUnit: target.unit,
      })
  }
  return ok({
    edition: input.edition,
    lines: lines.value,
    stations: stations.value,
    pds: pds.value,
    workKinds: workKinds.value,
  })
}

/** Любое перекрытие границ даёт двойной учёт длины, в том числе внутри одного ПД. */
function pdErrors(
  pds: readonly BasisPd[],
  lines: ReadonlyMap<string, BasisLine>,
): PlanError | undefined {
  const all = pds.flatMap((pd) => pd.segments.map((span) => ({ pd: pd.id, span })))
  const offLine = all.find(({ span }) => !lines.has(span.line))
  if (offLine) return { kind: 'pd-off-line', pd: offLine.pd, line: offLine.span.line }
  for (const [i, a] of all.entries()) {
    const b = all.slice(i + 1).find((x) => spansOverlap(x.span, a.span))
    if (b) return { kind: 'pd-overlap', a: a.pd, b: b.pd }
  }
  return undefined
}

/** Объём вида считается по длине участков только в километрах. */
export function measuredByLength(kind: WorkKind): boolean {
  return kind.unit.trim() === 'км'
}
