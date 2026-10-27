import { err, ok, type Result } from '@eow/shared/kernel'
import type { AnnualPlan } from './annual-plan'
import type { PlanError } from './plan-error'
export const PD_TABLE_KINDS = Object.freeze([
  'current',
  'capital',
  'other',
  'summary',
  'works',
  'indicators',
  'expected',
] as const)
export type PdTableKind = (typeof PD_TABLE_KINDS)[number]
const EMPTY: readonly PdTableKind[] = Object.freeze([])
export function hiddenPdTablesOf(plan: AnnualPlan, pd: string): readonly PdTableKind[] {
  return plan.pdHiddenTables.get(pd) ?? EMPTY
}
export function setPdHiddenTables(
  plan: AnnualPlan,
  pd: string,
  hidden: readonly string[],
): Result<AnnualPlan, readonly PlanError[]> {
  if (!plan.basis.pds.has(pd)) return err([{ kind: 'unknown-area', area: `ПД «${pd}»` }])
  if (hidden.some((key) => !PD_TABLE_KINDS.some((known) => known === key)))
    return err([{ kind: 'invalid-pd-tables', reason: 'key' }])
  if (new Set(hidden).size !== hidden.length)
    return err([{ kind: 'invalid-pd-tables', reason: 'duplicate' }])
  const next = PD_TABLE_KINDS.filter((key) => hidden.includes(key))
  const current = hiddenPdTablesOf(plan, pd)
  if (next.length === current.length && next.every((key, i) => key === current[i])) return ok(plan)
  const pdHiddenTables = new Map(plan.pdHiddenTables)
  if (next.length) pdHiddenTables.set(pd, Object.freeze(next))
  else pdHiddenTables.delete(pd)
  return ok({ ...plan, pdHiddenTables })
}
