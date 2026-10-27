import {
  addWork,
  createAnnualPlan,
  describePlanError,
  planBasis,
  setExpectedIndicators,
  setManualValue,
  setPlanItems,
  workId,
  type ExpectedIndicator,
  type ItemTableKind,
  type PlanItem,
  type AnnualPlan,
  type Approval,
  type PlanArea,
  type PlanBasisInput,
  type PrototypeArchive,
  type WorkInput,
} from '@eow/planning/domain'
import { err, ok, type Result } from '@eow/shared/kernel'

/** Опубликованный вход планирования для адаптеров импорта: домен контекста скрыт. */
export interface ImportedPlanDraft {
  readonly year: number
  readonly approval: Approval
  readonly basis: PlanBasisInput
  readonly works: readonly (WorkInput & { readonly id: string })[]
  readonly manual: readonly {
    readonly area: PlanArea
    readonly field: 'overrides' | 'needs'
    readonly code: string
    readonly value: number
  }[]
  readonly expected: readonly {
    readonly area: PlanArea
    readonly rows: readonly ExpectedIndicator[]
  }[]
  readonly items: readonly {
    readonly area: PlanArea
    readonly table: ItemTableKind
    readonly rows: readonly PlanItem[]
  }[]
  readonly prototype: PrototypeArchive
}

export interface ImportProblem {
  readonly path: string
  readonly message: string
}

/** Всё или ничего: ошибочная работа не исчезает из проекта при импорте. */
export function buildImportedPlan(
  input: ImportedPlanDraft,
): Result<AnnualPlan, readonly ImportProblem[]> {
  const basis = planBasis(input.basis)
  if (!basis.ok) return err([{ path: 'basis', message: describePlanError(basis.error) }])
  const created = createAnnualPlan(input.year, basis.value, input.approval)
  if (!created.ok)
    return err(created.error.map((e) => ({ path: 'meta', message: describePlanError(e) })))
  let plan = created.value
  const errors: ImportProblem[] = []
  for (const [i, work] of input.works.entries()) {
    const next = addWork(plan, workId(work.id), work)
    if (!next.ok)
      errors.push(...next.error.map((e) => ({ path: `works.${i}`, message: describePlanError(e) })))
    else plan = next.value
  }
  for (const [i, cell] of input.manual.entries()) {
    const next = setManualValue(plan, cell.area, cell.field, cell.code, cell.value)
    if (!next.ok)
      errors.push(
        ...next.error.map((e) => ({ path: `tables.${i}`, message: describePlanError(e) })),
      )
    else plan = next.value
  }
  for (const [i, entry] of input.expected.entries()) {
    const next = setExpectedIndicators(plan, entry.area, entry.rows)
    if (!next.ok)
      errors.push(
        ...next.error.map((e) => ({ path: `expected.${i}`, message: describePlanError(e) })),
      )
    else plan = next.value
  }
  for (const [i, entry] of input.items.entries()) {
    const next = setPlanItems(plan, entry.area, entry.table, entry.rows)
    if (!next.ok)
      errors.push(...next.error.map((e) => ({ path: `items.${i}`, message: describePlanError(e) })))
    else plan = next.value
  }
  if (errors.length) return err(errors)
  return ok({
    ...plan,
    prototype: Object.freeze({
      source: input.prototype.source,
      report: Object.freeze(input.prototype.report.map((r) => Object.freeze({ ...r }))),
    }),
  })
}
