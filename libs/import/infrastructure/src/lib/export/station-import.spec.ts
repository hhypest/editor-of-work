import {
  checkStations,
  checkTerritories,
  parseCrossings,
  parseOkato,
  parseStationAxes,
  parseStationSwitches,
  parseStationTracks,
  type ExportTable,
} from '@eow/import/application'
import type { Result } from '@eow/shared/kernel'
import { generatePassportFixtures } from '../testing/passport/generate'
import { LINES } from '../testing/passport/model'
import { PassportExportSource } from './passport-export-source'

function value<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}

let tables: Map<string, ExportTable>

beforeAll(async () => {
  const source = new PassportExportSource()
  tables = new Map()
  for (const f of await generatePassportFixtures()) {
    if (f.path.startsWith('frameset/')) continue
    const r = await source.read({ name: f.path, bytes: f.bytes })
    if (r.ok) for (const t of r.value) tables.set(t.form, t)
  }
})

function get(form: string): ExportTable {
  const t = tables.get(form)
  if (!t) throw new Error(`нет ${form}`)
  return t
}

function sources() {
  return {
    axes: value(parseStationAxes(get('station-axes'))),
    tracks: value(parseStationTracks(get('station-tracks'))),
    switches: value(parseStationSwitches(get('switches'))),
    crossings: value(
      parseCrossings(
        get('crossings-general'),
        get('crossings-technical'),
        get('crossings-operational'),
      ),
    ).crossings,
    lines: LINES.map((l) => l.name),
  }
}

const date = '2026-10-21'

describe('Станции, пути, стрелки и переезды из вымышленных выгрузок', () => {
  it('строки итогов отчётов BEx пропущены, оси станции примыкания — две', () => {
    const s = sources()
    expect(s.tracks.every((t) => !t.purpose.startsWith('Итого'))).toBe(true)
    expect(s.tracks).toHaveLength(20)
    expect(s.switches).toHaveLength(30)
    expect(s.axes.filter((a) => a.station === 'РАЗЪЕЗДНАЯ')).toHaveLength(2)
    expect(s.tracks[0]).toMatchObject({
      station: 'ОЗЕРНАЯ',
      number: 'I',
      from: '1',
      via: ['3', '5'],
      to: '2',
      railType: 'Р65',
    })
  })

  it('переезды сведены из трёх книг: число поездов и скорость', () => {
    const c = sources().crossings.find((x) => x.number === '1')
    expect(c).toMatchObject({
      titleStation: 'ОЗЕРНАЯ',
      place: { km: 15, pk: 3 },
      trainsPerDay: 14,
      trainSpeed: 90,
      regulated: true,
    })
  })

  it('замечания: стрелка на границе пути отсутствует, станция переезда не по километру', () => {
    const r = checkStations(sources(), date, new Set())
    expect(r.remarks.map((x) => x.text)).toEqual([
      'Путь № 4 станции КЛЮЧЕВАЯ: в экспликации стрелок нет перевода № 11',
      'Переезд № 2 записан «на станции ОЗЕРНАЯ», но 21 км пк 7 вне её границ — проверьте станцию в названии',
    ])
    expect(r.exclusionCandidates).toEqual(['ЗАРЕЧЬЕ'])
    expect(r.crossingLines.size).toBe(5)
  })

  it('ликвидированная станция исключается списком исключений редакции', () => {
    const r = checkStations(sources(), date, new Set(['ЗАРЕЧЬЕ']))
    expect(r.axes.some((a) => a.station === 'ЗАРЕЧЬЕ')).toBe(false)
    expect(r.exclusionCandidates).toEqual([])
    expect(r.remarks.map((x) => x.text)).toContain(
      'Переезд № 3: в названии исключённая станция ЗАРЕЧЬЕ; переезд остаётся на направлении по километру',
    )
  })

  it('ОКАТО: дерево территорий без замечаний', () => {
    const t = checkTerritories(value(parseOkato(get('okato'))), date)
    expect(t.territories).toHaveLength(4)
    expect(t.remarks).toEqual([])
  })
})
