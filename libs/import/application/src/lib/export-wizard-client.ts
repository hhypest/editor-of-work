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
/** Ход долгой операции мастера (ADR-0044): чтение и разбор файлов, проверка, запись. */
export interface ExportProgress {
  readonly stage: 'reading' | 'parsing' | 'checking' | 'saving'
  /** Сколько файлов этапа обработано и сколько всего; для проверки и записи — 0 из 0. */
  readonly done: number
  readonly total: number
  /** Файл, который обрабатывается сейчас. */
  readonly file: string | null
  /** Остановить можно до записи: чтение, разбор и проверку. Запись — одна транзакция. */
  readonly cancellable: boolean
  readonly cancelling: boolean
}
/**
 * Шаг чтения выгрузок: вызывается перед каждым файлом. Может выбросить исключение отмены;
 * возвращает обещание, чтобы main успел ответить на запросы хода между файлами.
 */
export type ExportStep = (done: number, total: number, file: string) => Promise<void>
export interface ExportWizardClient {
  list: ManualTemplateClient['list']
  run(request: ExportWizardAction): Promise<ExportWizardOutcome>
  /** Ход текущей операции или null, если мастер ничего не выполняет. */
  progress(): Promise<ExportProgress | null>
  /** Просит остановить подготовку импорта после текущего файла. */
  cancel(): Promise<void>
}
