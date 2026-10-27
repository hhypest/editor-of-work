import {
  createAnnualPlan,
  expectedIndicatorsOf,
  hiddenPdTablesOf,
  indicatorsOf,
  pdScaleOf,
  samplePlanBasis,
  setExpectedIndicators,
} from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { decodePlan, encodePlan, readPlanFile } from './plan-file'
import { planFileV5Schema } from './plan-file-schema'
import { v1Fixture } from './testing/v1-fixture'
import { v2Fixture } from './testing/v2-fixture'
import { v3Fixture } from './testing/v3-fixture'
import { v4Fixture } from './testing/v4-fixture'
import { v5Fixture } from './testing/v5-fixture'
import { v6Fixture } from './testing/v6-fixture'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
describe('Ожидаемые показатели и формат v6', () => {
  it.each([v1Fixture, v2Fixture, v3Fixture, v4Fixture, v5Fixture])(
    'открывает прежний формат без ожидаемых показателей и с прежними данными',
    (old) => {
      const original = JSON.stringify(old),
        file = value(readPlanFile(original))
      expect(file.format.version).toBe(8)
      expect(file.plan.expectedIndicators).toEqual([])
      expect(file.edition).toEqual(old.edition)
      expect(file.plan.works).toEqual(old.plan.works)
      expect(file.plan.manual).toEqual(old.plan.manual)
      expect(file.plan.indicators).toEqual('indicators' in old.plan ? old.plan.indicators : [])
      expect(file.plan.pdScales).toEqual('pdScales' in old.plan ? old.plan.pdScales : [])
      expect(file.plan.pdHiddenTables).toEqual(
        'pdHiddenTables' in old.plan ? old.plan.pdHiddenTables : [],
      )
      const plan = value(decodePlan(original))
      expect(plan.expectedIndicators.size).toBe(0)
      expect(value(decodePlan(value(encodePlan(plan, '0.5.0'))))).toEqual(plan)
      expect(JSON.stringify(old)).toBe(original)
    },
  )
  it('сохраняет закреплённый v6 со всеми прежними настройками и архивом', () => {
    const plan = value(decodePlan(JSON.stringify(v6Fixture))),
      text = value(encodePlan(plan, '0.5.0')),
      file = value(readPlanFile(text))
    expect(expectedIndicatorsOf(plan, { kind: 'pd', pd: 'D' })).toEqual(
      v6Fixture.plan.expectedIndicators[0]!.rows,
    )
    expect(expectedIndicatorsOf(plan, { kind: 'district' })[0]?.value).toBe(0)
    expect(hiddenPdTablesOf(plan, 'D')).toEqual(['works', 'expected'])
    expect(pdScaleOf(plan, 'D')).toBe(25000)
    expect(indicatorsOf(plan, { kind: 'pd', pd: 'D' })).toEqual(v3Fixture.plan.indicators[0]!.rows)
    expect(file.plan.prototype?.source).toBe(v2Fixture.plan.prototype.source)
    expect(file.plan.expectedIndicators).toEqual(v6Fixture.plan.expectedIndicators)
    expect(value(decodePlan(text))).toEqual(plan)
    expect(planFileV5Schema.safeParse(JSON.parse(text)).success).toBe(false)
  })
  it('сохраняет обе области, порядок строк, пустое значение и ноль', () => {
    const row = { id: 'e', group: '<Учебный>', name: '', unit: 'км', value: null }
    let plan = value(createAnnualPlan(2027, samplePlanBasis()))
    for (const area of [{ kind: 'district' }, { kind: 'pd', pd: 'ПД-1' }] as const)
      plan = value(
        setExpectedIndicators(plan, area, [
          row,
          { ...row, id: 'f', name: 'учебная часть', value: 0 },
          { ...row, id: 'g', value: 1e200 },
        ]),
      )
    const reopened = value(decodePlan(value(encodePlan(plan, '0.5.0'))))
    expect(reopened).toEqual(plan)
    expect(expectedIndicatorsOf(reopened, { kind: 'pd', pd: 'ПД-1' })[0]?.value).toBeNull()
  })
  it.each([
    'unknown-pd',
    'station',
    'duplicate-area',
    'id',
    'group',
    'value',
    'hidden-key',
    'unknown',
  ] as const)('отклоняет повреждённые ожидаемые показатели (%s)', (problem) => {
    const file = structuredClone(v6Fixture) as unknown as {
      plan: {
        expectedIndicators: { area: unknown; rows: Record<string, unknown>[] }[]
        pdHiddenTables: { pd: string; hidden: string[] }[]
      }
    }
    const entry = file.plan.expectedIndicators[0]!,
      row = entry.rows[1]!
    let text: string | undefined
    if (problem === 'unknown-pd') entry.area = { kind: 'pd', pd: 'нет' }
    else if (problem === 'station') entry.area = { kind: 'station', station: 'S' }
    else if (problem === 'duplicate-area') file.plan.expectedIndicators.push(entry)
    else if (problem === 'id') entry.rows.push(row)
    else if (problem === 'group') row['group'] = ' '
    else if (problem === 'value')
      text = JSON.stringify(file).replace('"value":2.5', '"value":1e999')
    else if (problem === 'hidden-key') file.plan.pdHiddenTables[0]!.hidden.push('unknown')
    else text = JSON.stringify({ ...file, plan: { ...file.plan, unknown: 1 } })
    expect(decodePlan(text ?? JSON.stringify(file)).ok).toBe(false)
  })
})
