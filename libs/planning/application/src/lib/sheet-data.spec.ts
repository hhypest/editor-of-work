import {
  addWork,
  createAnnualPlan,
  samplePlanBasis,
  setManualValue,
  workId,
} from '@eow/planning/domain'
import { parsePlaceSpec, type Result } from '@eow/shared/kernel'
import { planSheetData } from './sheet-data'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Ошибка учебного плана')
  return r.value
}

describe('Срез плана для листов', () => {
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
