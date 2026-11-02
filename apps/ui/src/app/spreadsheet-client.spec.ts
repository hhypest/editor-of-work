import { ok } from '@eow/shared/kernel'
import type { EowApi } from '@eow/ipc/contracts'
import type { Workbook } from '@eow/documents/application'
import { spreadsheetClient } from './spreadsheet-client'

const workbook: Workbook = {
  sheets: [
    {
      name: 'Учебный',
      columns: [10],
      rows: [[{ value: 'ПД-1' }, { formula: '=SUM(1,2)', result: 3 }]],
      print: { orientation: 'portrait', onePage: false },
    },
  ],
}

describe('Клиент книг Excel', () => {
  it('проверяет книгу, передаёт её в main и возвращает исход', async () => {
    const spreadsheet = vi.fn<EowApi['spreadsheet']>(async () => ({ status: 'saved' }))
    expect(await spreadsheetClient({ spreadsheet }).save('Книга', workbook)).toEqual(ok('saved'))
    expect(spreadsheet).toHaveBeenCalledWith({ fileName: 'Книга', workbook })
    const bad: Workbook = {
      sheets: [{ ...workbook.sheets[0]!, rows: [[{ formula: '=NOW()', result: 0 }]] }],
    }
    expect(await spreadsheetClient({ spreadsheet }).save('Книга', bad)).toMatchObject({
      ok: false,
    })
    expect(spreadsheet).toHaveBeenCalledTimes(1)
  })
  it('передаёт ошибку main и работает без настольной программы', async () => {
    const failing = spreadsheetClient({
      spreadsheet: async () => ({ status: 'error' as const, message: 'Файл занят' }),
    })
    expect(await failing.save('Книга', workbook)).toMatchObject({
      ok: false,
      error: { message: 'Файл занят' },
    })
    expect(await spreadsheetClient(undefined).save('Книга', workbook)).toMatchObject({ ok: false })
  })
})
