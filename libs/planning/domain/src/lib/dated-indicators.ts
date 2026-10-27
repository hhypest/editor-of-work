import { err, ok, type Result } from '@eow/shared/kernel'
import type { AnnualPlan } from './annual-plan'
import { areaExists, areaKey, areaLabel, type PlanArea } from './distribution'
import type { PlanError } from './plan-error'

/**
 * Строка таблицы «Показатели» листа: значение на 01.01 прошлого года плана
 * (previous) и на 01.01 года плана (current). Пустое значение (null) — не ноль.
 * Изменение и процент не хранятся: их считает лист.
 */
export interface DatedIndicator {
  readonly id: string
  readonly name: string
  readonly previous: number | null
  readonly current: number | null
}
export const MAX_AREA_DATED = 10000
const EMPTY: readonly DatedIndicator[] = Object.freeze([])

/** Таблица «Показатели» ведётся по дистанции и ПД, как в листах прототипа. */
export function datedAreaAllowed(area: PlanArea): boolean {
  return area.kind === 'district' || area.kind === 'pd'
}

export function datedIndicatorsOf(plan: AnnualPlan, area: PlanArea): readonly DatedIndicator[] {
  return plan.datedIndicators.get(areaKey(area)) ?? EMPTY
}

/** Изменение за год и процент; null — нельзя посчитать (нет значения или база ноль). */
export function datedChange(row: DatedIndicator): {
  readonly delta: number | null
  readonly percent: number | null
} {
  const { previous, current } = row
  if (previous === null || current === null) return { delta: null, percent: null }
  const delta = current - previous
  const percent = previous === 0 ? null : (delta / previous) * 100
  return {
    delta: Number.isFinite(delta) ? delta : null,
    percent: percent !== null && Number.isFinite(percent) ? percent : null,
  }
}

const finiteOrNull = (v: number | null) => v === null || Number.isFinite(v)
const normal = (v: number | null) => (v === 0 ? 0 : v)

function sameRows(a: readonly DatedIndicator[], b: readonly DatedIndicator[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => {
      const n = b[i]
      return (
        n !== undefined &&
        r.id === n.id &&
        r.name === n.name &&
        r.previous === n.previous &&
        r.current === n.current
      )
    })
  )
}

/** Полная замена одной области; при ошибке весь прежний пакет остаётся неизменным. */
export function setDatedIndicators(
  plan: AnnualPlan,
  area: PlanArea,
  rows: readonly DatedIndicator[],
): Result<AnnualPlan, readonly PlanError[]> {
  if (!areaExists(area, plan.basis)) return err([{ kind: 'unknown-area', area: areaLabel(area) }])
  if (!datedAreaAllowed(area)) return err([{ kind: 'invalid-dated', reason: 'area' }])
  if (rows.length > MAX_AREA_DATED) return err([{ kind: 'invalid-dated', reason: 'limit' }])
  const errors: PlanError[] = [],
    ids = new Set<string>()
  for (const row of rows) {
    if (!row.id.trim() || ids.has(row.id)) errors.push({ kind: 'invalid-dated', reason: 'id' })
    ids.add(row.id)
    if (!row.name.trim()) errors.push({ kind: 'invalid-dated', reason: 'name' })
    if (!finiteOrNull(row.previous) || !finiteOrNull(row.current))
      errors.push({ kind: 'invalid-dated', reason: 'value' })
  }
  if (errors.length) return err(errors)
  const next = rows.map((row) =>
    Object.freeze({
      id: row.id,
      name: row.name.trim(),
      previous: normal(row.previous),
      current: normal(row.current),
    }),
  )
  if (sameRows(datedIndicatorsOf(plan, area), next)) return ok(plan)
  const datedIndicators = new Map(plan.datedIndicators)
  if (next.length) datedIndicators.set(areaKey(area), Object.freeze(next))
  else datedIndicators.delete(areaKey(area))
  return ok({ ...plan, datedIndicators })
}
