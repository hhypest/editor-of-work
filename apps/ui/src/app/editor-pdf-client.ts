import { pdfSheetSchema, type EowApi } from '@eow/ipc/contracts'
import type { EditorPdfClient, PdfBatchClient } from '@eow/documents/application'
import { err, ok } from '@eow/shared/kernel'

export function editorPdfClient(api: Pick<EowApi, 'planFile'> | undefined): EditorPdfClient {
  return {
    async export(request) {
      if (!api) return err({ message: 'PDF доступен в настольной программе editor-of-work.' })
      const result = await api.planFile({
        action: 'exportEditorSheet',
        ...request,
        page: pdfSheetSchema.parse(request.page),
      })
      if (result.status === 'pdf') return ok(result.result)
      return err({
        message: result.status === 'error' ? result.message : 'Не удалось сохранить PDF.',
      })
    },
  }
}

/** Пакетный PDF листов ПД: шаги задания main (ADR-0039). */
export function editorPdfBatchClient(api: Pick<EowApi, 'planFile'> | undefined): PdfBatchClient {
  const unavailable = () => err({ message: 'PDF доступен в настольной программе editor-of-work.' })
  const failure = (result: { status: string; message?: string }) =>
    err({
      message:
        result.status === 'error' && result.message ? result.message : 'Не удалось сохранить PDF.',
    })
  return {
    async start(revision, mode, pds) {
      if (!api) return unavailable()
      const result = await api.planFile({ action: 'pdfBatchStart', revision, mode, pds: [...pds] })
      if (result.status === 'cancelled') return ok('cancelled' as const)
      if (result.status === 'pdfBatch') return ok({ job: result.job, total: result.total })
      return failure(result)
    },
    async add(job, revision, pd, pages) {
      if (!api) return unavailable()
      const result = await api.planFile({
        action: 'pdfBatchAdd',
        job,
        revision,
        pd,
        pages: pages.map((page) => pdfSheetSchema.parse(page)),
      })
      return result.status === 'pdfBatch' ? ok(undefined) : failure(result)
    },
    async finish(job, revision) {
      if (!api) return unavailable()
      const result = await api.planFile({ action: 'pdfBatchFinish', job, revision })
      return result.status === 'pdf' ? ok(undefined) : failure(result)
    },
    async cancel(job) {
      await api?.planFile({ action: 'pdfBatchCancel', job }).catch(() => undefined)
    },
  }
}
