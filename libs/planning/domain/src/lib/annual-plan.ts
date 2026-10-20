import { err, ok, type Result } from '@eow/shared/kernel'
import type { PlanBasis } from './plan-basis'
import type { PlanError } from './plan-error'
import { workErrors, type PlannedWork, type WorkId, type WorkInput } from './planned-work'

/** Гриф «Утверждаю» на листах. */
export interface Approval {
  /** Должность: «Начальник дистанции». */
  readonly title: string
  readonly name: string
  /** Год в строке даты утверждения. */
  readonly year: number
}

/**
 * Годовой план: год, срез редакции паспорта, гриф и работы.
 * Состояние неизменяемое: каждая операция возвращает новую версию, а неизменённые
 * работы переходят в неё теми же объектами — на этом держится история отмены.
 */
export interface AnnualPlan {
  readonly year: number
  readonly basis: PlanBasis
  readonly approval: Approval
  readonly works: readonly PlannedWork[]
}

export const MIN_PLAN_YEAR = 2000
export const MAX_PLAN_YEAR = 2100

function yearErrors(year: number): PlanError[] {
  return Number.isInteger(year) && year >= MIN_PLAN_YEAR && year <= MAX_PLAN_YEAR
    ? []
    : [{ kind: 'invalid-year', year }]
}

function failIfAny(errors: readonly PlanError[]): Result<void, readonly PlanError[]> {
  return errors.length > 0 ? err(errors) : ok(undefined)
}

/** Новый план без работ. Гриф по умолчанию — без должности и ФИО, утверждается годом раньше. */
export function createAnnualPlan(
  year: number,
  basis: PlanBasis,
  approval: Approval = { title: '', name: '', year: year - 1 },
): Result<AnnualPlan, readonly PlanError[]> {
  const checked = failIfAny([...yearErrors(year), ...yearErrors(approval.year)])
  if (!checked.ok) return checked
  return ok({ year, basis, approval, works: [] })
}

export function setApproval(
  plan: AnnualPlan,
  approval: Approval,
): Result<AnnualPlan, readonly PlanError[]> {
  const checked = failIfAny(yearErrors(approval.year))
  return checked.ok ? ok({ ...plan, approval }) : checked
}

export function findWork(plan: AnnualPlan, id: WorkId): PlannedWork | undefined {
  return plan.works.find((w) => w.id === id)
}

/** Добавить работу в конец плана. */
export function addWork(
  plan: AnnualPlan,
  id: WorkId,
  input: WorkInput,
): Result<AnnualPlan, readonly PlanError[]> {
  if (findWork(plan, id)) return err([{ kind: 'duplicate-work', id }])
  const checked = failIfAny(workErrors(input, plan.basis))
  if (!checked.ok) return checked
  return ok({ ...plan, works: [...plan.works, { ...input, id }] })
}

/** Заменить данные работы; место работы в списке не меняется. */
export function updateWork(
  plan: AnnualPlan,
  id: WorkId,
  input: WorkInput,
): Result<AnnualPlan, readonly PlanError[]> {
  const index = plan.works.findIndex((w) => w.id === id)
  if (index < 0) return err([{ kind: 'work-not-found', id }])
  const checked = failIfAny(workErrors(input, plan.basis))
  if (!checked.ok) return checked
  return ok({ ...plan, works: plan.works.with(index, { ...input, id }) })
}

export function removeWork(plan: AnnualPlan, id: WorkId): Result<AnnualPlan, readonly PlanError[]> {
  if (!findWork(plan, id)) return err([{ kind: 'work-not-found', id }])
  return ok({ ...plan, works: plan.works.filter((w) => w.id !== id) })
}
