import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import type { ManualBasis } from '@eow/passport/import-api'
import type { Result } from '@eow/shared/kernel'
import { XlsxManualDataTemplate } from './xlsx-manual-data-template'
import { prepareManualTemplate } from './import-manual-template'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
const basis: ManualBasis = {
  date: '2026-10-21',
  token: 'a'.repeat(64),
  lines: [],
  trackClasses: [],
  data: { workKinds: [], repairNorms: [], tolerances: [], trainPairs: [], kilometres: [] },
}
const adapter = new XlsxManualDataTemplate(() => 'fixed-new-id')
async function edit(change: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(new Uint8Array(value(await adapter.write(basis))).buffer)
  change(wb)
  return new Uint8Array(await wb.xlsx.writeBuffer())
}
describe('Шаблон xlsx ручных данных', () => {
  it('независимый читатель ExcelJS открывает пять оформленных листов без образцов нормативов', async () => {
    const bytes = value(await adapter.write(basis)),
      wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(bytes).buffer)
    expect(wb.worksheets.filter((s) => s.state === 'visible').map((s) => s.name)).toEqual([
      'Виды работ',
      'Периодичность ремонтов',
      'Допуски',
      'Пары поездов',
      'Нестандартные километры',
    ])
    expect(wb.getWorksheet('Виды работ')?.getColumn(9).hidden).toBe(true)
    expect(wb.getWorksheet('Виды работ')?.getCell('A1').font.bold).toBe(true)
    expect(value(await adapter.read(bytes)).data).toEqual(basis.data)
  })
  it('текущие значения и текст с XML-символами проходят оба читателя без потерь', async () => {
    const data = {
      ...basis.data,
      tolerances: [
        {
          id: 'old',
          validFrom: '2020-01-01',
          validTo: null,
          code: 'X',
          name: '=Учебный & <текст>',
          value: -3.25,
          unit: 'мм',
          conditions: 'строка 1\nстрока 2',
        },
      ],
    }
    const current = { ...basis, data },
      bytes = value(await adapter.write(current))
    expect(value(await adapter.read(bytes)).data).toEqual(data)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(bytes).buffer)
    expect(wb.getWorksheet('Допуски')?.getCell('B2').value).toBe(data.tolerances[0]!.name)
    const resaved = new Uint8Array(await wb.xlsx.writeBuffer())
    const preview = value(
      await prepareManualTemplate(
        adapter,
        current,
        { name: 'учебный.xlsx', bytes: resaved },
        '2026-10-21T00:00:00Z',
      ),
    )
    expect(preview.command.data).toEqual(data)
    expect(preview.changes.every((c) => c.added + c.changed + c.removed === 0)).toBe(true)
  })
  it('буквальное OOXML-экранирование в тексте не превращается в другой символ', async () => {
    const data = {
      ...basis.data,
      tolerances: [
        {
          id: 'old',
          validFrom: null,
          validTo: null,
          code: 'X',
          name: 'Текст _x0041_ и возврат\rкаретки',
          value: 1e-7,
          unit: 'мм',
          conditions: null,
        },
      ],
    }
    expect(value(await adapter.read(value(await adapter.write({ ...basis, data })))).data).toEqual(
      data,
    )
  })
  it('числа с запятой и русские даты читаются, пустые необязательные значения остаются null', async () => {
    const bytes = await edit((wb) =>
      wb.getWorksheet('Допуски')!.addRow(['ДОП', 'Учебный', '2,75', 'мм', null, '21.10.2026']),
    )
    expect(value(await adapter.read(bytes)).data.tolerances[0]).toMatchObject({
      id: 'fixed-new-id',
      value: 2.75,
      validFrom: '2026-10-21',
      validTo: null,
      conditions: null,
    })
  })
  it('ошибки числа и даты указывают реальные строки, включая пропуски', async () => {
    const bytes = await edit((wb) => {
      const ws = wb.getWorksheet('Допуски')!
      ws.getRow(7).values = ['ДОП', 'Учебный', 'ошибка', 'мм', null, '31.02.2026']
    })
    expect(await adapter.read(bytes)).toMatchObject({
      ok: false,
      error: expect.arrayContaining([
        { sheet: 'Допуски', row: 7, column: 'Значение', message: expect.any(String) },
        { sheet: 'Допуски', row: 7, column: 'Начало действия', message: expect.any(String) },
      ]),
    })
  })
  it('формулы отвергаются, даже если в файле сохранён числовой результат', async () => {
    const bytes = await edit((wb) =>
      wb.getWorksheet('Допуски')!.addRow(['ДОП', 'Учебный', { formula: '1+1', result: 2 }, 'мм']),
    )
    expect(await adapter.read(bytes)).toMatchObject({
      ok: false,
      error: expect.arrayContaining([
        expect.objectContaining({
          sheet: 'Допуски',
          row: 2,
          column: 'Значение',
          message: expect.stringContaining('формулу'),
        }),
      ]),
    })
  })
  it.each(['лист', 'столбец', 'версия'])(
    'отсутствующий %s не превращается в удаление данных',
    async (failure) => {
      const bytes = await edit((wb) => {
        if (failure === 'лист') wb.removeWorksheet('Пары поездов')
        if (failure === 'столбец') wb.getWorksheet('Допуски')!.getCell('C1').value = 'Неизвестное'
        if (failure === 'версия') wb.getWorksheet('_Шаблон')!.getCell('B1').value = 2
      })
      expect((await adapter.read(bytes)).ok).toBe(false)
    },
  )
  it('предметная ошибка после пустых строк сохраняет исходный номер строки', async () => {
    const bytes = await edit((wb) => {
      wb.getWorksheet('Виды работ')!.getRow(8).values = [
        'КОД',
        'Учебный',
        'км',
        'текущее',
        null,
        'НЕТ',
      ]
    })
    expect(
      await prepareManualTemplate(
        adapter,
        basis,
        { name: 'учебный.xlsx', bytes },
        '2026-10-21T00:00:00Z',
      ),
    ).toMatchObject({ ok: false, error: { message: expect.stringContaining('строка 8') } })
  })
  it('перестановка видов работ видна в предпросмотре как изменение', async () => {
    const kind = (id: string, code: string) => ({
      id,
      validFrom: null,
      validTo: null,
      code,
      name: `Учебный ${code}`,
      unit: 'км',
      group: 'current',
      symbol: null,
      includedIn: null,
    })
    const current: ManualBasis = {
      ...basis,
      data: { ...basis.data, workKinds: [kind('a', 'У-1'), kind('b', 'У-2'), kind('c', 'У-3')] },
    }
    const reordered: ManualBasis = {
      ...current,
      data: { ...current.data, workKinds: [kind('b', 'У-2'), kind('a', 'У-1'), kind('c', 'У-3')] },
    }
    const preview = value(
      await prepareManualTemplate(
        adapter,
        current,
        { name: 'учебный.xlsx', bytes: value(await adapter.write(reordered)) },
        '2026-10-21T00:00:00Z',
      ),
    )
    expect(preview.command.data.workKinds.map((k) => k.code)).toEqual(['У-2', 'У-1', 'У-3'])
    expect(preview.changes.find((c) => c.sheet === 'Виды работ')).toEqual({
      sheet: 'Виды работ',
      added: 0,
      changed: 3,
      removed: 0,
    })
  })
  it('повреждённый ZIP и дублированный лист не принимаются', async () => {
    expect((await adapter.read(new Uint8Array([1, 2, 3]))).ok).toBe(false)
    const parts = unzipSync(value(await adapter.write(basis)))
    parts['xl/workbook.xml'] = strToU8(
      strFromU8(parts['xl/workbook.xml']!).replace('name="Допуски"', 'name="Виды работ"'),
    )
    expect((await adapter.read(zipSync(parts))).ok).toBe(false)
  })
})
