import {
  addWork,
  createAnnualPlan,
  sampleStationLayout,
  samplePlanBasis,
  setManualValue,
  setPdHiddenTables,
  setPlanIndicators,
  workId,
} from '@eow/planning/domain'
import { parsePlaceSpec, type Result } from '@eow/shared/kernel'
import { planSheetData } from './sheet-data'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Ошибка учебного плана')
  return r.value
}

describe('Срез плана для листов', () => {
  it('рассчитывает только выбранный ПД, сохраняя соседние границы и прежнюю полную проекцию', () => {
    let plan = value(createAnnualPlan(2027, samplePlanBasis()))
    plan = value(
      addWork(plan, workId('s'), {
        kind: 'КСП',
        place: { kind: 'station', station: 'S1' },
        volume: 2,
        note: 'Учебная',
        callout: true,
      }),
    )
    const full = value(planSheetData(plan))
    const selected = value(planSheetData(plan, 'ПД-2'))
    expect(selected.pds[1]).toEqual(full.pds[1])
    expect(selected.pds[0]).toEqual({ ...full.pds[0], works: [], tables: [], stations: [] })
    expect(selected.lines).toEqual(full.lines)
    expect(planSheetData(plan, 'нет ПД')).toMatchObject({ ok: false })
    expect(value(planSheetData(plan))).toEqual(full)
  })
  it('передаёт доли по ПД, «входит в», ручной план и потребность без повторения расчётов в Документах', () => {
    const basis = samplePlanBasis()
    let plan = value(createAnnualPlan(2027, basis))
    const spec = value(parsePlaceSpec('17+0 – 21+0', 'L1', basis.lines.get('L1')!.kmLengths))
    plan = value(
      addWork(plan, workId('w'), {
        kind: 'ППРК',
        place: { kind: 'line', spec },
        volume: undefined,
        note: 'Учебная работа',
        callout: true,
      }),
    )
    plan = value(setManualValue(plan, { kind: 'pd', pd: 'ПД-1' }, 'overrides', 'ППР', 5))
    plan = value(setManualValue(plan, { kind: 'pd', pd: 'ПД-1' }, 'needs', 'ППР', 10))
    const source = value(planSheetData(plan))
    const a = source.pds.find((p) => p.id === 'ПД-1')!,
      b = source.pds.find((p) => p.id === 'ПД-2')!
    expect(a.works[0]?.volume).toBe(1)
    expect(b.works[0]?.volume).toBe(2.964)
    expect(a.tables[0]?.rows[0]).toEqual([
      'Планово-предупредительная выправка',
      'км',
      '1',
      '5 *',
      '10',
    ])
    expect(b.tables[0]?.rows[0]?.[3]).toBe('2,964')
    expect(source.lines[0]?.kmLengths).toEqual([[20, 964]])
    expect(source.edition).toEqual(basis.edition)
  })
  it('оставляет станционную работу в ведомости ПД станции', () => {
    let plan = value(createAnnualPlan(2027, samplePlanBasis()))
    plan = value(
      addWork(plan, workId('s'), {
        kind: 'КСП',
        place: { kind: 'station', station: 'S1', object: { kind: 'switch', number: '3' } },
        volume: 2,
        note: 'Учебная',
        callout: true,
      }),
    )
    const source = value(planSheetData(plan))
    expect(source.pds[0]?.works).toEqual([])
    expect(source.pds[1]?.works[0]).toMatchObject({
      lineId: null,
      items: [],
      volume: 2,
      place: 'Озёрная · стрелка № 3',
    })
    expect(source.pds[1]?.tables.find((t) => t.title === 'Ведомость работ ПД')?.rows[0]).toContain(
      '2 компл',
    )
    expect(source.pds[1]?.tables.find((t) => t.workIds)?.workIds).toEqual(['s'])
    expect(
      source.pds[1]?.tables
        .filter((t) => !t.workIds)
        .every((t) => t.title !== 'Ведомость работ ПД'),
    ).toBe(true)
  })
  it('собирает лист станции ПД: раскладку, работы с объектами и таблицы станции', () => {
    const basis = samplePlanBasis()
    let plan = value(createAnnualPlan(2027, basis))
    const spec = value(parsePlaceSpec('20+100', 'L1', basis.lines.get('L1')!.kmLengths))
    plan = value(
      addWork(plan, workId('a'), {
        kind: 'КСП',
        place: { kind: 'station', station: 'S1', object: { kind: 'switch', number: '3' } },
        volume: 2,
        note: 'Учебная',
        callout: true,
      }),
    )
    plan = value(
      addWork(plan, workId('b'), {
        kind: 'ППР',
        place: { kind: 'station', station: 'S1' },
        volume: 0.5,
        note: '',
        callout: false,
      }),
    )
    plan = value(
      addWork(plan, workId('c'), {
        kind: 'ППРК',
        place: { kind: 'line', spec, station: 'S1', object: { kind: 'track', number: '1' } },
        volume: 0.2,
        note: '',
        callout: true,
      }),
    )
    plan = value(
      setPlanIndicators(plan, { kind: 'station', station: 'S1' }, [
        { id: 'i', name: 'Учебный показатель', unit: 'шт', value: 1.5, note: '' },
      ]),
    )
    const source = value(planSheetData(plan, 'ПД-2'))
    const [station] = source.pds[1]!.stations
    expect(source.pds[0]?.stations).toEqual([])
    expect(station?.layout).toEqual(sampleStationLayout())
    expect(station?.works.map((w) => [w.id, w.object, w.volume, w.callout])).toEqual([
      ['a', { kind: 'switch', number: '3' }, 2, true],
      ['b', null, 0.5, false],
      ['c', { kind: 'track', number: '1' }, 0.2, true],
    ])
    expect(station?.tables.map((t) => t.title)).toEqual([
      'План текущего содержания',
      'Капитальные работы',
      'Ведомость работ станции',
      'Ручные показатели станции',
    ])
    const statement = station!.tables[2]!
    expect(statement.workIds).toEqual(['a', 'b', 'c'])
    expect(statement.rows.map((r) => r[2])).toEqual(['стрелка № 3', 'вся станция', 'путь № 1'])
    expect(statement.columns.reduce((n, c) => n + c.width, 0)).toBe(390)
    const hidden = value(setPdHiddenTables(plan, 'ПД-2', ['stations']))
    expect(value(planSheetData(hidden, 'ПД-2')).pds[1]?.stations).toEqual([])
  })
  it('не выводит лист станции без раскладки и работ', () => {
    const basis = samplePlanBasis()
    const { layout: _, ...bare } = basis.stations.get('S1')!
    const plan = value(createAnnualPlan(2027, { ...basis, stations: new Map([['S1', bare]]) }))
    expect(value(planSheetData(plan)).pds[1]?.stations).toEqual([])
  })
  it('отклоняет чрезмерный план до расчёта таблиц, сохраняя исходный снимок', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    const work = {
      kind: 'КСП',
      place: { kind: 'station' as const, station: 'S1' },
      volume: 1,
      note: 'Учебная',
      callout: false,
    }
    const many = {
      ...plan,
      works: Array.from({ length: 10001 }, (_, i) => ({ ...work, id: workId(`work-${i}`) })),
    }
    expect(planSheetData(many)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('слишком велик') },
    })
    expect(plan.works).toEqual([])
  })
})
