import { hiddenPdTablesOf, pdScaleOf } from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { decodePlan, encodePlan, readPlanFile } from './plan-file'
import { planFileV4Schema } from './plan-file-schema'
import { v1Fixture } from './testing/v1-fixture'
import { v2Fixture } from './testing/v2-fixture'
import { v3Fixture } from './testing/v3-fixture'
import { v4Fixture } from './testing/v4-fixture'
import { v5Fixture } from './testing/v5-fixture'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
describe('Состав таблиц и формат v5', () => {
  it.each([v1Fixture, v2Fixture, v3Fixture, v4Fixture])(
    'открывает прежний формат с прежним набором таблиц и данными',
    (old) => {
      const original = JSON.stringify(old),
        file = value(readPlanFile(original))
      expect(file.format.version).toBe(7)
      expect(file.plan.pdHiddenTables).toEqual([])
      expect(file.edition).toEqual(old.edition)
      expect(file.plan.works).toEqual(old.plan.works)
      expect(file.plan.manual).toEqual(old.plan.manual)
      const scales = 'pdScales' in old.plan ? old.plan.pdScales : []
      expect(file.plan.pdScales).toEqual(scales)
      const plan = value(decodePlan(original))
      expect(hiddenPdTablesOf(plan, 'D')).toEqual([])
      expect(value(decodePlan(value(encodePlan(plan, '0.5.0'))))).toEqual(plan)
      expect(JSON.stringify(old)).toBe(original)
    },
  )
  it('сохраняет закреплённый v5, архив, показатели и масштаб прежних версий', () => {
    const plan = value(decodePlan(JSON.stringify(v5Fixture))),
      text = value(encodePlan(plan, '0.5.0')),
      file = value(readPlanFile(text))
    expect(hiddenPdTablesOf(plan, 'D')).toEqual(['works'])
    expect(pdScaleOf(plan, 'D')).toBe(25000)
    expect(file.plan.prototype).toEqual(v4Fixture.plan.prototype)
    expect(file.plan.indicators).toEqual(v4Fixture.plan.indicators)
    expect(value(decodePlan(text))).toEqual(plan)
    expect(planFileV4Schema.safeParse(JSON.parse(text)).success).toBe(false)
  })
  it.each(['pd', 'duplicate-pd', 'key', 'duplicate-key', 'extra'] as const)(
    'отклоняет повреждённые настройки (%s)',
    (problem) => {
      const file = structuredClone(v5Fixture)
      if (problem === 'pd') file.plan.pdHiddenTables[0]!.pd = 'нет'
      if (problem === 'duplicate-pd') file.plan.pdHiddenTables.push(file.plan.pdHiddenTables[0]!)
      if (problem === 'key') file.plan.pdHiddenTables[0]!.hidden.push('unknown')
      if (problem === 'duplicate-key') file.plan.pdHiddenTables[0]!.hidden.push('works')
      const text =
        problem === 'extra'
          ? JSON.stringify({ ...file, plan: { ...file.plan, extra: 1 } })
          : JSON.stringify(file)
      expect(decodePlan(text).ok).toBe(false)
    },
  )
})
