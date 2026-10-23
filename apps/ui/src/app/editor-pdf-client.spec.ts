import { mm } from '@eow/documents/application'
import type { EowApi } from '@eow/ipc/contracts'
import { editorPdfClient } from './editor-pdf-client'
it('передаёт модель листа, ревизию и ПД, различает успех, отмену и ошибку', async () => {
  const api = { planFile: vi.fn<EowApi['planFile']>() }
  const port = editorPdfClient(api)
  const request = {
    revision: 3,
    pd: 'a',
    page: { width: mm(420), height: mm(297), number: 2, primitives: [] },
  }
  for (const result of ['saved', 'cancelled'] as const) {
    api.planFile.mockResolvedValueOnce({ status: 'pdf', result })
    expect(await port.export(request)).toEqual({ ok: true, value: result })
    expect(api.planFile).toHaveBeenLastCalledWith({ action: 'exportEditorSheet', ...request })
  }
  api.planFile.mockResolvedValueOnce({ status: 'error', message: 'Учебная ошибка' })
  expect(await port.export(request)).toEqual({ ok: false, error: { message: 'Учебная ошибка' } })
  expect((await editorPdfClient(undefined).export(request)).ok).toBe(false)
})
