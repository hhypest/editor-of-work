import { passportOverviewSource, type PassportOverviewData } from './overview-source'

const common = { importFileId: 'file', validFrom: null, validTo: '9999-12-31' }
const data: PassportOverviewData = {
  edition: { id: 1, label: 'Учебная', date: '2027-01-01' },
  lines: [{ id: 'l', name: 'УЧЕБНОЕ', extents: [], kmLengths: [] }],
  org: {
    subdivisions: [
      {
        ...common,
        id: 'pd',
        code: 'ПД-1',
        type: 'ПД',
        active: true,
        parentId: null,
        activity: null,
      },
      {
        ...common,
        id: 'old',
        code: 'ПД-старый',
        type: 'ПД',
        active: false,
        parentId: null,
        activity: null,
      },
    ],
    boundaries: ['pd', 'old'].map((subdivisionId) => ({
      ...common,
      id: subdivisionId,
      subdivisionId,
      line: 'УЧЕБНОЕ',
      statedLength: null,
      from: { km: 10, m: 0 },
      to: { km: 11, m: 0 },
    })),
    stations: [],
    tracks: [],
  },
  stations: [
    {
      ...common,
      id: 's',
      form: 'station-axes',
      values: {
        station: 'УЧЕБНАЯ',
        line: 'УЧЕБНОЕ',
        axis: { km: 10, m: 500 },
        from: null,
        to: null,
        firstSwitch: null,
        lastSwitch: null,
        trackSection: null,
      },
    },
  ],
}
describe('Проекция паспорта для схемы', () => {
  it('берёт только действующие ПД и строки на дату редакции', () => {
    const source = passportOverviewSource(data)
    expect(source.boundaries.map((b) => b.code)).toEqual(['ПД-1'])
    expect(source.axes.map((a) => a.name)).toEqual(['УЧЕБНАЯ'])
    const outdated = passportOverviewSource({
      ...data,
      stations: data.stations.map((s) => ({ ...s, validTo: '2026-12-31' })),
      org: {
        ...data.org,
        boundaries: data.org.boundaries.map((b) => ({ ...b, validFrom: '2028-01-01' })),
      },
    })
    expect(outdated.axes).toEqual([])
    expect(outdated.boundaries).toEqual([])
  })
  it('не угадывает неоднозначное направление', () => {
    const source = passportOverviewSource({
      ...data,
      lines: [...data.lines, { ...data.lines[0]!, id: 'other' }],
    })
    expect(source.axes).toEqual([])
    expect(source.boundaries).toEqual([])
    expect(source.warnings.join(' ')).toContain('неоднозначно')
  })
})
