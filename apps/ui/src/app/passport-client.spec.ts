import { channels, type EowApi } from '@eow/ipc/contracts'
import { passportClient } from './passport-client'

const data = {
  edition: { id: 2, number: 2, date: '2028-01-01', label: 'Учебная', status: 'draft' as const },
  lines: [],
  segments: [],
  stations: [],
  manual: { workKinds: [], repairNorms: [], tolerances: [], trainPairs: [], kilometres: [] },
  org: { subdivisions: [], boundaries: [], stations: [], tracks: [] },
}

function api(): EowApi {
  return {
    manualTemplate: async () => ({ status: 'cancelled' }),
    exportWizard: async () => ({ status: 'cancelled' }),
    appInfo: async () => ({ name: 'editor-of-work', version: '0' }),
    planFile: async () => ({ status: 'cancelled' }),
    passport: vi.fn<EowApi['passport']>(async () => ({ status: 'ok', editions: [data.edition] })),
    passportData: vi.fn<EowApi['passportData']>(async () =>
      channels.passportData.response.parse({ status: 'ok', data }),
    ),
    repairs: vi.fn<EowApi['repairs']>(async () => ({
      status: 'ok',
      report: { date: '2027-01-01', rows: [] },
    })),
  }
}

describe('Порт паспорта через preload', () => {
  it('сообщает об отсутствии настольного соединения', async () => {
    const client = passportClient(undefined)
    expect(await client.list()).toMatchObject({ ok: false })
    expect(await client.createDraft({ date: '2028-01-01', label: 'x' })).toMatchObject({
      ok: false,
    })
    expect(await client.activate(1)).toMatchObject({ ok: false })
    expect(await client.editionData(1)).toMatchObject({ ok: false })
  })
  it('передаёт действия редакций и принимает DTO данных', async () => {
    const eow = api()
    const client = passportClient(eow)
    expect(await client.list()).toEqual({ ok: true, value: [data.edition] })
    expect(await client.createDraft({ date: '2028-01-01', label: 'Учебная' })).toEqual({
      ok: true,
      value: null,
    })
    expect(eow.passport).toHaveBeenCalledWith({
      action: 'createDraft',
      date: '2028-01-01',
      label: 'Учебная',
    })
    await client.activate(2)
    expect(eow.passport).toHaveBeenCalledWith({ action: 'activate', id: 2 })
    expect(await client.editionData(2)).toMatchObject({
      ok: true,
      value: { edition: data.edition },
    })
    expect(eow.passportData).toHaveBeenCalledWith({ editionId: 2 })
  })
  it('передаёт понятную ошибку канала', async () => {
    const eow = api()
    vi.mocked(eow.passport).mockResolvedValue({ status: 'error', message: 'Учебная ошибка' })
    const client = passportClient(eow)
    expect(await client.activate(2)).toEqual({
      ok: false,
      error: { kind: 'storage', message: 'Учебная ошибка' },
    })
  })
})
