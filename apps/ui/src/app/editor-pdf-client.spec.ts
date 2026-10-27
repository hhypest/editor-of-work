import { mm } from '@eow/documents/application'
import type { EowApi } from '@eow/ipc/contracts'
import { editorPdfBatchClient, editorPdfClient } from './editor-pdf-client'
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
it('ведёт шаги пакетного задания и не теряет ошибку main', async () => {
  const api = { planFile: vi.fn<EowApi['planFile']>() }
  const port = editorPdfBatchClient(api)
  const job = '9b2f0d39-4b25-4b6d-8a1d-6f6a0c0e8b11'
  const page = { width: mm(420), height: mm(297), number: 1, primitives: [] }
  api.planFile.mockResolvedValueOnce({ status: 'cancelled' })
  expect(await port.start(3, 'file', ['a'])).toEqual({ ok: true, value: 'cancelled' })
  api.planFile.mockResolvedValueOnce({ status: 'pdfBatch', job, total: 2, done: 0 })
  expect(await port.start(3, 'folder', ['a', 'b'])).toEqual({ ok: true, value: { job, total: 2 } })
  expect(api.planFile).toHaveBeenLastCalledWith({
    action: 'pdfBatchStart',
    revision: 3,
    mode: 'folder',
    pds: ['a', 'b'],
  })
  api.planFile.mockResolvedValueOnce({ status: 'pdfBatch', job, total: 2, done: 1 })
  expect(await port.add(job, 3, 'a', [page])).toEqual({ ok: true, value: undefined })
  expect(api.planFile).toHaveBeenLastCalledWith({
    action: 'pdfBatchAdd',
    job,
    revision: 3,
    pd: 'a',
    pages: [page],
  })
  api.planFile.mockResolvedValueOnce({ status: 'error', message: 'План изменился.' })
  expect(await port.finish(job, 3)).toEqual({ ok: false, error: { message: 'План изменился.' } })
  api.planFile.mockRejectedValueOnce(new Error('Учебный отказ канала'))
  await expect(port.cancel(job)).resolves.toBeUndefined()
  expect(api.planFile).toHaveBeenLastCalledWith({ action: 'pdfBatchCancel', job })
  expect((await editorPdfBatchClient(undefined).start(3, 'file', ['a'])).ok).toBe(false)
})
