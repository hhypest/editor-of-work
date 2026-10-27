import {
  createAnnualPlan,
  expectedIndicatorsOf,
  hiddenPdTablesOf,
  itemsOf,
  samplePlanBasis,
  setPlanItems,
} from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { decodePlan, encodePlan, readPlanFile } from './plan-file'
import { planFileV6Schema } from './plan-file-schema'
import { v1Fixture } from './testing/v1-fixture'
import { v2Fixture } from './testing/v2-fixture'
import { v3Fixture } from './testing/v3-fixture'
import { v4Fixture } from './testing/v4-fixture'
import { v5Fixture } from './testing/v5-fixture'
import { v6Fixture } from './testing/v6-fixture'
import { v7Fixture } from './testing/v7-fixture'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
describe('Перечни работ и формат v7', () => {
  it.each([v1Fixture, v2Fixture, v3Fixture, v4Fixture, v5Fixture, v6Fixture])(
    'открывает прежний формат без перечней и с прежними данными',
    (old) => {
      const original = JSON.stringify(old),
        file = value(readPlanFile(original))
      expect(file.format.version).toBe(8)
      expect(file.plan.itemTables).toEqual([])
      expect(file.edition).toEqual(old.edition)
      expect(file.plan.works).toEqual(old.plan.works)
      expect(file.plan.expectedIndicators).toEqual(
        'expectedIndicators' in old.plan ? old.plan.expectedIndicators : [],
      )
      expect(file.plan.pdHiddenTables).toEqual(
        'pdHiddenTables' in old.plan ? old.plan.pdHiddenTables : [],
      )
      const plan = value(decodePlan(original))
      expect(plan.itemTables.size).toBe(0)
      expect(value(decodePlan(value(encodePlan(plan, '0.5.0'))))).toEqual(plan)
      expect(JSON.stringify(old)).toBe(original)
    },
  )
  it('сохраняет закреплённый v7 со всеми прежними таблицами и архивом', () => {
    const plan = value(decodePlan(JSON.stringify(v7Fixture))),
      text = value(encodePlan(plan, '0.5.0')),
      file = value(readPlanFile(text))
    expect(itemsOf(plan, { kind: 'pd', pd: 'D' }, 'contract')).toEqual(
      v7Fixture.plan.itemTables[0]!.rows,
    )
    expect(itemsOf(plan, { kind: 'district' }, 'zp')).toHaveLength(1)
    expect(itemsOf(plan, { kind: 'pd', pd: 'D' }, 'isso')).toEqual([])
    expect(hiddenPdTablesOf(plan, 'D')).toEqual(['works', 'expected', 'isso'])
    expect(expectedIndicatorsOf(plan, { kind: 'pd', pd: 'D' })).toHaveLength(2)
    expect(file.plan.prototype?.source).toBe(v2Fixture.plan.prototype.source)
    expect(file.plan.itemTables).toEqual(v7Fixture.plan.itemTables)
    expect(value(decodePlan(text))).toEqual(plan)
    expect(planFileV6Schema.safeParse(JSON.parse(text)).success).toBe(false)
  })
  it('сохраняет все три перечня обеих областей с порядком и большими числами', () => {
    const row = { id: 'r', name: '<Учебная>', unit: 'шт', quantity: 0, cost: 1e200 }
    let plan = value(createAnnualPlan(2027, samplePlanBasis()))
    for (const area of [{ kind: 'district' }, { kind: 'pd', pd: 'ПД-1' }] as const)
      for (const kind of ['contract', 'isso', 'zp'] as const)
        plan = value(setPlanItems(plan, area, kind, [row, { ...row, id: 's', quantity: 2.5 }]))
    expect(value(decodePlan(value(encodePlan(plan, '0.5.0'))))).toEqual(plan)
  })
  it.each([
    'unknown-pd',
    'station',
    'kind',
    'duplicate',
    'id',
    'name',
    'negative',
    'hidden-key',
    'unknown',
  ] as const)('отклоняет повреждённые перечни (%s)', (problem) => {
    const file = structuredClone(v7Fixture) as unknown as {
      plan: {
        itemTables: { area: unknown; kind: string; rows: Record<string, unknown>[] }[]
        pdHiddenTables: { pd: string; hidden: string[] }[]
      }
    }
    const entry = file.plan.itemTables[0]!,
      row = entry.rows[0]!
    let text: string | undefined
    if (problem === 'unknown-pd') entry.area = { kind: 'pd', pd: 'нет' }
    else if (problem === 'station') entry.area = { kind: 'station', station: 'S' }
    else if (problem === 'kind') entry.kind = 'чужой'
    else if (problem === 'duplicate') file.plan.itemTables.push(entry)
    else if (problem === 'id') entry.rows.push(row)
    else if (problem === 'name') row['name'] = ' '
    else if (problem === 'negative') row['cost'] = -1
    else if (problem === 'hidden-key') file.plan.pdHiddenTables[0]!.hidden.push('unknown')
    else text = JSON.stringify({ ...file, plan: { ...file.plan, unknown: 1 } })
    expect(decodePlan(text ?? JSON.stringify(file)).ok).toBe(false)
  })
})
