import { err, ok, type Result } from '@eow/shared/kernel'
import type { AnnualPlan } from './annual-plan'
import { areaExists, areaKey, areaLabel, type PlanArea } from './distribution'
import type { PlanError } from './plan-error'

/**
 * Строка таблицы «Ожидаемые показатели на 01.01 следующего года».
 * group — показатель, name — его составляющая («в т.ч.»), может быть пустой.
 * Значение не задано (null) — это не ноль: строка-заголовок группы печатается без числа.
 */
export interface ExpectedIndicator {
  readonly id: string
  readonly group: string
  readonly name: string
  readonly unit: string
  readonly value: number | null
}
export const MAX_AREA_EXPECTED = 10000
const EMPTY: readonly ExpectedIndicator[] = Object.freeze([])

/** Ожидаемые показатели ведутся по дистанции и ПД, как в листах прототипа. */
export function expectedAreaAllowed(area: PlanArea): boolean {
  return area.kind === 'district' || area.kind === 'pd'
}

export function expectedIndicatorsOf(
  plan: AnnualPlan,
  area: PlanArea,
): readonly ExpectedIndicator[] {
  return plan.expectedIndicators.get(areaKey(area)) ?? EMPTY
}

function sameRows(a: readonly ExpectedIndicator[], b: readonly ExpectedIndicator[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => {
      const n = b[i]
      return (
        n !== undefined &&
        r.id === n.id &&
        r.group === n.group &&
        r.name === n.name &&
        r.unit === n.unit &&
        r.value === n.value
      )
    })
  )
}

/** Полная замена одной области; при ошибке весь прежний пакет остаётся неизменным. */
export function setExpectedIndicators(
  plan: AnnualPlan,
  area: PlanArea,
  rows: readonly ExpectedIndicator[],
): Result<AnnualPlan, readonly PlanError[]> {
  if (!areaExists(area, plan.basis)) return err([{ kind: 'unknown-area', area: areaLabel(area) }])
  if (!expectedAreaAllowed(area)) return err([{ kind: 'invalid-expected', reason: 'area' }])
  if (rows.length > MAX_AREA_EXPECTED) return err([{ kind: 'invalid-expected', reason: 'limit' }])
  const errors: PlanError[] = [],
    ids = new Set<string>()
  for (const row of rows) {
    if (!row.id.trim() || ids.has(row.id)) errors.push({ kind: 'invalid-expected', reason: 'id' })
    ids.add(row.id)
    if (!row.group.trim()) errors.push({ kind: 'invalid-expected', reason: 'group' })
    if (row.value !== null && !Number.isFinite(row.value))
      errors.push({ kind: 'invalid-expected', reason: 'value' })
  }
  if (errors.length) return err(errors)
  const next = rows.map((row) =>
    Object.freeze({
      id: row.id,
      group: row.group.trim(),
      name: row.name.trim(),
      unit: row.unit.trim(),
      value: row.value === 0 ? 0 : row.value,
    }),
  )
  if (sameRows(expectedIndicatorsOf(plan, area), next)) return ok(plan)
  const expectedIndicators = new Map(plan.expectedIndicators)
  if (next.length) expectedIndicators.set(areaKey(area), Object.freeze(next))
  else expectedIndicators.delete(areaKey(area))
  return ok({ ...plan, expectedIndicators })
}
