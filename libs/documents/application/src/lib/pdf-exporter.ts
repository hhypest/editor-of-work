import type { Result } from '@eow/shared/kernel'
import type { SheetError, SheetPage } from './sheet-model'

/** Готовая модель листа: zoom просмотра в неё не входит. */
export interface EditorPdfRequest {
  readonly revision: number
  readonly pd: string
  readonly page: SheetPage
}
export type PdfOutcome = 'saved' | 'cancelled'
export interface EditorPdfClient {
  export(request: EditorPdfRequest): Promise<Result<PdfOutcome, SheetError>>
}
/** Main выбирает путь, печатает и атомарно записывает один лист. */
export interface PdfExporter {
  export(page: SheetPage): Promise<Result<PdfOutcome, SheetError>>
}
