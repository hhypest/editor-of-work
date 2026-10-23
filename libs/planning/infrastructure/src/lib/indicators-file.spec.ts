import {
  createAnnualPlan,
  samplePlanBasis,
  setPlanIndicators,
  indicatorsOf,
} from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { decodePlan, encodePlan, readPlanFile } from './plan-file'
import { planFileV2Schema } from './plan-file-schema'
import { v1Fixture } from './testing/v1-fixture'
import { v2Fixture } from './testing/v2-fixture'
import { v3Fixture } from './testing/v3-fixture'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
describe('Формат v3 и ручные показатели', () => {
  it.each([v1Fixture, v2Fixture])(
    'переносит прежний формат без изменения среза, работ и архива',
    (old) => {
      const before = JSON.stringify(old)
      const file = value(readPlanFile(before))
      expect(file.format.version).toBe(3)
      expect(file.plan.indicators).toEqual([])
      expect(file.edition).toEqual(old.edition)
      expect(file.plan.works).toEqual(old.plan.works)
      const plan = value(decodePlan(before))
      expect(plan.indicators.size).toBe(0)
      const reopened = value(decodePlan(value(encodePlan(plan, '0.3.0'))))
      expect(reopened).toEqual(plan)
      expect(JSON.stringify(old)).toBe(before)
    },
  )
  it('открывает закреплённый v3 и сохраняет старую строку архива побайтно', () => {
    const plan = value(decodePlan(JSON.stringify(v3Fixture)))
    expect(indicatorsOf(plan, { kind: 'pd', pd: 'D' })).toEqual(v3Fixture.plan.indicators[0]!.rows)
    const text = value(encodePlan(plan, '0.3.0'))
    expect(value(readPlanFile(text)).plan.prototype?.source).toBe(v2Fixture.plan.prototype.source)
    expect(value(decodePlan(text))).toEqual(plan)
    expect(planFileV2Schema.safeParse(JSON.parse(text)).success).toBe(false)
  })
  it('сохраняет независимые области, порядок и конечные числовые значения', () => {
    const row = { id: 'i', name: 'Учебный', unit: 'м', value: 0, note: '<Учебное>' }
    let plan = value(createAnnualPlan(2027, samplePlanBasis()))
    for (const area of [
      { kind: 'district' },
      { kind: 'pd', pd: 'ПД-1' },
      { kind: 'station', station: 'S1' },
    ] as const)
      plan = value(setPlanIndicators(plan, area, [row, { ...row, id: 'j', value: 1e200 }]))
    expect(value(decodePlan(value(encodePlan(plan, '0.3.0'))))).toEqual(plan)
  })
  it.each(['area', 'duplicate-area', 'id', 'name', 'value', 'unknown'] as const)(
    'отклоняет повреждённые показатели (%s)',
    (problem) => {
      const file = value(readPlanFile(JSON.stringify(v3Fixture)))
      const entry = file.plan.indicators[0]!,
        row = entry.rows[0]!
      let text: string | undefined
      if (problem === 'area') entry.area = { kind: 'pd', pd: 'нет' }
      else if (problem === 'duplicate-area') file.plan.indicators.push(entry)
      else if (problem === 'id') entry.rows.push(row)
      else if (problem === 'name') row.name = ' '
      else if (problem === 'value') {
        text = JSON.stringify(file).replace('"value":-1.25', '"value":1e999')
      } else {
        text = JSON.stringify({ ...file, plan: { ...file.plan, unknown: 1 } })
      }
      expect(decodePlan(text ?? JSON.stringify(file)).ok).toBe(false)
    },
  )
})
