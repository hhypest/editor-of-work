import { describe, expect, it } from 'vitest'
import { parseStationAxes, parseStationTracks, parseStationSwitches } from './station-forms'
import { parseCrossingPlace, parseCrossings, type ImportedCrossing } from './crossing-forms'
import { checkStations, checkTerritories, type ImportedTerritory } from './station-check'
import type { ExportTable, PassportForm } from './export-source'
import type { Result } from '@eow/shared/kernel'
function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
function table(
  form: PassportForm,
  data: Readonly<Record<string, string | number | null>>,
  file = 'учебная.xls',
): ExportTable {
  return {
    form,
    file,
    sheet: 'Лист1',
    columns: Object.keys(data).map((name, i) => ({ name, letter: String.fromCharCode(65 + i) })),
    rows: [{ line: 7, cells: Object.values(data) }],
  }
}
const crossing: ImportedCrossing = {
  title: 'Переезд на станции УЧЕБНАЯ № 1 10км1пк',
  number: '1',
  name: null,
  direction: 'УЧЕБНЫЙ',
  stationColumn: null,
  titleStation: 'УЧЕБНАЯ',
  place: { km: 10, pk: 1, siding: null },
  category: null,
  type: null,
  region: null,
  district: null,
  city: null,
  road: null,
  regulated: null,
  signalling: null,
  surface: null,
  barriers: null,
  trainsPerDay: null,
  vehiclesPerDay: null,
  trainSpeed: null,
  lastOverhaul: null,
  at: { file: 'общие.xlsx', sheet: 'Лист1', row: 2 },
}
describe('Станционные формы и сверки', () => {
  it.each(['10км0пк', '10км11пк', '9007199254740993км1пк'])(
    'не принимает ошибочную привязку %s',
    (text) => {
      expect(parseCrossingPlace(text)).toBeNull()
    },
  )
  it('не выбирает последний из главных путей одного направления', () => {
    const lines = ['Главный путь УЧЕБНЫЙ, 1', 'Главный путь УЧЕБНЫЙ, 2']
    for (const input of [lines, lines.toReversed()]) {
      const result = checkStations(
        { axes: [], tracks: [], switches: [], crossings: [crossing], lines: input },
        '2026-10-21',
        new Set(),
      )
      expect(result.crossingLines.get(crossing.title)?.toSorted()).toEqual(lines)
    }
  })
  it('путь без оси станции остаётся в данных с замечанием', () => {
    const track = value(
      parseStationTracks(
        table('station-tracks', {
          Станция: 'НЕИЗВЕСТНАЯ',
          'Назначение путей по ТРА': 'приёмный',
          Номер: 'I',
        }),
      ),
    )[0]!
    const result = checkStations(
      { axes: [], tracks: [track], switches: [], crossings: [], lines: [] },
      '2026-10-21',
      new Set(),
    )
    expect(result.tracks).toEqual([track])
    expect(result.remarks[0]?.text).toContain('нет в осях')
  })
  it.each(['ошибка', '-2', '2006.5'])(
    'год ремонта %s даёт ошибку со строкой и столбцом',
    (year) => {
      const result = parseStationTracks(
        table('station-tracks', {
          Станция: 'УЧЕБНАЯ',
          'Назначение путей по ТРА': 'приёмный',
          Номер: 'I',
          'Последний ремонт капитального характера / год': year,
        }),
      )
      expect(result).toMatchObject({
        ok: false,
        error: [{ kind: 'bad-value', at: { row: 7, column: 'D' } }],
      })
    },
  )
  it('специальный знак # вместо года остаётся отсутствием', () => {
    const rows = value(
      parseStationTracks(
        table('station-tracks', {
          Станция: 'УЧЕБНАЯ',
          'Назначение путей по ТРА': 'приёмный',
          Номер: 'I',
          'Последний ремонт капитального характера / год': '#',
        }),
      ),
    )
    expect(rows[0]?.lastRepairYear).toBeNull()
  })
  it('метр границы без километра не превращается в отсутствие всей точки', () => {
    const result = parseStationAxes(
      table('station-axes', {
        Станция: 'УЧЕБНАЯ',
        Путь: 'УЧЕБНЫЙ',
        'Ось, км': 10,
        'Ось, м': 100,
        'Граница начала, км': null,
        'Граница начала, м': 100,
      }),
    )
    expect(result).toMatchObject({
      ok: false,
      error: [{ kind: 'bad-value', at: { row: 7, header: 'Граница начала, км' } }],
    })
  })
  it('дополнительная крестовина без перевода не отбрасывается молча', () => {
    expect(
      parseStationSwitches(
        table('switches', { Станция: null, '№ стр. перевода': null, 'Крестовины / марка': '1/9' }),
      ),
    ).toMatchObject({ ok: false, error: [{ kind: 'bad-value', at: { row: 7 } }] })
  })
  it('дубликаты переезда в частях формы отклоняются до сведения книг', () => {
    const general = table('crossings-general', { Переезд: crossing.title, Номер: '1' })
    expect(
      parseCrossings([general, { ...general, file: 'часть2.xls' }], undefined, undefined),
    ).toMatchObject({ ok: false, error: [{ kind: 'bad-value', at: { file: 'часть2.xls' } }] })
  })
  it('переезд только в технической книге даёт замечание с её файлом', () => {
    const general = table('crossings-general', { Переезд: crossing.title, Номер: '1' })
    const technical = table(
      'crossings-technical',
      { Переезд: 'Несопоставленный переезд', 'Вид регулирования': 'Регулируемый' },
      'технические.xlsx',
    )
    expect(value(parseCrossings(general, technical, undefined)).remarks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          at: expect.objectContaining({ file: 'технические.xlsx' }),
          text: expect.stringContaining('нет в общих'),
        }),
      ]),
    )
  })
  it('одинаковый несопоставленный переезд остаётся замечанием обеих книг, включая части', () => {
    const general = table('crossings-general', { Переезд: crossing.title, Номер: '1' })
    const second = table(
      'crossings-general',
      { Переезд: 'Учебный переезд № 2 11км1пк', Номер: '2' },
      'часть2.xls',
    )
    const tech = table('crossings-technical', { Переезд: 'Несопоставленный' }, 'технические.xlsx')
    const oper = table(
      'crossings-operational',
      { Переезд: 'Несопоставленный' },
      'эксплуатационные.xlsx',
    )
    const result = value(parseCrossings([general, second], tech, oper))
    expect(result.crossings).toHaveLength(2)
    expect(
      result.remarks
        .filter((r) => r.text.includes('нет в общих'))
        .map((r) => r.at?.file)
        .toSorted(),
    ).toEqual(['технические.xlsx', 'эксплуатационные.xlsx'])
  })
  it('цикл территорий и отсутствующий родитель становятся замечаниями', () => {
    const base: ImportedTerritory = {
      name: 'А',
      type: 'область',
      parent: 'Б',
      parentType: 'область',
      validity: { from: null, to: '9999-12-31' },
      at: crossing.at,
    }
    expect(checkTerritories([base], '2026-10-21').remarks[0]?.text).toContain('нет вышестоящей')
    expect(
      checkTerritories([base, { ...base, name: 'Б', parent: 'А' }], '2026-10-21').remarks[0]?.text,
    ).toContain('по кругу')
  })
})
