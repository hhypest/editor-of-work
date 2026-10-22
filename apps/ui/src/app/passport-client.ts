import type { EowApi } from '@eow/ipc/contracts'
import type { PassportClient } from '@eow/passport/feature-ui'
import { err, ok } from '@eow/shared/kernel'

const unavailable = () =>
  err({
    kind: 'storage' as const,
    message: 'Паспорт доступен в настольной программе. Откройте editor-of-work.',
  })

const editions = (response: { status: string; message?: string }) =>
  response.status === 'ok'
    ? ok(null)
    : err({ kind: 'storage' as const, message: response.message ?? '' })

/** Связывание порта интерфейса с preload выполняется только в composition root. */
export function passportClient(api: EowApi | undefined): PassportClient {
  return {
    async list() {
      if (!api) return unavailable()
      const response = await api.passport({ action: 'list' })
      return response.status === 'ok'
        ? ok(response.editions)
        : err({ kind: 'storage' as const, message: response.message })
    },
    async createDraft(input) {
      if (!api) return unavailable()
      return editions(await api.passport({ action: 'createDraft', ...input }))
    },
    async activate(id) {
      if (!api) return unavailable()
      return editions(await api.passport({ action: 'activate', id }))
    },
    async editionData(editionId) {
      if (!api) return unavailable()
      const response = await api.passportData({ editionId })
      return response.status === 'ok'
        ? ok(response.data)
        : err({ kind: 'storage' as const, message: response.message })
    },
  }
}
