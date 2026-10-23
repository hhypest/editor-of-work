import type { EowApi } from '@eow/ipc/contracts'
import type { EditorSheetClient } from '@eow/documents/application'
import { err, ok } from '@eow/shared/kernel'

export function editorSheetClient(api: EowApi | undefined): EditorSheetClient {
  return {
    async source(revision, pd) {
      if (!api)
        return err({ message: 'Предпросмотр доступен в настольной программе editor-of-work.' })
      const result = await api.planFile({ action: 'previewEditorSheets', revision, pd })
      if (result.status === 'editorSheets' && result.revision === revision) return ok(result.source)
      return err({
        message:
          result.status === 'error'
            ? result.message
            : 'Лист не соответствует ревизии редактора. Обновите редактор.',
      })
    },
  }
}
