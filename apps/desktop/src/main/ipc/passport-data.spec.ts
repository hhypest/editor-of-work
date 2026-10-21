import { channels } from '@eow/ipc/contracts'
import type { PassportEditionData } from '@eow/passport/application'
import { err, ok } from '@eow/shared/kernel'
import { registerPassportDataHandlers } from './passport-data'

const editionData = {
  edition: { id: 3, number: 2, date: '2027-01-01', label: 'Черновик', status: 'draft' as const },
  lines: [],
  segments: [],
  stations: [],
  manual: { workKinds: [], repairNorms: [], tolerances: [], trainPairs: [], kilometres: [] },
  org: { subdivisions: [], boundaries: [], stations: [], tracks: [] },
}

function setup() {
  const store: PassportEditionData = {
    editionData: vi.fn<PassportEditionData['editionData']>(async () => ok(editionData)),
  }
  let handler: ((event: unknown, ...args: unknown[]) => unknown) | undefined
  registerPassportDataHandlers(
    {
      handle(name, listener) {
        expect(name).toBe(channels.passportData.name)
        handler = listener
      },
    },
    store,
  )
  return { store, invoke: async (input: unknown) => handler!(undefined, input) }
}
describe('IPC данных редакции', () => {
  it('возвращает DTO для выбранной редакции', async () => {
    const { store, invoke } = setup()
    expect(await invoke({ editionId: 3 })).toEqual({ status: 'ok', data: editionData })
    expect(store.editionData).toHaveBeenCalledWith(3)
  })
  it.each([{ editionId: -1 }, { editionId: 1.5 }, { editionId: 1, path: 'arbitrary.sqlite' }, {}])(
    'отклоняет запрос до чтения',
    async (input) => {
      const { store, invoke } = setup()
      await expect(invoke(input)).rejects.toThrow('неверный запрос')
      expect(store.editionData).not.toHaveBeenCalled()
    },
  )
  it('передаёт понятную ошибку без содержимого базы', async () => {
    const { store, invoke } = setup()
    vi.mocked(store.editionData).mockResolvedValue(
      err({ kind: 'not-found', message: 'Редакция не найдена.' }),
    )
    expect(await invoke({ editionId: 1 })).toEqual({
      status: 'error',
      message: 'Редакция не найдена.',
    })
  })
})
