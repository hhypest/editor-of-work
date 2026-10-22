import type { EowApi } from '@eow/ipc/contracts'
import { planEditorClient } from './plan-editor-client'
const api: EowApi = {
  appInfo: async () => ({ name: 'editor-of-work', version: '0' }),
  passport: async () => ({ status: 'ok', editions: [] }),
  passportData: async () => ({ status: 'error', message: 'unused' }),
  repairs: async () => ({ status: 'error', message: 'unused' }),
  manualTemplate: async () => ({ status: 'cancelled' }),
  exportWizard: async () => ({ status: 'cancelled' }),
  planFile: vi.fn<EowApi['planFile']>(async () => ({ status: 'cancelled' })),
}
describe('Порт редактора через preload', () => {
  it('передаёт версию и область, различая отмену, ошибку и отсутствие настольной программы', async () => {
    const port = planEditorClient(api)
    expect(await port.send({ kind: 'open' }, 7, 'district')).toEqual({ kind: 'cancelled' })
    expect(api.planFile).toHaveBeenCalledWith({
      action: 'editor',
      command: { kind: 'open' },
      revision: 7,
      area: 'district',
    })
    vi.mocked(api.planFile).mockResolvedValueOnce({
      status: 'invalid',
      issues: [{ field: 'place', message: 'Учебная ошибка', start: 1, end: 2 }],
    })
    expect(await port.send({ kind: 'undo' }, 7, 'district')).toMatchObject({
      kind: 'invalid',
      issues: [{ field: 'place' }],
    })
    vi.mocked(api.planFile).mockResolvedValueOnce({ status: 'error', message: 'План изменился' })
    await expect(port.send({ kind: 'undo' }, 7, 'district')).rejects.toThrow('План изменился')
    await expect(
      planEditorClient(undefined).send({ kind: 'state' }, 0, 'district'),
    ).rejects.toThrow('настольной')
  })
})
