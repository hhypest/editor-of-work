import { pdScaleOf } from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { decodePlan, encodePlan, readPlanFile } from './plan-file'
import { planFileV3Schema } from './plan-file-schema'
import { v1Fixture } from './testing/v1-fixture'
import { v2Fixture } from './testing/v2-fixture'
import { v3Fixture } from './testing/v3-fixture'
import { v4Fixture } from './testing/v4-fixture'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
describe('Масштабы и формат v4', () => {
  it.each([v1Fixture, v2Fixture, v3Fixture])(
    'открывает прежний формат без изменения данных',
    (old) => {
      const original = JSON.stringify(old)
      const file = value(readPlanFile(original))
      expect(file.format.version).toBe(6)
      expect(file.plan.pdScales).toEqual([])
      expect(file.edition).toEqual(old.edition)
      expect(file.plan.works).toEqual(old.plan.works)
      expect(file.plan.manual).toEqual(old.plan.manual)
      const plan = value(decodePlan(original))
      expect(pdScaleOf(plan, 'D')).toBe(50000)
      const roundtrip = value(encodePlan(plan, '0.4.0'))
      expect(value(decodePlan(roundtrip))).toEqual(plan)
      expect(JSON.stringify(old)).toBe(original)
    },
  )
  it('открывает закреплённый v4 и сохраняет архив и показатели v3', () => {
    const plan = value(decodePlan(JSON.stringify(v4Fixture)))
    expect(pdScaleOf(plan, 'D')).toBe(25000)
    const text = value(encodePlan(plan, '0.4.0'))
    const file = value(readPlanFile(text))
    expect(file.plan.indicators).toEqual(v3Fixture.plan.indicators)
    expect(file.plan.prototype).toEqual(v3Fixture.plan.prototype)
    expect(value(decodePlan(text))).toEqual(plan)
    expect(planFileV3Schema.safeParse(JSON.parse(text)).success).toBe(false)
  })
  it.each(['unknown', 'duplicate', 'scale', 'field'] as const)(
    'отклоняет повреждённые настройки (%s)',
    (problem) => {
      const file = structuredClone(v4Fixture)
      if (problem === 'unknown') file.plan.pdScales[0]!.pd = 'нет'
      if (problem === 'duplicate') file.plan.pdScales.push(file.plan.pdScales[0]!)
      if (problem === 'scale') file.plan.pdScales[0]!.scale = 75000
      const text =
        problem === 'field'
          ? JSON.stringify({ ...file, plan: { ...file.plan, extra: 1 } })
          : JSON.stringify(file)
      expect(decodePlan(text).ok).toBe(false)
    },
  )
})
