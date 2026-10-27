import type { EowApi } from '@eow/ipc/contracts'
import { manualTemplateClient } from './manual-template-client'

const api = (): EowApi => ({
  exportWizard: async () => ({ status: 'cancelled' }),
  printHost: async () => ({ status: 'error', message: 'unused' }),
  appInfo: async () => ({ name: 'editor-of-work', version: '0', planFormat: 7 }),
  planFile: async () => ({ status: 'cancelled' }),
  passport: vi.fn<EowApi['passport']>(async () => ({ status: 'ok' as const, editions: [] })),
  passportData: async () => ({ status: 'error', message: 'Учебный отказ' }),
  repairs: async () => ({ status: 'error', message: 'Учебный отказ' }),
  manualTemplate: vi.fn<EowApi['manualTemplate']>(async () => ({ status: 'cancelled' })),
})

describe('Адаптер шаблона через preload', () => {
  it('без настольного API сообщает об отсутствии соединения', async () => {
    const client = manualTemplateClient(undefined)
    expect(await client.list()).toMatchObject({ ok: false })
    expect(await client.run({ action: 'export', editionId: 1 })).toMatchObject({ status: 'error' })
  })
  it('передаёт запросы без путей и возвращает ошибки канала', async () => {
    const eow = api()
    const client = manualTemplateClient(eow)
    expect(await client.list()).toEqual({ ok: true, value: [] })
    expect(eow.passport).toHaveBeenCalledWith({ action: 'list' })
    const request = { action: 'prepare' as const, editionId: 2 }
    await client.run(request)
    expect(eow.manualTemplate).toHaveBeenCalledWith(request)
    vi.mocked(eow.manualTemplate).mockResolvedValueOnce({
      status: 'error',
      message: 'Книга устарела',
    })
    expect(await client.run(request)).toEqual({ status: 'error', message: 'Книга устарела' })
  })
})
