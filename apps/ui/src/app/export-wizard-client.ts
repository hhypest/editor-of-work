import type { EowApi } from '@eow/ipc/contracts'
import type { ExportWizardClient } from '@eow/import/application'
import { manualTemplateClient } from './manual-template-client'

export function exportWizardClient(api: EowApi | undefined): ExportWizardClient {
  return {
    list: manualTemplateClient(api).list,
    async run(request) {
      if (!api)
        return {
          status: 'error',
          message: 'Импорт доступен в настольной программе editor-of-work.',
        }
      const outcome = await api.exportWizard(
        request.action === 'review' ? { ...request, selected: [...request.selected] } : request,
      )
      // Ход приходит только на запросы progress и cancel; в ответе операции он ошибка контракта.
      return outcome.status === 'idle' || outcome.status === 'progress'
        ? { status: 'error', message: 'Неожиданный ответ мастера импорта.' }
        : outcome
    },
    async progress() {
      if (!api) return null
      const outcome = await api.exportWizard({ action: 'progress' })
      return outcome.status === 'progress' ? outcome.progress : null
    },
    async cancel() {
      if (api) await api.exportWizard({ action: 'cancel' })
    },
  }
}
