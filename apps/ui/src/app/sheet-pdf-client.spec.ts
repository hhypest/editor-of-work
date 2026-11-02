import { ok } from '@eow/shared/kernel'
import type { EowApi } from '@eow/ipc/contracts'
import type { SheetPage } from '@eow/documents/application'
import { sheetPdfClient } from './sheet-pdf-client'

const page: SheetPage = {
  width: { unit: 'mm', value: 420 },
  height: { unit: 'mm', value: 297 },
  number: 1,
  primitives: [],
}

describe('Клиент PDF паспортных схем', () => {
  it('передаёт листы в main и возвращает исход', async () => {
    const sheetPdf = vi.fn<EowApi['sheetPdf']>(async () => ({ status: 'saved' }))
    expect(await sheetPdfClient({ sheetPdf }).save('Схема', [page])).toEqual(ok('saved'))
    expect(sheetPdf).toHaveBeenCalledWith({ fileName: 'Схема', pages: [page] })
  })
  it('передаёт ошибку main и работает без настольной программы', async () => {
    const failing = sheetPdfClient({
      sheetPdf: async () => ({ status: 'error' as const, message: 'Нет доступа' }),
    })
    expect(await failing.save('Схема', [page])).toMatchObject({
      ok: false,
      error: { message: 'Нет доступа' },
    })
    expect(await sheetPdfClient(undefined).save('Схема', [page])).toMatchObject({ ok: false })
  })
})
