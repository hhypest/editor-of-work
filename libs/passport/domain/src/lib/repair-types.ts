import type { Chainage } from '@eow/shared/kernel'

export interface RepairPeriod {
  readonly validFrom: string | null
  readonly validTo: string | null
}
export interface RepairConditions {
  readonly trackClass: string | null
  readonly trackGroup: string | null
  readonly trackCategory: string | null
  readonly railType: string | null
  readonly sleeperType: string | null
}
export interface RepairNorm extends RepairPeriod, RepairConditions {
  readonly id: string
  readonly workCode: string
  readonly workName: string
  readonly years: number | null
  readonly millionTons: number | null
}
interface Segment extends RepairPeriod {
  readonly lineId: string
  readonly from: Chainage
  readonly to: Chainage
}
export type RepairSegment = Segment &
  (
    | {
        readonly form: 'class'
        readonly values: {
          readonly trackClass: string | null
          readonly group: string | null
          readonly category: string | null
        }
      }
    | {
        readonly form: 'rails'
        readonly values: {
          readonly railType: string | null
          readonly laidDate: string | null
          readonly tonnageAfter: number | null
        }
      }
    | { readonly form: 'sleepers'; readonly values: { readonly sleeperType: string | null } }
  )
export interface RepairSnapshot {
  readonly date: string
  readonly lines: readonly {
    readonly id: string
    readonly name: string
    readonly extents: readonly { readonly from: Chainage; readonly to: Chainage }[]
    readonly kmLengths: readonly (readonly [number, number])[]
  }[]
  readonly segments: readonly RepairSegment[]
  readonly tracks: readonly (RepairPeriod & {
    readonly station: string
    readonly number: string
    readonly lastRepairYear: number | null
    readonly classCode: string | null
    readonly railType: string | null
    readonly sleeperType: string | null
  })[]
  readonly norms: readonly RepairNorm[]
}
export interface RepairAssessment {
  readonly workCode: string | null
  readonly workName: string | null
  readonly normId: string | null
  readonly status: 'due' | 'planned' | 'incomplete' | 'no-norm' | 'ambiguous-norm'
  readonly dueYear: number | null
  /** При достигнутом тоннаже известен лишь год, не позднее которого нужен ремонт. */
  readonly yearIsUpperBound: boolean
  readonly overdueYears: number | null
  readonly overdueMillionTons: number | null
  readonly reason: string | null
}
export type RepairLocation =
  | {
      readonly kind: 'line'
      readonly lineId: string
      readonly lineName: string
      readonly from: Chainage
      readonly to: Chainage
      readonly lengthM: number
    }
  | { readonly kind: 'station'; readonly station: string; readonly track: string }
export interface RepairReportRow {
  readonly location: RepairLocation
  readonly lastRepairYear: number | null
  readonly tonnageAfter: number | null
  readonly assessments: readonly RepairAssessment[]
}
export interface RepairReport {
  readonly date: string
  readonly rows: readonly RepairReportRow[]
}
