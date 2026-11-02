import ExcelJS from 'exceljs'
import { strFromU8, unzipSync } from 'fflate'
import { channels } from '@eow/ipc/contracts'
import type { Workbook } from '@eow/documents/application'
import { workbookToXlsx } from '../spreadsheet-exporter'
import { registerSpreadsheetHandler, xlsxFileName, type SpreadsheetPorts } from './spreadsheet'

const workbook: Workbook = {
  sheets: [
    {
      name: 'Итоги',
      columns: [10, 20],
      rows: [
        [{ value: 'Учебный заголовок', style: { bold: true, size: 14, fill: '#efefef' } }],
        [
          { value: 'ПД-1', style: { border: true } },
          {
            formula: "=SUMIFS('Исх. (1)'!$B:$B,'Исх. (1)'!$A:$A,A2)/1000",
            result: 1.5,
            style: { format: '0.000', align: 'right' },
          },
        ],
        [
          null,
          {
            formula: '="ПД-1"&CHAR(10)&"Учебный И.И."',
            result: 'ПД-1\nУчебный И.И.',
            style: { wrap: true },
          },
        ],
      ],
      heights: { 1: 20 },
      merges: ['A1:B1'],
      freeze: { rows: 1, columns: 0 },
      print: { orientation: 'landscape', onePage: true },
    },
    {
      name: 'Исх. (1)',
      columns: [10, 10],
      rows: [
        [{ value: 'ПД-1' }, { value: 1000 }],
        [{ value: 'пд-1' }, { value: 500 }],
      ],
      print: { orientation: 'portrait', onePage: false },
    },
  ],
}

describe('Книга xlsx', () => {
  it('ExcelJS читает формулы с результатами, оформление, объединения и печать', async () => {
    const bytes = await workbookToXlsx(workbook)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(bytes).buffer)
    const sheet = wb.getWorksheet('Итоги')!
    expect(sheet.getCell('B2').value).toEqual({
      formula: "SUMIFS('Исх. (1)'!$B:$B,'Исх. (1)'!$A:$A,A2)/1000",
      result: 1.5,
    })
    expect(sheet.getCell('B2').numFmt).toBe('0.000')
    expect(sheet.getCell('A1').font).toMatchObject({ bold: true, size: 14 })
    expect(sheet.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FFEFEFEF' } })
    expect(sheet.getCell('B1').isMerged).toBe(true)
    expect(sheet.getCell('B3').alignment).toMatchObject({ wrapText: true })
    expect(sheet.getRow(1).height).toBe(20)
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    expect(sheet.pageSetup).toMatchObject({
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
    })
    expect(wb.getWorksheet('Исх. (1)')!.pageSetup).toMatchObject({ fitToHeight: 0 })
    // Excel пересчитывает формулы при открытии.
    expect(strFromU8(unzipSync(bytes)['xl/workbook.xml']!)).toContain('fullCalcOnLoad="1"')
  })

  it('имя файла без запрещённых знаков, отмена, неверное расширение и ошибка записи', async () => {
    expect(xlsxFileName('Адм. деление: 01/01.xlsx')).toBe('Адм. деление_ 01_01.xlsx')
    expect(xlsxFileName('...')).toBe('Книга.xlsx')
    let handler: (event: unknown, request: unknown) => unknown = () => undefined
    const ports: SpreadsheetPorts = {
      choosePath: vi.fn<SpreadsheetPorts['choosePath']>(async () => '/учебная/книга.xlsx'),
      write: vi.fn<NonNullable<SpreadsheetPorts['write']>>(async () => undefined),
    }
    registerSpreadsheetHandler({ handle: (_c, listener) => (handler = listener) }, ports)
    const invoke = async (request: unknown) =>
      channels.spreadsheet.response.parse(await handler(undefined, request))
    expect(await invoke({ fileName: 'Учебная', workbook })).toEqual({ status: 'saved' })
    expect(ports.choosePath).toHaveBeenCalledWith('Учебная.xlsx')
    expect(ports.write).toHaveBeenCalledWith('/учебная/книга.xlsx', expect.any(Uint8Array))
    vi.mocked(ports.choosePath).mockResolvedValueOnce(undefined)
    expect(await invoke({ fileName: 'Учебная', workbook })).toEqual({ status: 'cancelled' })
    vi.mocked(ports.choosePath).mockResolvedValueOnce('/учебная/книга.xls')
    expect(await invoke({ fileName: 'Учебная', workbook })).toMatchObject({ status: 'error' })
    vi.mocked(ports.write!).mockRejectedValueOnce(new Error('EBUSY'))
    expect(await invoke({ fileName: 'Учебная', workbook })).toMatchObject({
      status: 'error',
      message: expect.stringContaining('не открыт в Excel'),
    })
  })

  it('схема канала отвергает чужие функции, ссылки на другие книги и повтор имён листов', () => {
    const parse = (formula: string) =>
      channels.spreadsheet.request.safeParse({
        fileName: 'Учебная',
        workbook: {
          sheets: [{ ...workbook.sheets[1]!, rows: [[{ formula, result: 0 }]] }],
        },
      }).success
    expect(parse('=SUM(A1:A2)+COUNTIF(B:B,"ПД (1)")')).toBe(true)
    expect(parse("=SUMIFS('Пути (исх.)'!$D:$D,'Пути (исх.)'!$B:$B,B2)")).toBe(true)
    expect(parse('=HYPERLINK("http://example.invalid","x")')).toBe(false)
    expect(parse('=WEBSERVICE("x")')).toBe(false)
    expect(parse('=[1]Лист!A1')).toBe(false)
    expect(parse('=SUM("A1)')).toBe(false)
    expect(parse('SUM(A1)')).toBe(false)
    expect(
      channels.spreadsheet.request.safeParse({
        fileName: 'Учебная',
        workbook: { sheets: [workbook.sheets[1], { ...workbook.sheets[1], name: 'исх. (1)' }] },
      }).success,
    ).toBe(false)
  })
})
