import type { ManualTemplateClient } from './manual-template-client'
import type { SubdivisionChoice } from './org-structure'

export type ExportGroup = 'org' | 'segments' | 'stations'
export interface ExportFileSummary {
  readonly name: string
  readonly form: string
  readonly rows: number
}
export interface ExportReview {
  readonly token: string
  readonly editionId: number
  readonly group: ExportGroup
  readonly files: readonly ExportFileSummary[]
  readonly previousRows: number
  readonly incomingRows: number
  readonly remarks: readonly string[]
  readonly exclusionCandidates: readonly string[]
}
export type ExportWizardAction =
  | { readonly action: 'choose'; readonly editionId: number; readonly group: ExportGroup }
  | {
      readonly action: 'review'
      readonly editionId: number
      readonly token: string
      readonly selected: readonly string[]
    }
  | { readonly action: 'apply' | 'discard'; readonly editionId: number; readonly token: string }
export type ExportWizardOutcome =
  | { readonly status: 'cancelled' | 'applied' | 'discarded' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'choices'
      readonly token: string
      readonly editionId: number
      readonly choices: readonly SubdivisionChoice[]
    }
  | { readonly status: 'preview'; readonly review: ExportReview }
export interface ExportWizardClient {
  list: ManualTemplateClient['list']
  run(request: ExportWizardAction): Promise<ExportWizardOutcome>
}
