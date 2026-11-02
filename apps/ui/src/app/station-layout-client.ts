import type { EowApi } from '@eow/ipc/contracts'
import type { StationEditorClient } from '@eow/stations/feature-ui'
import { err, ok } from '@eow/shared/kernel'

const unavailable = () =>
  err({ message: 'Схемы станций доступны в настольной программе. Откройте editor-of-work.' })

/** Порт редактора станций поверх preload; связывание — только в composition root. */
export function stationLayoutClient(api: EowApi | undefined): StationEditorClient {
  return {
    async editions() {
      if (!api) return unavailable()
      const r = await api.passport({ action: 'list' })
      return r.status === 'ok' ? ok(r.editions) : err({ message: r.message })
    },
    async stations(editionId) {
      if (!api) return unavailable()
      const r = await api.stationLayouts({ action: 'list', editionId })
      if (r.status === 'stations') return ok(r.stations)
      return err({ message: r.status === 'error' ? r.message : 'Неожиданный ответ программы.' })
    },
    async load(editionId, stationId) {
      if (!api) return unavailable()
      const r = await api.stationLayouts({ action: 'load', editionId, stationId })
      if (r.status === 'layout')
        return ok(r.layout ? { layout: r.layout, version: r.version, editable: r.editable } : null)
      return err({ message: r.status === 'error' ? r.message : 'Неожиданный ответ программы.' })
    },
    async save(editionId, stationId, layout, version) {
      if (!api) return unavailable()
      const r = await api.stationLayouts({ action: 'save', editionId, stationId, layout, version })
      if (r.status === 'saved') return ok({ version: r.version })
      return err({ message: r.status === 'error' ? r.message : 'Неожиданный ответ программы.' })
    },
  }
}
