import {
  createAnnualPlan,
  describePlanError,
  MAX_PLAN_YEAR,
  MIN_PLAN_YEAR,
  planBasis,
  type AnnualPlan,
  type PlanBasisInput,
} from '@eow/planning/domain'
import { err, ok, type Result } from '@eow/shared/kernel'

export interface PlanEditionChoice {
  readonly id: number
  readonly number: number
  readonly date: string
  readonly label: string
  readonly status: 'active' | 'archived'
}
export interface PlanCreationError {
  readonly message: string
}
/** Порт Планирования: адаптер читает согласованный срез Паспорта в main. */
export interface PassportView {
  editions(): Promise<Result<readonly PlanEditionChoice[], PlanCreationError>>
  basis(editionId: number): Promise<Result<PlanBasisInput, PlanCreationError>>
}

export async function createPlanFromPassport(
  passport: PassportView,
  editionId: number,
  year: number,
): Promise<Result<AnnualPlan, PlanCreationError>> {
  if (!Number.isInteger(year) || year < MIN_PLAN_YEAR || year > MAX_PLAN_YEAR)
    return err({
      message: `Год плана должен быть целым числом от ${MIN_PLAN_YEAR} до ${MAX_PLAN_YEAR}.`,
    })
  if (!Number.isSafeInteger(editionId) || editionId <= 0)
    return err({ message: 'Выберите введённую в действие редакцию паспорта.' })
  const source = await passport.basis(editionId)
  if (!source.ok) return source
  if (!source.value.lines.length || !source.value.workKinds.length)
    return err({ message: 'В редакции нужны направления и виды работ из шаблона ручных данных.' })
  const basis = planBasis(source.value)
  if (!basis.ok) return err({ message: describePlanError(basis.error) })
  const plan = createAnnualPlan(year, basis.value)
  return plan.ok ? ok(plan.value) : err({ message: plan.error.map(describePlanError).join('; ') })
}
