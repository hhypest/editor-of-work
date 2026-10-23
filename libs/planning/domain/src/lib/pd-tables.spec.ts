import { createAnnualPlan } from './annual-plan'
import { samplePlanBasis } from './testing/sample-basis'
import { hiddenPdTablesOf, PD_TABLE_KINDS, setPdHiddenTables } from './pd-tables'
import type { Result } from '@eow/shared/kernel'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const fresh = () => value(createAnnualPlan(2027, samplePlanBasis()))
describe('Состав таблиц ПД', () => {
  it('владеет массивом, нормализует порядок, изолирует ПД и сохраняет данные', () => {
    const original = fresh(),
      input = ['works', 'current']
    const first = value(setPdHiddenTables(original, 'ПД-1', input))
    input.push('summary')
    expect(hiddenPdTablesOf(original, 'ПД-1')).toEqual([])
    expect(hiddenPdTablesOf(first, 'ПД-1')).toEqual(['current', 'works'])
    expect(Object.isFrozen(hiddenPdTablesOf(first, 'ПД-1'))).toBe(true)
    expect(value(setPdHiddenTables(first, 'ПД-1', ['works', 'current']))).toBe(first)
    const second = value(setPdHiddenTables(first, 'ПД-2', PD_TABLE_KINDS))
    expect(hiddenPdTablesOf(second, 'ПД-1')).toEqual(['current', 'works'])
    expect(hiddenPdTablesOf(first, 'ПД-2')).toEqual([])
    expect(hiddenPdTablesOf(second, 'ПД-2')).toEqual(PD_TABLE_KINDS)
    expect(second.works).toBe(original.works)
    expect(second.manual).toBe(original.manual)
    expect(second.indicators).toBe(original.indicators)
    expect(second.pdScales).toBe(original.pdScales)
    expect(value(setPdHiddenTables(second, 'ПД-1', [])).pdHiddenTables.has('ПД-1')).toBe(false)
    expect(value(setPdHiddenTables(original, 'ПД-1', []))).toBe(original)
  })
  it.each([
    { hidden: ['unknown'], reason: 'key' },
    { hidden: ['works', 'works'], reason: 'duplicate' },
  ])('отклоняет повреждённый пакет $reason целиком', ({ hidden, reason }) => {
    const plan = fresh()
    expect(setPdHiddenTables(plan, 'ПД-1', hidden)).toEqual({
      ok: false,
      error: [{ kind: 'invalid-pd-tables', reason }],
    })
    expect(plan.pdHiddenTables.size).toBe(0)
  })
  it('отклоняет чужой ПД', () => {
    expect(setPdHiddenTables(fresh(), 'нет', ['works'])).toMatchObject({
      ok: false,
      error: [{ kind: 'unknown-area' }],
    })
  })
})
