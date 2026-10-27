import { createAnnualPlan } from './annual-plan'
import { samplePlanBasis } from './testing/sample-basis'
import {
  expectedIndicatorsOf,
  setExpectedIndicators,
  MAX_AREA_EXPECTED,
  type ExpectedIndicator,
} from './expected-indicators'
import { describePlanError } from './plan-error'
import type { Result } from '@eow/shared/kernel'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const area = { kind: 'pd', pd: 'ПД-1' } as const
const row: ExpectedIndicator = {
  id: 'e',
  group: ' Учебная протяжённость ',
  name: ' в т.ч. учебная ',
  unit: ' км ',
  value: 12.5,
}
describe('Ожидаемые показатели плана', () => {
  it('владеет строками, отличает пустое значение от нуля и не трогает другие области', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    const input: ExpectedIndicator[] = [
      { ...row, name: '', value: null },
      { ...row, id: 'f' },
      { ...row, id: 'g', value: -0 },
    ]
    let next = value(setExpectedIndicators(plan, area, input))
    input[1] = { ...row, id: 'f', value: 99 }
    const stored = expectedIndicatorsOf(next, area)
    expect(stored).toEqual([
      { id: 'e', group: 'Учебная протяжённость', name: '', unit: 'км', value: null },
      { id: 'f', group: 'Учебная протяжённость', name: 'в т.ч. учебная', unit: 'км', value: 12.5 },
      { id: 'g', group: 'Учебная протяжённость', name: 'в т.ч. учебная', unit: 'км', value: 0 },
    ])
    expect(Object.is(stored[2]?.value, 0)).toBe(true)
    expect(Object.isFrozen(stored)).toBe(true)
    expect(Object.isFrozen(stored[0])).toBe(true)
    next = value(setExpectedIndicators(next, { kind: 'district' }, [{ ...row, value: -3 }]))
    expect(expectedIndicatorsOf(next, area)).toHaveLength(3)
    expect(expectedIndicatorsOf(next, { kind: 'district' })[0]?.value).toBe(-3)
    expect(next.indicators.size).toBe(0)
    expect(plan.expectedIndicators.size).toBe(0)
  })
  it.each([
    { rows: [{ ...row, group: ' ' }] },
    { rows: [{ ...row, id: ' ' }] },
    { rows: [row, row] },
    { rows: [{ ...row, value: NaN }] },
    { rows: [{ ...row, value: -Infinity }] },
  ])('отклоняет весь неверный пакет %j без изменения плана', ({ rows }) => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    expect(setExpectedIndicators(plan, area, rows).ok).toBe(false)
    expect(plan.expectedIndicators.size).toBe(0)
  })
  it('ведётся только для дистанции и ПД, ограничивает число строк', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    const station = [...plan.basis.stations.keys()][0]!
    const onStation = setExpectedIndicators(plan, { kind: 'station', station }, [row])
    expect(onStation).toEqual({ ok: false, error: [{ kind: 'invalid-expected', reason: 'area' }] })
    expect(describePlanError({ kind: 'invalid-expected', reason: 'area' })).toBe(
      'Ожидаемые показатели ведутся только для дистанции и ПД',
    )
    expect(setExpectedIndicators(plan, { kind: 'pd', pd: 'нет' }, [row]).ok).toBe(false)
    expect(
      setExpectedIndicators(
        plan,
        area,
        Array.from({ length: MAX_AREA_EXPECTED + 1 }, (_, i) => ({ ...row, id: String(i) })),
      ).ok,
    ).toBe(false)
  })
  it('сохраняет ссылку при неизменённом пакете и удаляет пустую область', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    expect(value(setExpectedIndicators(plan, area, []))).toBe(plan)
    const next = value(setExpectedIndicators(plan, area, [row]))
    expect(value(setExpectedIndicators(next, area, [{ ...row }]))).toBe(next)
    const empty = value(setExpectedIndicators(next, area, []))
    expect(empty.expectedIndicators.size).toBe(0)
    expect(expectedIndicatorsOf(next, area)).toHaveLength(1)
  })
})
