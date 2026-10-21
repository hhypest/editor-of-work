import type { EowApi } from '@eow/ipc/contracts'
import type { RepairReportClient } from '@eow/passport/feature-ui'
import { err, ok } from '@eow/shared/kernel'

declare global {
  interface Window {
    readonly eow?: EowApi
  }
}
const unavailable = () =>
  err({
    kind: 'storage',
    message: 'Паспорт доступен в настольной программе. Откройте editor-of-work.',
  } as const)

/** Связывание порта интерфейса с preload выполняется только в composition root. */
export function repairReportClient(api: EowApi | undefined): RepairReportClient {
  return {
    async list() {
      if (!api) return unavailable()
      const response = await api.passport({ action: 'list' })
      return response.status === 'ok'
        ? ok(response.editions)
        : err({ kind: 'storage', message: response.message })
    },
    async report(editionId) {
      if (!api) return unavailable()
      const response = await api.repairs({ editionId })
      return response.status === 'ok'
        ? ok(response.report)
        : err({ kind: 'storage', message: response.message })
    },
  }
}
