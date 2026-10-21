import { describe, expect, it } from 'vitest'
import { KmLengths, type Result } from '@eow/shared/kernel'
import type { SegmentBasis } from '@eow/passport/import-api'
import type { ExportTable, PassportForm } from './export-source'
import { parseSegments, type ParsedSegment } from './segment-forms'
import { parseBoundaries } from './org-forms'
import { prepareSegmentImport, segmentLengthRemarks } from './prepare-segment-import'

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}
function table(
  form: PassportForm,
  cells: Readonly<Record<string, string | number | null>>,
): ExportTable {
  const data = {
    'Главный путь': 'УЧЕБНЫЙ I',
    Путь: 'УЧЕБНЫЙ I',
    ...(['class', 'load'].includes(form)
      ? { 'Км нач': 10, 'М нач': 0, 'Км кон': 11, 'М кон': 0 }
      : { 'КМ н.': 10, 'М н.': 0, 'КМ к.': 11, 'М к.': 0 }),
    Длина: 1000,
    'Длина, м': 1000,
    'Длина участка': 1000,
    ...cells,
  }
  return {
    file: 'учебная.xls',
    sheet: 'Характеристики',
    form,
    columns: Object.keys(data).map((name, index) => ({
      name,
      letter: String.fromCharCode(65 + index),
    })),
    rows: [{ line: 7, cells: Object.values(data) }],
  }
}
const basis: SegmentBasis = {
  date: '2026-10-21',
  token: 'a'.repeat(64),
  lines: [{ id: 'line', name: 'УЧЕБНЫЙ I', kmLengths: [] }],
  boundaries: [],
}
const file = {
  name: 'учебная.xls',
  form: 'class',
  sha256: 'b'.repeat(64),
  importedAt: '2026-10-21T06:00:00Z',
  rowCount: 1,
} as const
const row = (): ParsedSegment =>
  value(parseSegments(table('class', { Класс: '3', Группа: 'Г', Категория: '2' })))[0]!

describe('Разбор характеристик', () => {
  it('числа с запятой, ноль и -1 различаются; пустые значения нормализуются', () => {
    const result = value(
      parseSegments(table('load', { Грузонапряженность: '37,5', 'Осевая нагрузка': '0' })),
    )[0]!
    expect(result.values).toMatchObject({ grossMillionTonKm: 37.5, axleLoad: 0 })
    expect(
      value(
        parseSegments(table('load', { Грузонапряженность: '-1', 'Осевая нагрузка': 'Нет данных' })),
      )[0]!.values,
    ).toEqual({ grossMillionTonKm: null, axleLoad: null })
  })
  it('сохраняет диапазон толщины и раздельные правые и левые значения', () => {
    const result = value(
      parseSegments(
        table('ballast', {
          'Толщина балласта': '35-50',
          'Наличие загрязненности': 'Д',
          'Толщина защитного слоя': '-1',
          'Нед.шир. бал.призмы правая': 0,
          'Нед.шир. бал.призмы левая': '2,5',
        }),
      ),
    )[0]!
    expect(result.values).toMatchObject({
      thickness: '35-50',
      contamination: 'Д',
      protectiveThickness: null,
      prismShortageRight: 0,
      prismShortageLeft: 2.5,
    })
  })
  it('не смешивает два столбца типов шпал и не сохраняет служебные столбцы', () => {
    const result = value(
      parseSegments(
        table('sleepers', {
          'Тип шпал': 'ЖБ',
          'Тип шпал (2)': 'деревянные',
          'Предприятие (2)': 'ПД-999',
          Скорректировал: 'ВЫМЫШЛЕННОЕ ФИО',
        }),
      ),
    )[0]!
    expect(result.values).toMatchObject({ sleeperType: 'ЖБ', secondarySleeperType: 'деревянные' })
    expect(JSON.stringify(result)).not.toContain('ПД-999')
    expect(JSON.stringify(result)).not.toContain('ВЫМЫШЛЕННОЕ ФИО')
  })
  it('пропускает подъездные пути до чтения координат главного пути', () => {
    const input = table('sleepers', { 'Признак подъездной': 'Д', 'КМ н.': 'нет координаты' })
    expect(value(parseSegments(input))).toEqual([])
  })
  it('сохраняет дату последней укладки для любого признака', () => {
    for (const sign of ['Н', 'П', 'о'])
      expect(
        value(
          parseSegments(table('rails', { 'Дата укладки': '01.02.2006', 'Признак укладки': sign })),
        )[0]!.values,
      ).toMatchObject({ laidDate: '2006-02-01', layingSign: sign })
  })
  it.each([
    table('load', { Грузонапряженность: '-2' }),
    table('speeds', { 'ПАСС;': 'восемьдесят' }),
    table('rails', { 'Дата укладки': '31.02.2026' }),
    table('class', { 'Км нач': '-1' }),
    table('class', { 'Км нач': '9007199254740993' }),
    table('sleepers', { 'Год выпуска': '2006.5' }),
  ])('ошибка значения указывает исходный файл, лист, строку и столбец', (input) => {
    const result = parseSegments(input)
    expect(result).toMatchObject({
      ok: false,
      error: expect.arrayContaining([
        expect.objectContaining({
          kind: 'bad-value',
          at: expect.objectContaining({
            file: input.file,
            sheet: input.sheet,
            row: 7,
            column: expect.any(String),
          }),
        }),
      ]),
    })
  })
})

describe('Сверка длин', () => {
  it('учитывает ручной нестандартный км, не меняя его', () => {
    const lengths = value(KmLengths.of([[10, 964]]))
    expect(segmentLengthRemarks({ ...row(), statedLength: 964 }, lengths)).toEqual([])
    expect(lengths.entries()).toEqual([[10, 964]])
    expect(
      segmentLengthRemarks({ ...row(), statedLength: 964 }, KmLengths.standard())[0]?.text,
    ).toContain('разница -36 м')
  })
  it('для многокилометрового расхождения указывает диапазон проверки, а не выдумывает длину одного км', () => {
    const result = segmentLengthRemarks(
      { ...row(), to: { km: 13, m: 0 }, statedLength: 3007 },
      KmLengths.standard(),
    )
    expect(result[0]?.text).toContain('Проверьте км 10–12')
    expect(result[0]?.text).toContain('или ошибка исходной длины')
  })
  it('метр за пределами принятой длины км становится замечанием без изменения координаты', () => {
    const data = { ...row(), to: { km: 10, m: 1040 }, statedLength: 1040 }
    expect(segmentLengthRemarks(data, KmLengths.standard())[0]?.text).toContain('1040 м вне 10 км')
    expect(data.to).toEqual({ km: 10, m: 1040 })
  })
  it('пропущенная длина не заменяется на ноль', () => {
    expect(segmentLengthRemarks({ ...row(), statedLength: null }, KmLengths.standard())).toEqual([])
  })
  it('отбор по периоду действия включителен; закрытые строки не попадают в пакет', () => {
    const selected = { ...row(), validity: { from: basis.date, to: basis.date } }
    const closed = { ...row(), validity: { from: null, to: '2026-10-20' } }
    const result = value(prepareSegmentImport([selected, closed], [file], basis))
    expect(result.command.rows).toHaveLength(1)
  })
  it('не принимает обратные границы, неизвестное или неоднозначное направление', () => {
    expect(prepareSegmentImport([{ ...row(), to: { km: 9, m: 0 } }], [file], basis).ok).toBe(false)
    expect(prepareSegmentImport([row()], [file], { ...basis, lines: [] }).ok).toBe(false)
    expect(
      prepareSegmentImport([row()], [file], {
        ...basis,
        lines: [...basis.lines, { ...basis.lines[0]!, id: 'second' }],
      }).ok,
    ).toBe(false)
  })
  it('показывает перекрытие одной характеристики между частями формы, но не смежные строки', () => {
    const first = row()
    const overlap = { ...row(), at: { ...row().at, file: 'часть2.xls' } }
    const adjacent = { ...overlap, from: { km: 11, m: 0 }, to: { km: 12, m: 0 } }
    const files = [file, { ...file, name: 'часть2.xls' }]
    const overlapping = value(prepareSegmentImport([first, overlap], files, basis))
    expect(overlapping.remarks).toMatchObject([
      { text: expect.stringContaining('перекрывается'), at: overlap.at },
    ])
    expect(overlapping.command.rows).toHaveLength(2)
    expect(value(prepareSegmentImport([first, adjacent], files, basis)).remarks).toEqual([])
  })
  it('длина границы -1 означает отсутствие и не блокирует кандидата из характеристики', () => {
    const boundary = value(
      parseBoundaries(
        table('boundaries', {
          Подразделение: 'ПД-1',
          'Длина участка, м': -1,
        }),
      ),
    )[0]!
    expect(boundary.statedLength).toBeNull()
    const current = {
      ...basis,
      boundaries: [
        {
          lineId: 'line',
          subdivisionCode: 'ПД-1',
          from: boundary.from,
          to: boundary.to,
          // Совместимость с основой, полученной из ранее сохранённых границ.
          statedLength: -1,
        },
      ],
    }
    const result = value(prepareSegmentImport([{ ...row(), statedLength: 964 }], [file], current))
    expect(result.remarks).toHaveLength(2)
    expect(
      result.remarks.some((r) => r.text.includes('кандидат') && r.text.includes('964 м')),
    ).toBe(true)
    expect(result.remarks.some((r) => r.text.includes('Граница'))).toBe(false)
    expect(current.boundaries[0]?.statedLength).toBe(-1)
  })
  it.each([null, 1000])(
    'огромный диапазон характеристики с длиной %s отклоняется до расчёта',
    (statedLength) => {
      const data = { ...row(), to: { km: Number.MAX_SAFE_INTEGER, m: 0 }, statedLength }
      const result = prepareSegmentImport([data], [file], basis)
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'invalid-import', message: expect.stringContaining('технический предел') },
      })
      if (result.ok) throw new Error('Ожидался отказ импорта')
      expect(result.error.message).toContain('учебная.xls')
      expect(result.error.message).toContain('Характеристики')
      expect(result.error.message).toContain('строка 7')
      expect(segmentLengthRemarks(data, KmLengths.standard())).toMatchObject([
        { text: expect.stringContaining('технический предел') },
      ])
    },
  )
  it('огромный диапазон сохранённой границы тоже отклоняется до расчёта', () => {
    const result = prepareSegmentImport([row()], [file], {
      ...basis,
      boundaries: [
        {
          lineId: 'line',
          subdivisionCode: 'ПД-1',
          from: { km: 10, m: 0 },
          to: { km: Number.MAX_SAFE_INTEGER, m: 0 },
          statedLength: null,
        },
      ],
    })
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import', message: expect.stringContaining('Граница ПД-1') },
    })
  })
  it('сверяет также исходные длины границ подразделений и помещает их в отчёт', () => {
    const current = {
      ...basis,
      boundaries: [
        {
          lineId: 'line',
          subdivisionCode: 'ПД-1',
          from: { km: 10, m: 0 },
          to: { km: 11, m: 0 },
          statedLength: 964,
        },
      ],
    }
    const result = value(prepareSegmentImport([row()], [file], current))
    expect(result.command.files[0]?.warnings[0]?.text).toContain('Граница ПД-1')
    expect(result.remarks).toHaveLength(1)
  })
})
