import { buildPdSheets } from '@eow/documents/application'
import { tableMeasurer } from '@eow/documents/application/testing'
import { planSheetData } from '@eow/planning/application'
import { encodePlan } from '@eow/planning/infrastructure'
import { fictionalPlan, PLAN_PROFILES, type PlanProfile } from './fictional-plans'

function profile(id: PlanProfile['id']): PlanProfile {
  const found = PLAN_PROFILES.find((p) => p.id === id)
  if (!found) throw new Error(`Нет профиля ${id}`)
  return found
}

function pages(id: PlanProfile['id']): number {
  const plan = fictionalPlan(profile(id))
  let total = 0
  for (const pd of plan.basis.pds.keys()) {
    const source = planSheetData(plan, pd)
    if (!source.ok) throw new Error(source.error.message)
    const built = buildPdSheets(source.value, pd, 50000, tableMeasurer)
    if (!built.ok) throw new Error(built.error.message)
    total += built.value.pages.length
  }
  return total
}

describe('Вымышленные планы замера', () => {
  it('одинаковы при каждой сборке и проходят проверки формата плана', () => {
    const first = encodePlan(fictionalPlan(profile('typical')), '0.0.0')
    const second = encodePlan(fictionalPlan(profile('typical')), '0.0.0')
    expect(first.ok && second.ok).toBe(true)
    expect(first).toEqual(second)
  })

  it.each(PLAN_PROFILES.map((p) => [p.title, p] as const))(
    '%s: заявленное число ПД, станций и работ, таблицы ПД заполнены',
    (_title, p) => {
      const plan = fictionalPlan(p)
      expect(plan.basis.pds.size).toBe(p.pds)
      expect(plan.basis.stations.size).toBe(p.pds * p.stationsPerPd)
      expect(plan.works).toHaveLength(p.works)
      expect(plan.works.some((w) => w.place.kind === 'station')).toBe(true)
      expect(plan.datedIndicators.get('pd:ПД-1')).toHaveLength(p.rows)
    },
  )

  it('профиль «30 листов» даёт ровно 30 листов ПД в масштабе по умолчанию', () => {
    expect(pages('sheets30')).toBe(30)
  })
})
