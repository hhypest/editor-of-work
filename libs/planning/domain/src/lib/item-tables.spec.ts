import type { Result } from '@eow/shared/kernel'
import { createAnnualPlan } from './annual-plan'
import { samplePlanBasis } from './testing/sample-basis'
import {
  itemsOf,
  printedItems,
  setPlanItems,
  MAX_AREA_ITEMS,
  type ItemTableKind,
  type PlanItem,
} from './item-tables'
import { describePlanError } from './plan-error'

const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const pd = { kind: 'pd', pd: 'ПД-1' } as const
const row: PlanItem = {
  id: 'i',
  name: ' Учебная работа ',
  unit: ' м3 ',
  quantity: 12.5,
  cost: 3.25,
}

describe('Перечни подрядных работ, ИССО и ЗП', () => {
  it('хранит каждый перечень области отдельно и владеет строками', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    const input = [row, { ...row, id: 'j', quantity: 0, cost: -0 }]
    let next = value(setPlanItems(plan, pd, 'contract', input))
    input[0] = { ...row, quantity: 99 }
    expect(itemsOf(next, pd, 'contract')).toEqual([
      { id: 'i', name: 'Учебная работа', unit: 'м3', quantity: 12.5, cost: 3.25 },
      { id: 'j', name: 'Учебная работа', unit: 'м3', quantity: 0, cost: 0 },
    ])
    expect(Object.is(itemsOf(next, pd, 'contract')[1]?.cost, 0)).toBe(true)
    expect(Object.isFrozen(itemsOf(next, pd, 'contract'))).toBe(true)
    next = value(setPlanItems(next, { kind: 'district' }, 'isso', [{ ...row, id: 'd' }]))
    for (const kind of ['isso', 'zp'] as const) expect(itemsOf(next, pd, kind)).toEqual([])
    expect(itemsOf(next, { kind: 'district' }, 'isso')).toHaveLength(1)
    expect(itemsOf(next, { kind: 'district' }, 'contract')).toEqual([])
    expect(plan.itemTables.size).toBe(0)
  })
  it('на лист попадают только строки с объёмом или стоимостью', () => {
    const rows = [
      { ...row, quantity: 0, cost: 0 },
      { ...row, id: 'q', quantity: 1, cost: 0 },
      { ...row, id: 'c', quantity: 0, cost: 2 },
    ]
    expect(printedItems(rows).map((r) => r.id)).toEqual(['q', 'c'])
  })
  it.each([
    [{ ...row, name: ' ' }, 'Укажите наименование'],
    [{ ...row, id: '' }, 'Идентификаторы'],
    [{ ...row, quantity: -1 }, 'Объём'],
    [{ ...row, quantity: Number.NaN }, 'Объём'],
    [{ ...row, cost: -0.01 }, 'Стоимость'],
    [{ ...row, cost: Infinity }, 'Стоимость'],
  ])('отклоняет весь пакет со строкой %j без изменения плана', (bad, message) => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    const result = setPlanItems(plan, pd, 'zp', [row, bad])
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.error.map(describePlanError).join(' ')).toContain(message)
    expect(plan.itemTables.size).toBe(0)
  })
  it('отклоняет повтор ID, станцию, неизвестный ПД и перечень, ограничивает строки', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    expect(setPlanItems(plan, pd, 'contract', [row, row]).ok).toBe(false)
    const station = [...plan.basis.stations.keys()][0]!
    expect(setPlanItems(plan, { kind: 'station', station }, 'contract', [row])).toEqual({
      ok: false,
      error: [{ kind: 'invalid-item', reason: 'area' }],
    })
    expect(setPlanItems(plan, { kind: 'pd', pd: 'нет' }, 'contract', [row]).ok).toBe(false)
    expect(setPlanItems(plan, pd, 'чужой' as ItemTableKind, [row])).toEqual({
      ok: false,
      error: [{ kind: 'invalid-item', reason: 'kind' }],
    })
    expect(
      setPlanItems(
        plan,
        pd,
        'contract',
        Array.from({ length: MAX_AREA_ITEMS + 1 }, (_, i) => ({ ...row, id: String(i) })),
      ).ok,
    ).toBe(false)
  })
  it('сохраняет ссылку при неизменённом пакете и удаляет пустой перечень', () => {
    const plan = value(createAnnualPlan(2027, samplePlanBasis()))
    expect(value(setPlanItems(plan, pd, 'contract', []))).toBe(plan)
    const next = value(setPlanItems(plan, pd, 'contract', [row]))
    expect(value(setPlanItems(next, pd, 'contract', [{ ...row }]))).toBe(next)
    expect(value(setPlanItems(next, pd, 'contract', [])).itemTables.size).toBe(0)
  })
})
