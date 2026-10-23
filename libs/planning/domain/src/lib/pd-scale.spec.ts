import { createAnnualPlan } from './annual-plan'
import { samplePlanBasis } from './testing/sample-basis'
import { pdScaleOf, setPdScale } from './pd-scale'
import type { Result } from '@eow/shared/kernel'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const fresh = () => value(createAnnualPlan(2027, samplePlanBasis()))
describe('Масштаб ПД в плане', () => {
  it('по умолчанию использует 50 000, изолирует ПД и удаляет переопределение при возврате', () => {
    const original = fresh()
    expect(pdScaleOf(original, 'ПД-1')).toBe(50000)
    expect(value(setPdScale(original, 'ПД-1', 50000))).toBe(original)
    const first = value(setPdScale(original, 'ПД-1', 25000))
    const second = value(setPdScale(first, 'ПД-2', 100000))
    expect([...second.pdScales]).toEqual([
      ['ПД-1', 25000],
      ['ПД-2', 100000],
    ])
    expect(original.pdScales.size).toBe(0)
    expect(first.pdScales.has('ПД-2')).toBe(false)
    expect(value(setPdScale(second, 'ПД-2', 100000))).toBe(second)
    const reset = value(setPdScale(second, 'ПД-1', 50000))
    expect([...reset.pdScales]).toEqual([['ПД-2', 100000]])
    expect(pdScaleOf(reset, 'ПД-1')).toBe(50000)
    expect(reset.works).toBe(original.works)
    expect(reset.basis).toBe(original.basis)
  })
  it.each([0, -25000, 25000.1, 75000, NaN, Infinity])(
    'отклоняет недопустимый масштаб %s',
    (scale) => {
      const plan = fresh()
      expect(setPdScale(plan, 'ПД-1', scale)).toEqual({
        ok: false,
        error: [{ kind: 'invalid-pd-scale' }],
      })
      expect(plan.pdScales.size).toBe(0)
    },
  )
  it('отклоняет чужой ПД', () => {
    expect(setPdScale(fresh(), 'нет', 25000)).toMatchObject({
      ok: false,
      error: [{ kind: 'unknown-area' }],
    })
  })
})
