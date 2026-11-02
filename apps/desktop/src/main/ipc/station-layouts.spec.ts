import { channels } from '@eow/ipc/contracts'
import type { PassportStationLayouts, StationLayout } from '@eow/passport/import-api'
import { err, ok } from '@eow/shared/kernel'
import { registerStationLayoutHandlers } from './station-layouts'

const layout: StationLayout = {
  version: 1,
  nodes: [
    { id: 'a', col: 0, row: 0, kind: 'end', end: 'open' },
    { id: 'b', col: 9, row: 0, kind: 'end', end: 'stop' },
  ],
  tracks: [
    {
      id: 't',
      number: '1',
      kind: 'station',
      state: 'normal',
      nodes: ['a', 'b'],
      fullLength: null,
      capacity: null,
    },
  ],
  switches: [],
  derailers: [],
  bridges: [],
  crossings: [],
}
const version = 'a'.repeat(64)

describe('Канал раскладок станций', () => {
  let handler: (event: unknown, request: unknown) => unknown
  const store: PassportStationLayouts = {
    stationLayoutList: vi.fn<PassportStationLayouts['stationLayoutList']>(async () =>
      ok([{ id: 's', name: 'Учебная', hasLayout: true }]),
    ),
    stationLayout: vi.fn<PassportStationLayouts['stationLayout']>(async (_e: number, s: string) =>
      ok(s === 's' ? { layout, version, editable: true } : null),
    ),
    saveStationLayout: vi.fn<PassportStationLayouts['saveStationLayout']>(async () =>
      err({ kind: 'invalid-import' as const, message: 'Устарело' }),
    ),
  }
  beforeEach(() => {
    registerStationLayoutHandlers({ handle: (_c, listener) => (handler = listener) }, store)
  })
  const invoke = async (request: unknown) =>
    channels.stationLayouts.response.parse(await handler(undefined, request))

  it('отдаёт список станций и раскладку по контракту', async () => {
    expect(await invoke({ action: 'list', editionId: 1 })).toEqual({
      status: 'stations',
      stations: [{ id: 's', name: 'Учебная', hasLayout: true }],
    })
    expect(await invoke({ action: 'load', editionId: 1, stationId: 's' })).toMatchObject({
      status: 'layout',
      version,
      editable: true,
    })
    expect(await invoke({ action: 'load', editionId: 1, stationId: 'x' })).toMatchObject({
      status: 'layout',
      layout: null,
    })
  })

  it('возвращает отказ паспорта при записи текстом', async () => {
    expect(await invoke({ action: 'save', editionId: 1, stationId: 's', layout, version })).toEqual(
      { status: 'error', message: 'Устарело' },
    )
  })

  it('отклоняет запрос с раскладкой не по контракту до обращения к паспорту', async () => {
    await expect(
      handler(undefined, {
        action: 'save',
        editionId: 1,
        stationId: 's',
        layout: { version: 2 },
        version,
      }),
    ).rejects.toThrow('stations:layouts')
    expect(store.saveStationLayout).not.toHaveBeenCalledWith(1, 's', { version: 2 }, version)
  })
})
