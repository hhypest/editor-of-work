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
      return api.exportWizard(
        request.action === 'review' ? { ...request, selected: [...request.selected] } : request,
      )
    },
  }
}
