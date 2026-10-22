import type { EowApi } from '@eow/ipc/contracts'
import type { ManualTemplateClient } from '@eow/import/application'
import { err, ok } from '@eow/shared/kernel'

export function manualTemplateClient(api: EowApi | undefined): ManualTemplateClient {
  const unavailable = 'Ручные данные доступны в настольной программе. Откройте editor-of-work.'
  return {
    async list() {
      if (!api) return err({ message: unavailable })
      const response = await api.passport({ action: 'list' })
      return response.status === 'ok' ? ok(response.editions) : err({ message: response.message })
    },
    async run(request) {
      if (!api) return { status: 'error', message: unavailable }
      return api.manualTemplate(request)
    },
  }
}
