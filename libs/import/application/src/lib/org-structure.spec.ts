import type { ExportTable } from './export-source'
import {
  parseBoundaries,
  parseParent,
  parseTrackPd,
  type ImportedBoundary,
  type ImportedSubdivision,
} from './org-forms'
import { buildOrgStructure, subdivisionChoices, validOn } from './org-structure'

const at = { file: 'f.xls', sheet: 'Лист1', row: 2 }
const open = '9999-12-31'

function unit(
  code: string,
  type: string,
  parent: string | null,
  from: string,
  to = open,
): ImportedSubdivision {
  return {
    code,
    externalId: `ID_${code}`,
    type,
    activity: null,
    number: Number(code.replace(/\D+/gu, '')),
    parent: parseParent(parent),
    validity: { from, to },
    at,
  }
}

function border(
  subdivision: string,
  fromKm: number,
  toKm: number,
  from = '2017-08-01',
  line = 'L1',
): ImportedBoundary {
  return {
    subdivision,
    line,
    from: { km: fromKm, m: 0 },
    to: { km: toKm, m: 0 },
    validity: { from, to: open },
    at,
  }
}

const subdivisions = [
  unit('ПЧУ-1', 'ПЧУ', 'ИЧ-0', '2020-07-28'),
  unit('ПД-1', 'ПД', 'ИЧ-0, ПЧУ-01', '2026-04-01'),
  unit('ПД-2', 'ПД', 'ИЧ-0, ПЧУ-01', '2026-04-01'),
  unit('ПД-11', 'ПД', 'ИЧ-0, ПЧУ-01', '2017-08-01'),
  unit('ПД-15', 'ПД', 'ИЧ-0, ПЧУ-01', '2017-08-01', '2026-03-31'),
  unit('ЗП-1', 'ЗП', 'ИЧ-0', '2017-10-26'),
  unit('ПДБ-1', 'ПДБ', 'ИЧ-0, ПЧУ-01', '2017-10-26'),
]
const boundaries = [
  border('ПД-1', 10, 18, '2026-04-01'),
  border('ПД-2', 18, 25, '2026-04-01'),
  border('ПД-11', 10, 25),
  border('ЗП-1', 10, 25),
]
const date = '2026-10-21'

describe('Период действия', () => {
  it('начало и конец включаются, «31.12.9999» — открытый конец', () => {
    expect(validOn({ from: '2026-04-01', to: open }, '2026-04-01')).toBe(true)
    expect(validOn({ from: '2017-08-01', to: '2026-03-31' }, '2026-04-01')).toBe(false)
    expect(validOn({ from: null, to: open }, date)).toBe(true)
  })
})

describe('Мастер отметки действующих подразделений', () => {
  const choices = subdivisionChoices(subdivisions, boundaries, date)

  it('показывает все открытые ПЧУ и ПД, прежние и новые; закрытые и цеха — нет', () => {
    expect(choices.map((c) => c.code)).toEqual(['ПЧУ-1', 'ПД-1', 'ПД-2', 'ПД-11'])
  })

  it('ПД без границ на дату редакции не предлагается', () => {
    const closed = boundaries.map((b) =>
      b.subdivision === 'ПД-11' ? { ...b, validity: { from: '2017-08-01', to: '2026-03-31' } } : b,
    )
    const pd11 = subdivisionChoices(subdivisions, closed, date).find((c) => c.code === 'ПД-11')
    expect(pd11).toMatchObject({
      segments: 0,
      suggested: false,
      note: 'нет границ на дату редакции',
    })
  })

  it('пересечение границ выдаёт прежний код; предложение — новые ПД', () => {
    const byCode = new Map(choices.map((c) => [c.code, c]))
    expect(byCode.get('ПД-11')).toMatchObject({
      overlapsWith: ['ПД-1', 'ПД-2'],
      suggested: false,
      note: 'границы пересекаются с ПД-1, ПД-2, начатыми позже',
    })
    expect(byCode.get('ПД-1')).toMatchObject({ overlapsWith: ['ПД-11'], suggested: true })
    expect(byCode.get('ПЧУ-1')?.suggested).toBe(true)
  })
})

describe('Оргструктура по отмеченным', () => {
  const sources = { subdivisions, boundaries, stationPd: [], trackPd: [] }

  it('иерархия ПЧУ → ПД; цеха и бригады отдельно', () => {
    const org = buildOrgStructure(sources, date, new Set(['ПД-1', 'ПД-2']))
    expect(org.units).toEqual([
      { code: 'ПЧУ-1', externalId: 'ID_ПЧУ-1', type: 'ПЧУ', parent: null },
      { code: 'ПД-1', externalId: 'ID_ПД-1', type: 'ПД', parent: 'ПЧУ-1' },
      { code: 'ПД-2', externalId: 'ID_ПД-2', type: 'ПД', parent: 'ПЧУ-1' },
    ])
    expect(org.otherUnits.map((u) => u.code)).toEqual(['ЗП-1', 'ПДБ-1'])
    expect(org.boundaries.map((b) => b.subdivision)).toEqual(['ПД-1', 'ПД-2', 'ЗП-1'])
    expect(org.remarks).toEqual([])
  })

  it('отрезки разных отмеченных ПД перекрываются — замечание', () => {
    const org = buildOrgStructure(sources, date, new Set(['ПД-1', 'ПД-11']))
    expect(org.remarks.map((r) => r.text)).toEqual([
      'Границы ПД-1 и ПД-11 перекрываются на «L1» 10+000 – 18+000',
    ])
  })

  it('ПД без ПЧУ и ПД без границ — замечания', () => {
    const org = buildOrgStructure(
      {
        ...sources,
        subdivisions: [...subdivisions, unit('ПД-9', 'ПД', 'ИЧ-0, ПЧУ-07', '2026-04-01')],
      },
      date,
      new Set(['ПД-9']),
    )
    expect(org.remarks.map((r) => r.text)).toEqual([
      'ПД-9 подчиняется «ПЧУ-07», а такого ПЧУ на дату редакции нет',
      'У ПД-9 нет границ на дату редакции',
    ])
  })

  it('станция привязывается к отмеченному ПД; без него или к двум сразу — замечание', () => {
    const v = { from: '2017-08-01', to: open }
    const stationPd = [
      { subdivision: 'ПД-11', station: 'А', validity: v, at },
      { subdivision: 'ПД-1', station: 'А', validity: v, at },
      { subdivision: 'ПД-11', station: 'Б', validity: v, at },
      { subdivision: 'ПД-1', station: 'В', validity: v, at },
      { subdivision: 'ПД-2', station: 'В', validity: v, at },
    ]
    const org = buildOrgStructure({ ...sources, stationPd }, date, new Set(['ПД-1', 'ПД-2']))
    expect([...org.stations]).toEqual([['А', 'ПД-1']])
    expect(org.remarks.map((r) => r.text)).toEqual([
      'Станция Б не привязана ни к одному отмеченному ПД',
      'Станция В привязана сразу к ПД-1, ПД-2',
    ])
  })
})

describe('Подчинение', () => {
  it('«предприятие, ПЧУ-01» — ПЧУ № 1; одно предприятие — без вышестоящего', () => {
    expect(parseParent('ИЧ-0 УЧЕБНАЯ П, ПЧУ-01')).toEqual({
      type: 'ПЧУ',
      number: 1,
      text: 'ПЧУ-01',
    })
    expect(parseParent('ИЧ-0 УЧЕБНАЯ П')).toBeNull()
    expect(parseParent(null)).toBeNull()
  })
})

function table(form: ExportTable['form'], headers: string[], rows: string[][]): ExportTable {
  return {
    file: 'f.xls',
    sheet: 'Лист1',
    form,
    columns: headers.map((name, i) => ({ name, letter: String.fromCodePoint(65 + i) })),
    rows: rows.map((cells, i) => ({ line: i + 2, cells })),
  }
}

describe('Разбор форм', () => {
  it('границы: «37.0» — целые км и м; дробный метр — ошибка с местом', () => {
    const t = table(
      'boundaries',
      [
        'Подразделение',
        'Главный путь',
        'КМ н.',
        'М н.',
        'КМ к.',
        'М к.',
        'Дата начала действия',
        'Дата конца действия',
      ],
      [
        ['ПД-1', 'L1', '10.0', '0.0', '18.0', '0.0', '01.04.2026', '31.12.9999'],
        ['ПД-2', 'L1', '18.0', '0.5', '25.0', '0.0', '01.04.2026', '31.12.9999'],
      ],
    )
    const r = parseBoundaries(t)
    expect(r.ok).toBe(false)
    expect(r.ok ? [] : r.error).toMatchObject([
      { kind: 'bad-value', value: '0.5', at: { row: 3, column: 'D', header: 'М н.' } },
    ])
  })

  it('пути: «Н» — метры, «Д» — весь путь', () => {
    const t = table(
      'track-pd',
      [
        'Подразделение',
        'Станция',
        'Путь',
        'Признак - весь путь',
        'Метр начала',
        'Метр конца',
        'Начало действия',
        'Конец действия',
      ],
      [
        ['ПД-1', 'А', 'Путь 3', 'Д', '0', '0', '01.04.2026', '31.12.9999'],
        ['ПД-1', 'А', 'ГП А', 'Н', '181', '0', '01.04.2026', '31.12.9999'],
      ],
    )
    const r = parseTrackPd(t)
    expect(r.ok ? r.value.map((x) => x.meters) : r.error).toEqual([null, { start: 181, end: 0 }])
    const org = buildOrgStructure(
      { subdivisions, boundaries, stationPd: [], trackPd: r.ok ? r.value : [] },
      date,
      new Set(['ПД-1', 'ПД-2']),
    )
    expect(org.remarks.map((x) => x.text)).toEqual([
      'Путь «ГП А» станции А: метр конца 0 меньше метра начала 181',
    ])
  })
})
