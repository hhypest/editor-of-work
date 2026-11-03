import { passportAdmDivisionSource } from './adm-division-source'
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
  it('находит ПЧУ участка ПД через оргструктуру и не зацикливается', () => {
    const pchu = {
      ...common,
      id: 'u',
      code: 'ПЧУ-1',
      type: 'ПЧУ',
      active: true,
      parentId: null,
      activity: null,
    }
    const withPchu: PassportOverviewData = {
      ...data,
      org: {
        ...data.org,
        subdivisions: [
          ...data.org.subdivisions.map((u) => (u.id === 'pd' ? { ...u, parentId: 'mid' } : u)),
          { ...pchu, id: 'mid', code: 'Участок', type: 'Участок', parentId: 'u' },
          pchu,
        ],
      },
    }
    expect(passportOverviewSource(withPchu).boundaries).toEqual([
      expect.objectContaining({ code: 'ПД-1', pchu: 'ПЧУ-1' }),
    ])
    const loop: PassportOverviewData = {
      ...data,
      org: {
        ...data.org,
        subdivisions: [
          ...data.org.subdivisions.map((u) => (u.id === 'pd' ? { ...u, parentId: 'a' } : u)),
          { ...pchu, id: 'a', code: 'А', type: 'Участок', parentId: 'b' },
          { ...pchu, id: 'b', code: 'Б', type: 'Участок', parentId: 'a' },
        ],
      },
    }
    expect(passportOverviewSource(loop).boundaries[0]?.pchu).toBeUndefined()
  })
  it('добавляет руководителей, название дистанции, пути и стрелки станций и станции без ПД', () => {
    const track = (
      id: string,
      purpose: string,
      fullLength: number | null,
      validTo = '9999-12-31',
    ) =>
      ({
        ...common,
        validTo,
        id,
        form: 'station-tracks',
        values: {
          station: 'УЧЕБНАЯ',
          purpose,
          park: null,
          number: id,
          from: null,
          via: [],
          to: null,
          fullLength,
          usefulLength: null,
          railType: null,
          ballastType: null,
          sleeperType: null,
          lastRepairYear: null,
          lastRepairKind: null,
          classCode: null,
        },
      }) as const
    const switchRow = (id: string) =>
      ({
        ...common,
        id,
        form: 'switches',
        values: {
          station: 'УЧЕБНАЯ',
          number: id,
          park: null,
          purpose: null,
          track: null,
          side: null,
          laidDate: null,
          control: null,
          railType: null,
          frogMark: null,
          frogKind: null,
          frogs: 1,
          sleeperType: null,
        },
      }) as const
    const period = { validFrom: null, validTo: null }
    const full: PassportOverviewData = {
      ...data,
      org: {
        ...data.org,
        stations: [{ ...common, id: 'b', station: 'УЧЕБНАЯ', subdivisionId: 'pd' }],
      },
      stations: [
        ...data.stations,
        {
          ...data.stations[0]!,
          id: 'free',
          values: { ...data.stations[0]!.values, station: 'ВНЕ ПД' },
        },
        track('1', 'Главный', 1200),
        track('3', 'Приёмо-отправочный', 850),
        track('5', 'Вытяжной', null),
        track('7', 'Погрузочно-выгрузочный', 300, '2026-12-31'),
        switchRow('1'),
        switchRow('2'),
      ],
      manual: {
        heads: [
          { ...period, id: 'd', subdivision: 'Дистанция', title: 'Учебная дистанция', head: null },
          { ...period, id: 'h', subdivision: 'ПД-1', title: null, head: 'Учебный И.И.' },
          { ...period, id: 'o', subdivision: 'ПД-старый', title: null, head: 'Прежний П.П.' },
        ],
      },
    }
    const source = passportOverviewSource(full)
    expect(source.district).toBe('Учебная дистанция')
    expect(source.heads).toEqual({ 'ПД-1': 'Учебный И.И.' })
    expect(source.stationStats).toEqual({ УЧЕБНАЯ: { tracks: 2, meters: 850, switches: 2 } })
    expect(source.unboundStations).toEqual(['ВНЕ ПД'])
    expect(passportOverviewSource(data).district).toBeUndefined()
  })
  it('срез для административного деления: действующие ПД и ПЧУ, привязки, пути и стрелки', () => {
    const pchu = {
      ...common,
      id: 'u',
      code: 'ПЧУ-1',
      type: 'ПЧУ',
      active: true,
      parentId: null,
      activity: null,
    }
    const division = passportAdmDivisionSource({
      ...data,
      lines: [{ id: 'l', name: 'УЧЕБНОЕ', extents: [], kmLengths: [[10, 1050]] }],
      org: {
        ...data.org,
        subdivisions: [
          ...data.org.subdivisions.map((u) => (u.id === 'pd' ? { ...u, parentId: 'u' } : u)),
          pchu,
        ],
        stations: [
          { ...common, id: 'b', station: ' УЧЕБНАЯ ', subdivisionId: 'pd' },
          { ...common, id: 'o', station: 'СТАРАЯ', subdivisionId: 'old' },
        ],
      },
      manual: {
        heads: [
          {
            id: 'h',
            validFrom: null,
            validTo: null,
            subdivision: 'ПЧУ-1',
            title: null,
            head: 'Учебный И.И.',
          },
          {
            id: 'd',
            validFrom: null,
            validTo: null,
            subdivision: 'Дистанция',
            title: 'Учебная дистанция',
            head: null,
          },
        ],
      },
    })
    expect(division.district).toBe('Учебная дистанция')
    expect(division.units).toEqual([
      { code: 'ПД-1', kind: 'ПД', head: undefined, pchu: 'ПЧУ-1' },
      { code: 'ПЧУ-1', kind: 'ПЧУ', head: 'Учебный И.И.' },
    ])
    expect(division.boundaries).toEqual([
      {
        pd: 'ПД-1',
        line: 'УЧЕБНОЕ',
        from: { km: 10, m: 0 },
        to: { km: 11, m: 0 },
        statedLength: null,
      },
    ])
    expect(division.bindings).toEqual([{ station: 'УЧЕБНАЯ', pd: 'ПД-1' }])
    expect(division.axes).toEqual([{ station: 'УЧЕБНАЯ', line: 'УЧЕБНОЕ', at: { km: 10, m: 500 } }])
    expect(division.lines).toEqual([{ name: 'УЧЕБНОЕ', kmLengths: [[10, 1050]] }])
  })
})
