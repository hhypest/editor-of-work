import { err, ok, type Result } from '@eow/shared/kernel'
import { buildPdSheets, type EditorSheetClient } from './pd-layout'
import type { PdfBatchClient, PdfBatchMode, PdfOutcome } from './pdf-exporter'
import type { SheetError, TextMeasurer } from './sheet-model'

export interface PdfBatchProgress {
  /** prepare — раскладка и передача листов ПД, print — печать общего файла. */
  readonly phase: 'prepare' | 'print'
  readonly pd: string | null
  readonly done: number
  readonly total: number
  readonly pages: number
}
export interface PdfBatchInput {
  readonly client: PdfBatchClient
  readonly sheets: EditorSheetClient
  readonly measurer: TextMeasurer
  readonly revision: number
  readonly mode: PdfBatchMode
  /** ID ПД в порядке вывода; названия берутся из среза плана. */
  readonly pds: readonly string[]
  readonly progress: (step: PdfBatchProgress) => void
  /** Проверяется между ПД: остановка не прерывает уже начатую печать файла. */
  readonly stopped: () => boolean
}
export interface PdfBatchResult {
  readonly outcome: PdfOutcome
  /** Файлов, записанных до остановки или ошибки (режим «папка»). */
  readonly files: number
  readonly pages: number
}

/**
 * Пакетный PDF листов ПД (ADR-0039): каждый ПД раскладывается тем же кодом, что
 * предпросмотр, в масштабе, сохранённом в плане, и передаётся в main по ревизии.
 * Ошибка или остановка отменяют задание: в режиме «файл» ничего не записывается.
 */
export async function exportPdBatch(
  input: PdfBatchInput,
): Promise<Result<PdfBatchResult, SheetError & { readonly files: number }>> {
  const { client, revision, pds } = input
  if (!pds.length) return err({ message: 'Нет ПД для PDF.', files: 0 })
  const started = await client.start(revision, input.mode, pds)
  if (!started.ok) return err({ ...started.error, files: 0 })
  if (started.value === 'cancelled') return ok({ outcome: 'cancelled', files: 0, pages: 0 })
  const { job } = started.value
  let done = 0,
    pages = 0
  const files = () => (input.mode === 'folder' ? done : 0)
  const fail = async (error: SheetError) => {
    await client.cancel(job)
    return err({ ...error, files: files() })
  }
  for (const pd of pds) {
    if (input.stopped()) {
      await client.cancel(job)
      return ok({ outcome: 'cancelled', files: files(), pages })
    }
    input.progress({ phase: 'prepare', pd, done, total: pds.length, pages })
    const source = await input.sheets.source(revision, pd)
    if (!source.ok) return fail(source.error)
    const scale = source.value.pds.find((p) => p.id === pd)?.scale ?? 50000
    const sheets = buildPdSheets(source.value, pd, scale, input.measurer)
    if (!sheets.ok) return fail(sheets.error)
    const added = await client.add(job, revision, pd, sheets.value.pages)
    if (!added.ok) return fail(added.error)
    done++
    pages += sheets.value.pages.length
  }
  if (input.stopped()) {
    await client.cancel(job)
    return ok({ outcome: 'cancelled', files: files(), pages })
  }
  input.progress({ phase: 'print', pd: null, done, total: pds.length, pages })
  const finished = await client.finish(job, revision)
  if (!finished.ok) return err({ ...finished.error, files: files() })
  return ok({ outcome: 'saved', files: input.mode === 'folder' ? done : 1, pages })
}
