import { describe, expect, it } from 'vitest'
import {
  headOn,
  validateManualData,
  type ManualBasis,
  type ManualData,
} from '@eow/passport/import-api'
const period = { id: 'one', validFrom: null, validTo: null }
const empty: ManualData = {
  workKinds: [],
  repairNorms: [],
  tolerances: [],
  trainPairs: [],
  kilometres: [],
  heads: [],
}
const basis: Pick<ManualBasis, 'lines' | 'trackClasses'> = {
  trackClasses: ['УЧЕБНЫЙ'],
  lines: [
    {
      id: 'line',
      name: 'УЧЕБНОЕ',
      kmLengths: [],
      extents: [
        { from: { km: 10, m: 0 }, to: { km: 11, m: 0 } },
        { from: { km: 13, m: 0 }, to: { km: 15, m: 0 } },
      ],
    },
  ],
}
const kind = {
  ...period,
  code: 'УЧ',
  name: 'Учебная работа',
  unit: 'км',
  group: 'current',
  symbol: null,
  includedIn: null,
}
const pair = {
  ...period,
  line: 'УЧЕБНОЕ',
  from: { km: 10, m: 0 },
  to: { km: 10, m: 950 },
  freight: 2.5,
  passenger: null,
  suburban: 0,
}
const norm = {
  ...period,
  workCode: kind.code,
  trackClass: 'УЧЕБНЫЙ',
  trackGroup: null,
  trackCategory: null,
  railType: null,
  sleeperType: null,
  years: 7.5,
  millionTons: null,
}
describe('Ручные данные — правила до записи', () => {
  it('пустой шаблон не добавляет нормативов, а допуски остаются справкой', () => {
    expect(validateManualData(empty, basis)).toEqual([])
    expect(
      validateManualData(
        {
          ...empty,
          tolerances: [
            {
              ...period,
              code: 'X',
              name: 'Вымышленный допуск',
              value: -2.5,
              unit: 'мм',
              conditions: null,
            },
          ],
        },
        basis,
      ),
    ).toEqual([])
  })
  it('порог приходит из данных, единицы вхождения совпадают, классы взяты из паспорта', () => {
    expect(validateManualData({ ...empty, workKinds: [kind], repairNorms: [norm] }, basis)).toEqual(
      [],
    )
    for (const change of [
      { years: null },
      { years: 0 },
      { workCode: 'НЕТ' },
      { trackClass: 'НЕТ' },
    ])
      expect(
        validateManualData(
          { ...empty, workKinds: [kind], repairNorms: [{ ...norm, ...change }] },
          basis,
        ),
      ).not.toEqual([])
  })
  it('нормы с одинаковыми условиями не перекрываются по периоду', () => {
    expect(
      validateManualData(
        {
          ...empty,
          workKinds: [kind],
          repairNorms: [norm, { ...norm, id: 'two', validFrom: '2020-01-01' }],
        },
        basis,
      ),
    ).not.toEqual([])
    expect(
      validateManualData(
        {
          ...empty,
          workKinds: [kind],
          repairNorms: [
            { ...norm, validTo: '2025-12-31' },
            { ...norm, id: 'two', validFrom: '2026-01-01' },
          ],
        },
        basis,
      ),
    ).toEqual([])
  })
  it('цикл, неизвестный родитель и смешанные единицы вхождения отклоняются', () => {
    for (const kinds of [
      [{ ...kind, includedIn: kind.code }],
      [{ ...kind, includedIn: 'НЕТ' }],
      [
        { ...kind, includedIn: 'Б' },
        { ...kind, id: 'two', code: 'Б', unit: 'шт' },
      ],
      [
        { ...kind, includedIn: 'Б' },
        { ...kind, id: 'two', code: 'Б', includedIn: kind.code },
      ],
    ])
      expect(validateManualData({ ...empty, workKinds: kinds }, basis)).not.toEqual([])
  })
  it('пары поездов проверяются по новым длинам км и не могут пересекать разрывы', () => {
    expect(validateManualData({ ...empty, trainPairs: [pair] }, basis)).toEqual([])
    expect(
      validateManualData(
        {
          ...empty,
          trainPairs: [pair],
          kilometres: [{ ...period, line: pair.line, km: 10, length: 920 }],
        },
        basis,
      ),
    ).toContainEqual(
      expect.objectContaining({
        sheet: 'Пары поездов',
        row: 2,
        message: 'Координата вне длины километра',
      }),
    )
    expect(
      validateManualData({ ...empty, trainPairs: [{ ...pair, to: { km: 14, m: 0 } }] }, basis),
    ).toContainEqual(expect.objectContaining({ message: expect.stringContaining('разрыв') }))
  })
  it('перекрытие участков допускается только в разные периоды, смежные участки допустимы', () => {
    expect(
      validateManualData({ ...empty, trainPairs: [pair, { ...pair, id: 'two' }] }, basis),
    ).not.toEqual([])
    expect(
      validateManualData(
        {
          ...empty,
          trainPairs: [
            { ...pair, validTo: '2025-12-31' },
            { ...pair, id: 'two', validFrom: '2026-01-01' },
          ],
        },
        basis,
      ),
    ).toEqual([])
    expect(
      validateManualData(
        {
          ...empty,
          trainPairs: [pair, { ...pair, id: 'two', from: pair.to, to: { km: 11, m: 0 } }],
        },
        basis,
      ),
    ).toEqual([])
  })
  it.each([900, -1, 1045.5])('не принимает длину км %s', (length) => {
    expect(
      validateManualData(
        { ...empty, kilometres: [{ ...period, line: pair.line, km: 10, length }] },
        basis,
      ),
    ).not.toEqual([])
  })
  it('дубликаты км, неизвестное направление и обратный период показывают лист и строку', () => {
    const km = { ...period, line: pair.line, km: 10, length: 1045 }
    for (const kilometres of [
      [km, { ...km, id: 'two' }],
      [{ ...km, line: 'НЕТ' }],
      [{ ...km, km: 12 }],
      [{ ...km, validFrom: '2026-10-22', validTo: '2026-10-21' }],
    ])
      expect(validateManualData({ ...empty, kilometres }, basis)).toContainEqual(
        expect.objectContaining({ sheet: 'Нестандартные километры', row: expect.any(Number) }),
      )
  })

  it('проверяет лист «Руководители»: код подразделения, название дистанции, периоды', () => {
    const head = (id: string, subdivision: string, extra: object = {}) => ({
      id,
      validFrom: null,
      validTo: null,
      subdivision,
      title: null,
      head: 'Учебный И.И.',
      ...extra,
    })
    const withOrg = { ...basis, subdivisions: ['ПД-1', 'ПЧУ-1'] }
    const ok = [
      head('d', 'Дистанция', { title: 'Учебная дистанция', head: null }),
      head('a', 'ПД-1', { validTo: '2026-12-31' }),
      head('b', 'ПД-1', { validFrom: '2027-01-01', head: 'Другой Д.Д.' }),
    ]
    expect(validateManualData({ ...empty, heads: ok }, withOrg)).toEqual([])
    const messages = validateManualData(
      {
        ...empty,
        heads: [
          head('x', 'ПД-9'),
          head('y', 'Дистанция', { head: null }),
          head('z', 'ПЧУ-1', { head: null }),
          head('p', 'ПД-1'),
          head('q', 'ПД-1'),
          head('l', 'ПЧУ-1', { head: 'Ф'.repeat(101) }),
        ],
      },
      withOrg,
    ).map((i) => `${i.row}:${i.column}:${i.message}`)
    expect(messages).toEqual([
      '2:Подразделение:Нет подразделения с таким кодом; для названия дистанции — «Дистанция»',
      '3:Наименование:Укажите название дистанции',
      '3:Руководитель:Заполните наименование или руководителя',
      '4:Руководитель:Заполните наименование или руководителя',
      '6:Подразделение:Подразделение повторяется в пересекающихся периодах',
      '7:Руководитель:Длиннее 100 знаков',
      '7:Подразделение:Подразделение повторяется в пересекающихся периодах',
    ])
    expect(headOn(ok, 'ПД-1', '2026-06-01')?.head).toBe('Учебный И.И.')
    expect(headOn(ok, 'ПД-1', '2027-06-01')?.head).toBe('Другой Д.Д.')
    expect(headOn(ok, 'ПЧУ-1', '2027-06-01')).toBeUndefined()
  })
})
