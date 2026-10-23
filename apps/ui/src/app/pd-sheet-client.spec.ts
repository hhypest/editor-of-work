import type { EowApi } from '@eow/ipc/contracts'
import { pdSheetClient } from './pd-sheet-client'
const api: EowApi = {
  printHost: async () => ({ status: 'error', message: 'unused' }),
  appInfo: async () => ({ name: 'editor-of-work', version: '0' }),
  passport: async () => ({ status: 'ok', editions: [] }),
  passportData: async () => ({ status: 'error', message: 'unused' }),
  repairs: async () => ({ status: 'error', message: 'unused' }),
  manualTemplate: async () => ({ status: 'cancelled' }),
  exportWizard: async () => ({ status: 'cancelled' }),
  planFile: vi.fn<EowApi['planFile']>(async () => ({ status: 'sheets', source: null })),
}
describe('Порт листов ПД', () => {
  it('передаёт режим чтения и различает пустой план, отмену и ошибку', async () => {
    const port = pdSheetClient(api)
    expect(await port.load(true)).toEqual({ ok: true, value: null })
    expect(api.planFile).toHaveBeenLastCalledWith({ action: 'previewSheets', open: true })
    vi.mocked(api.planFile).mockResolvedValueOnce({ status: 'cancelled' })
    expect(await port.load(true)).toEqual({ ok: true, value: 'cancelled' })
    vi.mocked(api.planFile).mockResolvedValueOnce({ status: 'error', message: 'Учебная ошибка' })
    expect(await port.load(false)).toMatchObject({
      ok: false,
      error: { message: 'Учебная ошибка' },
    })
    expect(await pdSheetClient(undefined).load(false)).toMatchObject({ ok: false })
  })
})
