import { err, ok, type Result } from '@eow/shared/kernel'
import type { AnnualPlan } from './annual-plan'
import { areaExists, areaKey, areaLabel, type PlanArea } from './distribution'
import type { PlanError } from './plan-error'

/**
 * Перечни работ дистанции и ПД с объёмом и стоимостью, как в листах прототипа:
 * работы подрядным способом, по содержанию ИССО и земляного полотна.
 */
export const ITEM_TABLE_KINDS = Object.freeze(['contract', 'isso', 'zp'] as const)
export type ItemTableKind = (typeof ITEM_TABLE_KINDS)[number]
export const ITEM_TABLE_TITLES: Readonly<Record<ItemTableKind, string>> = Object.freeze({
  contract: 'Работы подрядным способом',
  isso: 'Работы по содержанию ИССО',
  zp: 'Работы по содержанию земляного полотна',
})

/** Строка перечня: объём в единице строки, стоимость в тыс. руб.; оба не отрицательны. */
export interface PlanItem {
  readonly id: string
  readonly name: string
  readonly unit: string
  readonly quantity: number
  readonly cost: number
}
export const MAX_AREA_ITEMS = 10000
const EMPTY: readonly PlanItem[] = Object.freeze([])

/** Ключ перечня в плане: «contract|district», «isso|pd:ПД-1». */
export function itemTableKey(area: PlanArea, kind: ItemTableKind): string {
  return `${kind}|${areaKey(area)}`
}
export function itemAreaAllowed(area: PlanArea): boolean {
  return area.kind === 'district' || area.kind === 'pd'
}
export function itemsOf(
  plan: AnnualPlan,
  area: PlanArea,
  kind: ItemTableKind,
): readonly PlanItem[] {
  return plan.itemTables.get(itemTableKey(area, kind)) ?? EMPTY
}
/** Строки, которые выводятся на лист: с ненулевым объёмом или стоимостью. */
export function printedItems(rows: readonly PlanItem[]): readonly PlanItem[] {
  return rows.filter((r) => r.quantity !== 0 || r.cost !== 0)
}

/** Полная замена перечня одной области; при ошибке прежний перечень остаётся. */
export function setPlanItems(
  plan: AnnualPlan,
  area: PlanArea,
  kind: ItemTableKind,
  rows: readonly PlanItem[],
): Result<AnnualPlan, readonly PlanError[]> {
  if (!ITEM_TABLE_KINDS.includes(kind)) return err([{ kind: 'invalid-item', reason: 'kind' }])
  if (!areaExists(area, plan.basis)) return err([{ kind: 'unknown-area', area: areaLabel(area) }])
  if (!itemAreaAllowed(area)) return err([{ kind: 'invalid-item', reason: 'area' }])
  if (rows.length > MAX_AREA_ITEMS) return err([{ kind: 'invalid-item', reason: 'limit' }])
  const errors: PlanError[] = [],
    ids = new Set<string>()
  for (const row of rows) {
    if (!row.id.trim() || ids.has(row.id)) errors.push({ kind: 'invalid-item', reason: 'id' })
    ids.add(row.id)
    if (!row.name.trim()) errors.push({ kind: 'invalid-item', reason: 'name' })
    if (!Number.isFinite(row.quantity) || row.quantity < 0)
      errors.push({ kind: 'invalid-item', reason: 'quantity' })
    if (!Number.isFinite(row.cost) || row.cost < 0)
      errors.push({ kind: 'invalid-item', reason: 'cost' })
  }
  if (errors.length) return err(errors)
  const next = rows.map((row) =>
    Object.freeze({
      id: row.id,
      name: row.name.trim(),
      unit: row.unit.trim(),
      quantity: row.quantity === 0 ? 0 : row.quantity,
      cost: row.cost === 0 ? 0 : row.cost,
    }),
  )
  const current = itemsOf(plan, area, kind)
  if (
    current.length === next.length &&
    current.every((r, i) => {
      const n = next[i]
      return (
        n !== undefined &&
        r.id === n.id &&
        r.name === n.name &&
        r.unit === n.unit &&
        r.quantity === n.quantity &&
        r.cost === n.cost
      )
    })
  )
    return ok(plan)
  const itemTables = new Map(plan.itemTables)
  if (next.length) itemTables.set(itemTableKey(area, kind), Object.freeze(next))
  else itemTables.delete(itemTableKey(area, kind))
  return ok({ ...plan, itemTables })
}
