import type { PlanStore, PlanStoreError } from '@eow/planning/application'
import type { AnnualPlan } from '@eow/planning/domain'

/** Таймер main. Восстановление применяется только по явному выбору пользователя. */
export function startPlanAutosave(
  store: Pick<PlanStore, 'autosave'>,
  current: () => AnnualPlan | undefined,
  onError: (error: PlanStoreError) => void,
): () => Promise<void> {
  let pending: Promise<void> | undefined
  const timer = setInterval(() => {
    const plan = current()
    if (!plan || pending) return
    pending = store
      .autosave(plan)
      .then((result) => {
        if (!result.ok) onError(result.error)
      })
      .catch(() => onError({ kind: 'io', message: 'Не удалось выполнить автосохранение плана.' }))
      .finally(() => {
        pending = undefined
      })
  }, 60_000)
  return async () => {
    clearInterval(timer)
    await pending
  }
}
