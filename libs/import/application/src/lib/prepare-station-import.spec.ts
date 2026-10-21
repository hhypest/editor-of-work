import { describe, expect, it } from 'vitest'
import { STATION_FORMS, crossingTerritory, type StationBasis } from '@eow/passport/import-api'
import type { Result } from '@eow/shared/kernel'
import { prepareStationImport, type StationSourcesForImport } from './prepare-station-import'
import { parseCrossings } from './crossing-forms'
import { parseStationAxes } from './station-forms'
import type { ExportTable, PassportForm } from './export-source'

function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}
function table(form: PassportForm, data: Record<string, string | number>): ExportTable {
  return {
    form,
    file: form + '.xls',
    sheet: 'Лист1',
    columns: Object.keys(data).map((name, i) => ({ name, letter: String.fromCharCode(65 + i) })),
    rows: [{ line: 7, cells: Object.values(data) }],
  }
}
const files = STATION_FORMS.map((form) => ({
  form,
  name: form + '.xls',
  sheets: ['Лист1'],
  sha256: 'a'.repeat(64),
  importedAt: '2026-10-21T00:00:00Z',
  rowCount: 1,
}))
const basis: StationBasis = {
  token: 'a'.repeat(64),
  date: '2026-10-21',
  lines: [
    {
      id: 'line',
      name: 'УЧЕБНЫЙ',
      kmLengths: [[10, 1045]],
      extents: [
        { from: { km: 10, m: 50 }, to: { km: 11, m: 0 } },
        { from: { km: 13, m: 0 }, to: { km: 14, m: 0 } },
      ],
    },
  ],
  stations: [],
  tracks: [],
  excludedStations: [],
}
function sources(km: number): StationSourcesForImport {
  return {
    axes: value(
      parseStationAxes(
        table('station-axes', {
          Станция: 'УЧЕБНАЯ',
          Путь: 'УЧЕБНЫЙ',
          'Ось, км': km,
          'Ось, м': 100,
        }),
      ),
    ),
    tracks: [],
    switches: [],
    territories: [],
    remarks: [],
    crossings: value(
      parseCrossings(
        table('crossings-general', {
          Переезд: `Учебный переезд № 1 ${km}км1пк`,
          Номер: '1',
          Направление: 'УЧЕБНЫЙ',
          'Дата создания': '1965-01-01',
          'Дата закрытия': '31.12.9999',
        }),
        undefined,
        undefined,
      ),
    ).crossings,
  }
}
describe('Предпросмотр станционного импорта', () => {
  it.each([10, 13])(
    'ось и пересекающий протяжение пикет %s км принимаются без замечания о границах направления',
    (km) => {
      const preview = value(prepareStationImport(sources(km), files, basis))
      expect(preview.remarks.some((r) => r.text.includes('вне протяжения'))).toBe(false)
      expect(preview.command.rows.find((r) => r.form === 'crossings-general')).toMatchObject({
        validFrom: '1965-01-01',
        validTo: '9999-12-31',
      })
    },
  )
  it.each([9, 12, 15])(
    'ось и переезд %s км вне протяжения или в разрыве получают замечания своей формы',
    (km) => {
      const preview = value(prepareStationImport(sources(km), files, basis))
      const remarks = preview.remarks.filter((r) => r.text.includes('вне протяжения'))
      expect(remarks).toHaveLength(2)
      for (const name of ['station-axes.xls', 'crossings-general.xls'])
        expect(preview.command.files.find((f) => f.name === name)?.warnings).toContainEqual(
          expect.objectContaining({
            at: { file: name, sheet: 'Лист1', row: 7 },
            text: expect.stringContaining('вне протяжения'),
          }),
        )
    },
  )
  it('повтор номера при разных названиях отклоняется, исторический переезд не создаёт конфликта', () => {
    const input = sources(10),
      crossing = input.crossings[0]!
    const duplicate = { ...crossing, title: 'Другое название', at: { ...crossing.at, row: 8 } }
    expect(
      prepareStationImport({ ...input, crossings: [crossing, duplicate] }, files, basis),
    ).toMatchObject({ ok: false, error: { message: expect.stringContaining('номера переездов') } })
    const preview = value(
      prepareStationImport(
        {
          ...input,
          crossings: [crossing, { ...duplicate, validity: { from: null, to: '2025-12-31' } }],
        },
        files,
        basis,
      ),
    )
    expect(preview.command.rows.filter((r) => r.form === 'crossings-general')).toHaveLength(1)
  })
  it('неподтверждённое место ОКАТО сохраняется с замечанием', () => {
    const input = sources(10)
    const preview = value(
      prepareStationImport(
        { ...input, crossings: input.crossings.map((c) => ({ ...c, city: 'НЕИЗВЕСТНЫЙ' })) },
        files,
        basis,
      ),
    )
    expect(
      preview.command.files.find((f) => f.form === 'crossings-general')?.warnings,
    ).toContainEqual(
      expect.objectContaining({ text: expect.stringContaining('не сопоставлено однозначно') }),
    )
  })
})
describe('Сопоставление переезда с деревом ОКАТО', () => {
  const region = { name: 'ОБЛАСТЬ', type: 'Область', parent: null, parentType: null }
  const district = { name: 'РАЙОН', type: 'Район', parent: region.name, parentType: region.type }
  const city = { name: 'ГОРОД', type: 'Город', parent: district.name, parentType: district.type }
  const territories = [region, district, city]
  it.each([
    [{ region: region.name, district: null, city: null }, region],
    [{ region: region.name, district: district.name, city: null }, district],
    [{ region: region.name, district: district.name, city: city.name }, city],
    [{ region: 'ДРУГАЯ', district: null, city: city.name }, null],
    [{ region: region.name, district: null, city: 'НЕИЗВЕСТНЫЙ' }, null],
  ])('наиболее конкретное место %j', (location, expected) => {
    expect(crossingTerritory(location, territories)).toEqual(expected)
  })
  it('при двух одноимённых городах не выбирает первый', () => {
    expect(
      crossingTerritory({ region: null, district: null, city: city.name }, [
        ...territories,
        { ...city, parent: null, parentType: null },
      ]),
    ).toBeNull()
  })
})
