import type { EowApi } from '@eow/ipc/contracts'
import { exportWizardClient } from './export-wizard-client'

function api(): EowApi {
  return {
    printHost: async () => ({ status: 'error', message: 'unused' }),
    appInfo: async () => ({ name: 'editor-of-work', version: '0', planFormat: 7 }),
    planFile: async () => ({ status: 'cancelled' }),
    passport: async () => ({ status: 'ok', editions: [] }),
    passportData: async () => ({ status: 'error', message: 'Учебный отказ' }),
    repairs: async () => ({ status: 'error', message: 'Учебный отказ' }),
    manualTemplate: async () => ({ status: 'cancelled' }),
    exportWizard: vi.fn<EowApi['exportWizard']>(async () => ({ status: 'cancelled' })),
  }
}
describe('Клиент мастера через preload', () => {
  it('без desktop возвращает понятную ошибку', async () => {
    const client = exportWizardClient(undefined)
    expect(await client.list()).toMatchObject({ ok: false })
    expect(await client.run({ action: 'choose', editionId: 1, group: 'org' })).toMatchObject({
      status: 'error',
    })
  })
  it('передаёт только идентификаторы и выбранные подразделения', async () => {
    const eow = api(),
      client = exportWizardClient(eow)
    expect(await client.list()).toEqual({ ok: true, value: [] })
    const request = {
      action: 'review' as const,
      editionId: 1,
      token: '302cdd1e-4999-4d2a-9aa1-c384f11d81d2',
      selected: ['ПД-1'],
    }
    await client.run(request)
    expect(eow.exportWizard).toHaveBeenCalledWith(request)
  })
})
