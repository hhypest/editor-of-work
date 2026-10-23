import { err, ok, type Result } from '@eow/shared/kernel'
import type { AnnualPlan } from './annual-plan'
import { areaExists, areaKey, areaLabel, type PlanArea } from './distribution'
import type { PlanError } from './plan-error'

/** Ручной показатель: единицу и смысл задаёт составитель, автоматических итогов нет. */
export interface PlanIndicator {
  readonly id: string
  readonly name: string
  readonly unit: string
  readonly value: number
  readonly note: string
}
export const MAX_AREA_INDICATORS = 10000
const EMPTY: readonly PlanIndicator[] = Object.freeze([])
export function indicatorsOf(plan: AnnualPlan, area: PlanArea): readonly PlanIndicator[] {
  return plan.indicators.get(areaKey(area)) ?? EMPTY
}

/** Полная замена одной области; при ошибке весь прежний пакет остаётся неизменным. */
export function setPlanIndicators(
  plan: AnnualPlan,
  area: PlanArea,
  rows: readonly PlanIndicator[],
): Result<AnnualPlan, readonly PlanError[]> {
  if (!areaExists(area, plan.basis)) return err([{ kind: 'unknown-area', area: areaLabel(area) }])
  if (rows.length > MAX_AREA_INDICATORS)
    return err([{ kind: 'invalid-indicator', reason: 'limit' }])
  const errors: PlanError[] = [],
    ids = new Set<string>()
  for (const row of rows) {
    if (!row.id.trim() || ids.has(row.id)) errors.push({ kind: 'invalid-indicator', reason: 'id' })
    ids.add(row.id)
    if (!row.name.trim()) errors.push({ kind: 'invalid-indicator', reason: 'name' })
    if (!Number.isFinite(row.value)) errors.push({ kind: 'invalid-indicator', reason: 'value' })
  }
  if (errors.length) return err(errors)
  const next = rows.map((row) =>
    Object.freeze({
      ...row,
      name: row.name.trim(),
      unit: row.unit.trim(),
      value: row.value === 0 ? 0 : row.value,
    }),
  )
  const current = indicatorsOf(plan, area)
  if (
    current.length === next.length &&
    current.every((r, i) => {
      const n = next[i]
      return (
        n !== undefined &&
        r.id === n.id &&
        r.name === n.name &&
        r.unit === n.unit &&
        r.value === n.value &&
        r.note === n.note
      )
    })
  )
    return ok(plan)
  const indicators = new Map(plan.indicators)
  if (next.length) indicators.set(areaKey(area), Object.freeze(next))
  else indicators.delete(areaKey(area))
  return ok({ ...plan, indicators })
}
