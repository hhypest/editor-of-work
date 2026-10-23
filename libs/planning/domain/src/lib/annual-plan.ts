import { err, ok, type Result } from '@eow/shared/kernel'
import { areaExists, areaKey, areaLabel, type PlanArea } from './distribution'
import type { PlanBasis } from './plan-basis'
import type { PlanError } from './plan-error'
import type { PlanIndicator } from './indicators'
import type { PdScale } from './pd-scale'
import type { PdTableKind } from './pd-tables'
import {
  ownWork,
  sameWorkInput,
  workErrors,
  type PlannedWork,
  type WorkId,
  type WorkInput,
} from './planned-work'

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
  /** Неизменённый JSON прототипа и отчёт: раскладка и прочие ещё не перенесённые поля. */
  readonly prototype?: PrototypeArchive
  readonly year: number
  readonly basis: PlanBasis
  readonly approval: Approval
  readonly works: readonly PlannedWork[]
  /** Значения, введённые вручную, по ключу области ({@link areaKey}). */
  readonly manual: ReadonlyMap<string, AreaManual>
  readonly indicators: ReadonlyMap<string, readonly PlanIndicator[]>
  readonly pdScales: ReadonlyMap<string, PdScale>
  readonly pdHiddenTables: ReadonlyMap<string, readonly PdTableKind[]>
}

export interface PrototypeArchive {
  readonly source: string
  readonly report: readonly { readonly path: string; readonly message: string }[]
}

/** Ручные значения таблиц одной области. Ключ — код вида работ. */
export interface AreaManual {
  /** Значение плана вместо рассчитанного. */
  readonly overrides: ReadonlyMap<string, number>
  /** Потребность (столбец таблицы текущего содержания). */
  readonly needs: ReadonlyMap<string, number>
}

const NO_MANUAL: AreaManual = { overrides: new Map(), needs: new Map() }

export function manualOf(plan: AnnualPlan, area: PlanArea): AreaManual {
  return plan.manual.get(areaKey(area)) ?? NO_MANUAL
}

export const MIN_PLAN_YEAR = 2000
export const MAX_PLAN_YEAR = 2100

function yearErrors(year: number): PlanError[] {
  return Number.isInteger(year) && year >= MIN_PLAN_YEAR && year <= MAX_PLAN_YEAR
    ? []
    : [{ kind: 'invalid-year', year }]
}

/** Гриф по умолчанию утверждается годом раньше, поэтому нижняя граница на год меньше. */
function approvalYearErrors(year: number): PlanError[] {
  return Number.isInteger(year) && year >= MIN_PLAN_YEAR - 1 && year <= MAX_PLAN_YEAR
    ? []
    : [{ kind: 'invalid-approval-year', year }]
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
  const checked = failIfAny([...yearErrors(year), ...approvalYearErrors(approval.year)])
  if (!checked.ok) return checked
  return ok({
    year,
    basis,
    approval: Object.freeze({ ...approval }),
    works: [],
    manual: new Map(),
    indicators: new Map(),
    pdScales: new Map(),
    pdHiddenTables: new Map(),
  })
}

export function setApproval(
  plan: AnnualPlan,
  approval: Approval,
): Result<AnnualPlan, readonly PlanError[]> {
  const checked = failIfAny(approvalYearErrors(approval.year))
  if (!checked.ok) return checked
  const same =
    approval.title === plan.approval.title &&
    approval.name === plan.approval.name &&
    approval.year === plan.approval.year
  return ok(same ? plan : { ...plan, approval: Object.freeze({ ...approval }) })
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
  return ok({ ...plan, works: [...plan.works, ownWork(id, input)] })
}

/** Заменить данные работы; место работы в списке не меняется. */
export function updateWork(
  plan: AnnualPlan,
  id: WorkId,
  input: WorkInput,
): Result<AnnualPlan, readonly PlanError[]> {
  const index = plan.works.findIndex((w) => w.id === id)
  const current = plan.works[index]
  if (!current) return err([{ kind: 'work-not-found', id }])
  const checked = failIfAny(workErrors(input, plan.basis))
  if (!checked.ok) return checked
  // Та же версия плана, если ничего не изменилось: история не сбросит повтор.
  if (sameWorkInput(current, input)) return ok(plan)
  return ok({ ...plan, works: plan.works.with(index, ownWork(id, input)) })
}

export function removeWork(plan: AnnualPlan, id: WorkId): Result<AnnualPlan, readonly PlanError[]> {
  if (!findWork(plan, id)) return err([{ kind: 'work-not-found', id }])
  return ok({ ...plan, works: plan.works.filter((w) => w.id !== id) })
}

function withEntry(
  map: ReadonlyMap<string, number>,
  key: string,
  value: number | undefined,
): ReadonlyMap<string, number> {
  const next = new Map(map)
  if (value === undefined) next.delete(key)
  else next.set(key, value)
  return next
}

/**
 * Записать или стереть (undefined) ручное значение: field «overrides» — план вместо
 * расчёта, «needs» — потребность. Значение переживает пересчёт: расчёт его не трогает.
 */
export function setManualValue(
  plan: AnnualPlan,
  area: PlanArea,
  field: keyof AreaManual,
  code: string,
  value: number | undefined,
): Result<AnnualPlan, readonly PlanError[]> {
  const errors: PlanError[] = []
  if (!areaExists(area, plan.basis)) errors.push({ kind: 'unknown-area', area: areaLabel(area) })
  if (!plan.basis.workKinds.has(code)) errors.push({ kind: 'unknown-work-kind', code })
  if (value !== undefined && !(Number.isFinite(value) && value >= 0))
    errors.push({ kind: 'invalid-manual-value', value })
  const checked = failIfAny(errors)
  if (!checked.ok) return checked
  const current = manualOf(plan, area)
  if (Object.is(current[field].get(code), value)) return ok(plan)
  const updated: AreaManual = { ...current, [field]: withEntry(current[field], code, value) }
  const manual = new Map(plan.manual)
  manual.set(areaKey(area), updated)
  return ok({ ...plan, manual })
}
