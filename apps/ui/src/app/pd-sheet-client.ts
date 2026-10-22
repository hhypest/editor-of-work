import type { EowApi } from '@eow/ipc/contracts'
import type { PdSheetClient } from '@eow/documents/application'
import { err, ok } from '@eow/shared/kernel'

export function pdSheetClient(api: EowApi | undefined): PdSheetClient {
  return {
    async load(open) {
      if (!api) return err({ message: 'Листы ПД доступны в настольной программе editor-of-work.' })
      const result = await api.planFile({ action: 'previewSheets', open })
      if (result.status === 'sheets') return ok(result.source)
      if (result.status === 'cancelled') return ok('cancelled')
      return err({
        message:
          result.status === 'error' ? result.message : 'Не удалось получить срез годового плана.',
      })
    },
  }
}
