import { err, ok, type Result } from '@eow/shared/kernel'
import type { AnnualPlan } from './annual-plan'
import type { PlanError } from './plan-error'
export type PdScale = 25000 | 50000 | 100000
export const DEFAULT_PD_SCALE: PdScale = 50000
export function isPdScale(value: number): value is PdScale {
  return value === 25000 || value === 50000 || value === 100000
}
export function pdScaleOf(plan: AnnualPlan, pd: string): PdScale {
  return plan.pdScales.get(pd) ?? DEFAULT_PD_SCALE
}
export function setPdScale(
  plan: AnnualPlan,
  pd: string,
  scale: number,
): Result<AnnualPlan, readonly PlanError[]> {
  if (!plan.basis.pds.has(pd)) return err([{ kind: 'unknown-area', area: `ПД «${pd}»` }])
  if (!isPdScale(scale)) return err([{ kind: 'invalid-pd-scale' }])
  if (pdScaleOf(plan, pd) === scale) return ok(plan)
  const pdScales = new Map(plan.pdScales)
  if (scale === DEFAULT_PD_SCALE) pdScales.delete(pd)
  else pdScales.set(pd, scale)
  return ok({ ...plan, pdScales })
}
