import type { Result } from '@eow/shared/kernel'
import { createAnnualPlan } from './annual-plan'
import { samplePlanBasis } from './testing/sample-basis'
import {
  datedChange,
  datedIndicatorsOf,
  setDatedIndicators,
  MAX_AREA_DATED,
  type DatedIndicator,
} from './dated-indicators'
import { describePlanError } from './plan-error'

const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const area = { kind: 'pd', pd: 'ПД-1' } as const
const row: DatedIndicator = {
  id: 'd',
  name: ' Учебная протяжённость, км ',
  previous: 10,
  current: 12,
}

describe('Таблица «Показатели» на 01.01', () => {
  it('владеет строками, отличает пустое значение от нуля и не трогает другие области', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    const input: DatedIndicator[] = [
      row,
      { ...row, id: 'e', previous: null, current: -0 },
      { ...row, id: 'f', previous: -1.5, current: null },
    ]
    let next = value(setDatedIndicators(plan, area, input))
    input[0] = { ...row, current: 99 }
    const stored = datedIndicatorsOf(next, area)
    expect(stored).toEqual([
      { id: 'd', name: 'Учебная протяжённость, км', previous: 10, current: 12 },
      { id: 'e', name: 'Учебная протяжённость, км', previous: null, current: 0 },
      { id: 'f', name: 'Учебная протяжённость, км', previous: -1.5, current: null },
    ])
    expect(Object.is(stored[1]?.current, 0)).toBe(true)
    expect(Object.isFrozen(stored)).toBe(true)
    expect(Object.isFrozen(stored[0])).toBe(true)
    next = value(setDatedIndicators(next, { kind: 'district' }, [{ ...row, id: 'x' }]))
    expect(datedIndicatorsOf(next, area)).toHaveLength(3)
    expect(datedIndicatorsOf(next, { kind: 'district' })).toHaveLength(1)
    expect(next.indicators.size).toBe(0)
    expect(next.expectedIndicators.size).toBe(0)
    expect(plan.datedIndicators.size).toBe(0)
  })
  it.each([
    { rows: [{ ...row, name: ' ' }] },
    { rows: [{ ...row, id: ' ' }] },
    { rows: [row, row] },
    { rows: [{ ...row, previous: NaN }] },
    { rows: [{ ...row, current: Infinity }] },
  ])('отклоняет весь неверный пакет %j без изменения плана', ({ rows }) => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    expect(setDatedIndicators(plan, area, rows).ok).toBe(false)
    expect(plan.datedIndicators.size).toBe(0)
  })
  it('ведётся только для дистанции и ПД, ограничивает число строк', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    const station = [...plan.basis.stations.keys()][0]!
    expect(setDatedIndicators(plan, { kind: 'station', station }, [row])).toEqual({
      ok: false,
      error: [{ kind: 'invalid-dated', reason: 'area' }],
    })
    expect(describePlanError({ kind: 'invalid-dated', reason: 'area' })).toBe(
      'Таблица «Показатели» ведётся только для дистанции и ПД',
    )
    expect(setDatedIndicators(plan, { kind: 'pd', pd: 'нет' }, [row]).ok).toBe(false)
    expect(
      setDatedIndicators(
        plan,
        area,
        Array.from({ length: MAX_AREA_DATED + 1 }, (_, i) => ({ ...row, id: String(i) })),
      ).ok,
    ).toBe(false)
  })
  it('сохраняет ссылку при неизменённом пакете и удаляет пустую область', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    expect(value(setDatedIndicators(plan, area, []))).toBe(plan)
    const next = value(setDatedIndicators(plan, area, [row]))
    expect(value(setDatedIndicators(next, area, [{ ...row }]))).toBe(next)
    expect(value(setDatedIndicators(next, area, [])).datedIndicators.size).toBe(0)
  })
  it('считает изменение и процент только при обоих значениях и ненулевой базе', () => {
    expect(datedChange(row)).toEqual({ delta: 2, percent: 20 })
    expect(datedChange({ ...row, previous: 8, current: 6 })).toEqual({ delta: -2, percent: -25 })
    expect(datedChange({ ...row, previous: 0, current: 5 })).toEqual({ delta: 5, percent: null })
    expect(datedChange({ ...row, current: null })).toEqual({ delta: null, percent: null })
    expect(datedChange({ ...row, previous: null })).toEqual({ delta: null, percent: null })
    expect(datedChange({ ...row, previous: -1e308, current: 1e308 })).toEqual({
      delta: null,
      percent: null,
    })
  })
})
