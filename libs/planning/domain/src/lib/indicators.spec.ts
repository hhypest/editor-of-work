import { createAnnualPlan } from './annual-plan'
import { samplePlanBasis } from './testing/sample-basis'
import { indicatorsOf, setPlanIndicators, MAX_AREA_INDICATORS } from './indicators'
import type { Result } from '@eow/shared/kernel'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const area = { kind: 'pd', pd: 'ПД-1' } as const
const row = {
  id: 'i',
  name: ' Учебный показатель ',
  unit: ' шт ',
  value: 0,
  note: 'Учебное примечание',
}
describe('Ручные показатели плана', () => {
  it('владеет строками, сохраняет ноль и знак, не изменяет чужие области и исходный план', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    const input = [{ ...row }, { ...row, id: 'j', value: -1.25, unit: '' }]
    let next = value(setPlanIndicators(plan, area, input))
    input[0]!.value = 99
    expect(indicatorsOf(next, area)).toEqual([
      { ...row, name: row.name.trim(), unit: 'шт' },
      { ...row, id: 'j', name: row.name.trim(), value: -1.25, unit: '' },
    ])
    expect(Object.isFrozen(indicatorsOf(next, area))).toBe(true)
    expect(Object.isFrozen(indicatorsOf(next, area)[0])).toBe(true)
    next = value(setPlanIndicators(next, { kind: 'district' }, [{ ...row, value: 8 }]))
    expect(indicatorsOf(next, area)[0]?.value).toBe(0)
    expect(indicatorsOf(next, { kind: 'district' })[0]?.value).toBe(8)
    expect(plan.indicators.size).toBe(0)
  })
  it.each([
    { rows: [{ ...row, name: ' ' }] },
    { rows: [{ ...row, id: '' }] },
    { rows: [row, row] },
    { rows: [{ ...row, value: NaN }] },
    { rows: [{ ...row, value: Infinity }] },
  ])('отклоняет весь неверный пакет %j без изменения плана', ({ rows }) => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    expect(setPlanIndicators(plan, area, rows).ok).toBe(false)
    expect(plan.indicators.size).toBe(0)
  })
  it('отклоняет неизвестную область и ограничивает число строк', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    expect(setPlanIndicators(plan, { kind: 'station', station: 'нет' }, [row]).ok).toBe(false)
    expect(
      setPlanIndicators(
        plan,
        area,
        Array.from({ length: MAX_AREA_INDICATORS + 1 }, (_, i) => ({ ...row, id: String(i) })),
      ).ok,
    ).toBe(false)
  })
  it('сохраняет ссылку при неизменённом пакете и удаляет пустую область', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    expect(value(setPlanIndicators(plan, area, []))).toBe(plan)
    const next = value(setPlanIndicators(plan, area, [row]))
    expect(value(setPlanIndicators(next, area, [row]))).toBe(next)
    const empty = value(setPlanIndicators(next, area, []))
    expect(empty.indicators.size).toBe(0)
    expect(indicatorsOf(next, area)).toHaveLength(1)
  })
})
