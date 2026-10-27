import {
  createAnnualPlan,
  datedIndicatorsOf,
  hiddenPdTablesOf,
  itemsOf,
  samplePlanBasis,
  setDatedIndicators,
} from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { decodePlan, encodePlan, readPlanFile } from './plan-file'
import { planFileV7Schema } from './plan-file-schema'
import { v1Fixture } from './testing/v1-fixture'
import { v2Fixture } from './testing/v2-fixture'
import { v3Fixture } from './testing/v3-fixture'
import { v4Fixture } from './testing/v4-fixture'
import { v5Fixture } from './testing/v5-fixture'
import { v6Fixture } from './testing/v6-fixture'
import { v7Fixture } from './testing/v7-fixture'
import { v8Fixture } from './testing/v8-fixture'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
describe('Таблица «Показатели» и формат v8', () => {
  it.each([v1Fixture, v2Fixture, v3Fixture, v4Fixture, v5Fixture, v6Fixture, v7Fixture])(
    'открывает прежний формат без таблицы «Показатели» и с прежними данными',
    (old) => {
      const original = JSON.stringify(old),
        file = value(readPlanFile(original))
      expect(file.format.version).toBe(8)
      expect(file.plan.datedIndicators).toEqual([])
      expect(file.edition).toEqual(old.edition)
      expect(file.plan.works).toEqual(old.plan.works)
      expect(file.plan.indicators).toEqual('indicators' in old.plan ? old.plan.indicators : [])
      expect(file.plan.itemTables).toEqual('itemTables' in old.plan ? old.plan.itemTables : [])
      expect(file.plan.pdHiddenTables).toEqual(
        'pdHiddenTables' in old.plan ? old.plan.pdHiddenTables : [],
      )
      const plan = value(decodePlan(original))
      expect(plan.datedIndicators.size).toBe(0)
      expect(value(decodePlan(value(encodePlan(plan, '0.5.0'))))).toEqual(plan)
      expect(JSON.stringify(old)).toBe(original)
    },
  )
  it('сохраняет закреплённый v8 со всеми прежними таблицами и архивом', () => {
    const plan = value(decodePlan(JSON.stringify(v8Fixture))),
      text = value(encodePlan(plan, '0.5.0')),
      file = value(readPlanFile(text))
    expect(datedIndicatorsOf(plan, { kind: 'pd', pd: 'D' })).toEqual(
      v8Fixture.plan.datedIndicators[0]!.rows,
    )
    expect(datedIndicatorsOf(plan, { kind: 'district' })[0]).toMatchObject({
      previous: -2,
      current: null,
    })
    expect(hiddenPdTablesOf(plan, 'D')).toEqual(['dated', 'works', 'expected', 'isso'])
    expect(itemsOf(plan, { kind: 'pd', pd: 'D' }, 'contract')).toHaveLength(2)
    expect(file.plan.prototype?.source).toBe(v2Fixture.plan.prototype.source)
    expect(file.plan.datedIndicators).toEqual(v8Fixture.plan.datedIndicators)
    expect(value(decodePlan(text))).toEqual(plan)
    expect(planFileV7Schema.safeParse(JSON.parse(text)).success).toBe(false)
  })
  it('сохраняет обе области, порядок строк, пустые значения, ноль и знак', () => {
    const row = { id: 'r', name: '<Учебный>', previous: null, current: -0 }
    let plan = value(createAnnualPlan(2027, samplePlanBasis()))
    for (const area of [{ kind: 'district' }, { kind: 'pd', pd: 'ПД-1' }] as const)
      plan = value(
        setDatedIndicators(plan, area, [row, { ...row, id: 's', previous: -1.25, current: 1e200 }]),
      )
    const reopened = value(decodePlan(value(encodePlan(plan, '0.5.0'))))
    expect(reopened).toEqual(plan)
    expect(datedIndicatorsOf(reopened, { kind: 'pd', pd: 'ПД-1' })[0]).toEqual({
      id: 'r',
      name: '<Учебный>',
      previous: null,
      current: 0,
    })
  })
  it.each([
    'unknown-pd',
    'station',
    'duplicate-area',
    'id',
    'name',
    'value',
    'hidden-key',
    'unknown',
  ] as const)('отклоняет повреждённую таблицу «Показатели» (%s)', (problem) => {
    const file = structuredClone(v8Fixture) as unknown as {
      plan: {
        datedIndicators: { area: unknown; rows: Record<string, unknown>[] }[]
        pdHiddenTables: { pd: string; hidden: string[] }[]
      }
    }
    const entry = file.plan.datedIndicators[0]!,
      row = entry.rows[0]!
    let text: string | undefined
    if (problem === 'unknown-pd') entry.area = { kind: 'pd', pd: 'нет' }
    else if (problem === 'station') entry.area = { kind: 'station', station: 'S' }
    else if (problem === 'duplicate-area') file.plan.datedIndicators.push(entry)
    else if (problem === 'id') entry.rows.push(row)
    else if (problem === 'name') row['name'] = ' '
    else if (problem === 'value')
      text = JSON.stringify(file).replace('"previous":10.5', '"previous":1e999')
    else if (problem === 'hidden-key') file.plan.pdHiddenTables[0]!.hidden.push('unknown')
    else text = JSON.stringify({ ...file, plan: { ...file.plan, unknown: 1 } })
    expect(decodePlan(text ?? JSON.stringify(file)).ok).toBe(false)
  })
})
