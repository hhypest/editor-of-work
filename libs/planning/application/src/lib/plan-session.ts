import {
  canRedo,
  canUndo,
  commit,
  endGroup,
  err,
  historyOf,
  ok,
  parsePlaceSpec,
  redo,
  undo,
  type CommitOptions,
  type History,
  type IdGenerator,
  type PlaceSpecError,
  type Result,
} from '@eow/shared/kernel'
import {
  addWork,
  removeWork,
  setManualValue,
  updateWork,
  workId,
  type AnnualPlan,
  type AreaManual,
  type PlanArea,
  type PlanError,
  type StationObject,
  type WorkId,
  type WorkInput,
  type WorkPlace,
} from '@eow/planning/domain'

/** Открытый план с историей отмены. */
export type PlanSession = History<AnnualPlan>

export function openPlanSession(plan: AnnualPlan): PlanSession {
  return historyOf(plan)
}

/** Место в том виде, в каком его вводит пользователь. */
export type PlaceCommand =
  | { readonly kind: 'line'; readonly line: string; readonly text: string }
  | { readonly kind: 'station'; readonly station: string; readonly object?: StationObject }

export interface WorkCommand {
  readonly kind: string
  readonly place: PlaceCommand
  readonly volume: number | undefined
  readonly note: string
  readonly callout: boolean
}

/** Ошибки ввода работы: в тексте места (с позициями) или в правилах плана. */
export type WorkCommandError =
  | { readonly kind: 'place'; readonly errors: readonly PlaceSpecError[] }
  | { readonly kind: 'plan'; readonly errors: readonly PlanError[] }

function planError(errors: readonly PlanError[]): WorkCommandError {
  return { kind: 'plan', errors }
}

function resolvePlace(place: PlaceCommand, plan: AnnualPlan): Result<WorkPlace, WorkCommandError> {
  if (place.kind === 'station') return ok(place)
  const line = plan.basis.lines.get(place.line)
  if (!line) return err(planError([{ kind: 'unknown-line', line: place.line }]))
  const spec = parsePlaceSpec(place.text, line.id, line.kmLengths)
  return spec.ok
    ? ok({ kind: 'line', spec: spec.value })
    : err({ kind: 'place', errors: spec.error })
}

function toInput(command: WorkCommand, plan: AnnualPlan): Result<WorkInput, WorkCommandError> {
  const place = resolvePlace(command.place, plan)
  if (!place.ok) return place
  return ok({
    kind: command.kind,
    place: place.value,
    volume: command.volume,
    note: command.note,
    callout: command.callout,
  })
}

function applied(
  session: PlanSession,
  next: Result<AnnualPlan, readonly PlanError[]>,
  options?: CommitOptions,
): Result<PlanSession, WorkCommandError> {
  return next.ok ? ok(commit(session, next.value, options)) : err(planError(next.error))
}

/** Добавить работу. Новый идентификатор выдаёт генератор. */
export function addWorkToPlan(
  session: PlanSession,
  command: WorkCommand,
  ids: IdGenerator,
): Result<{ readonly session: PlanSession; readonly id: WorkId }, WorkCommandError> {
  const input = toInput(command, session.present)
  if (!input.ok) return input
  const id = workId(ids.next())
  const next = applied(endGroup(session), addWork(session.present, id, input.value))
  return next.ok ? ok({ session: next.value, id }) : next
}

/**
 * Изменить работу. Правки с одним ключом группы подряд (набор текста в поле,
 * перетаскивание) отменяются одним шагом.
 */
export function editWork(
  session: PlanSession,
  id: WorkId,
  command: WorkCommand,
  options?: CommitOptions,
): Result<PlanSession, WorkCommandError> {
  const input = toInput(command, session.present)
  if (!input.ok) return input
  return applied(session, updateWork(session.present, id, input.value), options)
}

export function removeWorkFromPlan(
  session: PlanSession,
  id: WorkId,
): Result<PlanSession, WorkCommandError> {
  return applied(endGroup(session), removeWork(session.present, id))
}

/**
 * Ввести или стереть ручное значение таблицы области: план вместо расчёта
 * («overrides») или потребность («needs»). Ввод в одну ячейку подряд — один шаг отмены.
 */
export function setPlanValue(
  session: PlanSession,
  area: PlanArea,
  field: keyof AreaManual,
  code: string,
  value: number | undefined,
  options?: CommitOptions,
): Result<PlanSession, WorkCommandError> {
  return applied(session, setManualValue(session.present, area, field, code, value), options)
}

/** Закончить группу правок: например, поле ввода потеряло фокус или кнопка мыши отпущена. */
export const finishEditing = endGroup<AnnualPlan>

export const undoPlan = undo<AnnualPlan>
export const redoPlan = redo<AnnualPlan>
export const canUndoPlan = canUndo<AnnualPlan>
export const canRedoPlan = canRedo<AnnualPlan>
