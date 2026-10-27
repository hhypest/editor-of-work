import type { EowApi } from '@eow/ipc/contracts'
import { planEditorClient } from './plan-editor-client'
const api: EowApi = {
  printHost: async () => ({ status: 'error', message: 'unused' }),
  appInfo: async () => ({ name: 'editor-of-work', version: '0', planFormat: 7 }),
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
  it('передаёт создание и список редакций; неверный год не доходит до IPC', async () => {
    const port = planEditorClient(api)
    vi.mocked(api.planFile).mockClear()
    expect(
      await port.send({ kind: 'create', editionId: 7, year: 1999 }, 2, 'district'),
    ).toMatchObject({ kind: 'invalid' })
    expect(api.planFile).not.toHaveBeenCalled()
    vi.mocked(api.planFile).mockResolvedValueOnce({
      status: 'editions',
      editions: [{ id: 7, number: 7, date: '2027-01-01', label: 'Учебная', status: 'archived' }],
    })
    expect(await port.send({ kind: 'editions' }, 2, 'district')).toMatchObject({
      kind: 'editions',
      editions: [{ id: 7 }],
    })
    await port.send({ kind: 'create', editionId: 7, year: 2028 }, 2, 'district')
    expect(api.planFile).toHaveBeenLastCalledWith({
      action: 'editor',
      command: { kind: 'create', editionId: 7, year: 2028 },
      revision: 2,
      area: 'district',
    })
  })
})
