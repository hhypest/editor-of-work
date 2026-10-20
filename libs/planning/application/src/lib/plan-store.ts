import type { AnnualPlan } from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'

export interface PlanStoreError {
  readonly kind: 'invalid-file' | 'future-version' | 'io'
  readonly message: string
}

/** Хранилище одного файла, выбранного в main через системный диалог. */
export interface PlanStore {
  load(): Promise<Result<AnnualPlan, PlanStoreError>>
  save(plan: AnnualPlan): Promise<Result<void, PlanStoreError>>
  autosave(plan: AnnualPlan): Promise<Result<void, PlanStoreError>>
  recovery(): Promise<Result<AnnualPlan | undefined, PlanStoreError>>
  discardRecovery(): Promise<Result<void, PlanStoreError>>
}
