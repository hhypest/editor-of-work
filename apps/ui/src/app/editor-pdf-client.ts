import { pdfSheetSchema, type EowApi } from '@eow/ipc/contracts'
import type { EditorPdfClient } from '@eow/documents/application'
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
