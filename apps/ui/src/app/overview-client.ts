import type { EowApi } from '@eow/ipc/contracts'
import type { OverviewClient } from '@eow/documents/application'
import { passportOverviewSource } from '@eow/documents/infrastructure'
import { err, ok } from '@eow/shared/kernel'

export function overviewClient(api: EowApi | undefined): OverviewClient {
  const unavailable = () =>
    err({ message: 'Схема доступна в настольной программе editor-of-work.' })
  return {
    async editions() {
      if (!api) return unavailable()
      const result = await api.passport({ action: 'list' })
      return result.status === 'ok' ? ok(result.editions) : err({ message: result.message })
    },
    async source(editionId) {
      if (!api) return unavailable()
      const result = await api.passportData({ editionId })
      return result.status === 'ok'
        ? ok(passportOverviewSource(result.data))
        : err({ message: result.message })
    },
  }
}
