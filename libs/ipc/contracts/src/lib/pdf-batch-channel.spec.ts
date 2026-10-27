import { channels } from './channels'
import { pdfPagesSchema } from './pdf-sheet-schema'

const page = {
  width: { unit: 'mm', value: 420 },
  height: { unit: 'mm', value: 297 },
  number: 1,
  primitives: [],
}
const job = '9b2f0d39-4b25-4b6d-8a1d-6f6a0c0e8b11'
const parse = (request: unknown) => channels.planFile.request.safeParse(request).success

describe('Контракт пакетного PDF', () => {
  it('принимает шаги задания без путей и с ограничениями', () => {
    expect(parse({ action: 'pdfBatchStart', revision: 1, mode: 'file', pds: ['a'] })).toBe(true)
    expect(parse({ action: 'pdfBatchAdd', job, revision: 1, pd: 'a', pages: [page] })).toBe(true)
    expect(parse({ action: 'pdfBatchFinish', job, revision: 1 })).toBe(true)
    expect(parse({ action: 'pdfBatchCancel', job })).toBe(true)
    for (const invalid of [
      { action: 'pdfBatchStart', revision: 1, mode: 'zip', pds: ['a'] },
      { action: 'pdfBatchStart', revision: 1, mode: 'file', pds: [] },
      { action: 'pdfBatchStart', revision: 1, mode: 'folder', pds: ['a'], path: 'C:\\' },
      { action: 'pdfBatchAdd', job: 'не-идентификатор', revision: 1, pd: 'a', pages: [page] },
      { action: 'pdfBatchAdd', job, revision: 1, pd: 'a', pages: [] },
      { action: 'pdfBatchAdd', job, revision: 1, pd: 'a', pages: Array(201).fill(page) },
      { action: 'pdfBatchFinish', job, revision: -1 },
      { action: 'pdfBatchCancel', job, folder: 'C:\\' },
    ])
      expect(parse(invalid)).toBe(false)
  })
  it('окно печати получает от 1 до 300 листов', () => {
    expect(pdfPagesSchema.safeParse([page, page]).success).toBe(true)
    expect(pdfPagesSchema.safeParse([]).success).toBe(false)
    expect(pdfPagesSchema.safeParse(Array(301).fill(page)).success).toBe(false)
    expect(channels.printHost.response.safeParse({ status: 'page', page }).success).toBe(false)
  })
})
