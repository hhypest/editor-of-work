import { channels, type ResponseOf } from '@eow/ipc/contracts'
import type { PassportStationLayouts } from '@eow/passport/import-api'
import { registerHandler, type IpcMainLike } from './register'

type Outcome = ResponseOf<typeof channels.stationLayouts>
const failure = (message: string): Outcome => ({ status: 'error', message })

/** Редактор станций: раскладки читаются и пишутся только через сценарии паспорта. */
export function registerStationLayoutHandlers(
  ipc: IpcMainLike,
  store: PassportStationLayouts,
): void {
  registerHandler(ipc, channels.stationLayouts, async (request): Promise<Outcome> => {
    switch (request.action) {
      case 'list': {
        const result = await store.stationLayoutList(request.editionId)
        return result.ok
          ? { status: 'stations', stations: [...result.value] }
          : failure(result.error.message)
      }
      case 'load': {
        const result = await store.stationLayout(request.editionId, request.stationId)
        if (!result.ok) return failure(result.error.message)
        // Ответ — DTO контракта: копия проходит ту же схему, что увидит renderer.
        return channels.stationLayouts.response.parse(
          result.value
            ? { status: 'layout', ...result.value }
            : { status: 'layout', layout: null, version: '', editable: false },
        )
      }
      case 'save': {
        const result = await store.saveStationLayout(
          request.editionId,
          request.stationId,
          request.layout,
          request.version,
        )
        return result.ok
          ? { status: 'saved', version: result.value.version }
          : failure(result.error.message)
      }
    }
  })
}
