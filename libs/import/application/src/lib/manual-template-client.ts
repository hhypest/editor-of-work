import type { Result } from '@eow/shared/kernel'

export interface ManualTemplateEdition {
  readonly id: number
  readonly number: number
  readonly date: string
  readonly label: string
  readonly status: 'draft' | 'active' | 'archived'
}
export interface ManualTemplateReview {
  readonly token: string
  readonly editionId: number
  readonly fileName: string
  readonly changes: readonly {
    readonly sheet: string
    readonly added: number
    readonly changed: number
    readonly removed: number
  }[]
}
export type ManualTemplateAction =
  | { readonly action: 'export' | 'prepare'; readonly editionId: number }
  | { readonly action: 'apply' | 'discard'; readonly editionId: number; readonly token: string }
export type ManualTemplateOutcome =
  | { readonly status: 'exported' | 'applied' | 'cancelled' | 'discarded' }
  | { readonly status: 'preview'; readonly review: ManualTemplateReview }
  | { readonly status: 'error'; readonly message: string }
export interface ManualTemplateClient {
  list(): Promise<Result<readonly ManualTemplateEdition[], { readonly message: string }>>
  run(action: ManualTemplateAction): Promise<ManualTemplateOutcome>
}
