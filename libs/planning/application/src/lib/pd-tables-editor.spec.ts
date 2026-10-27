import {
  addWork,
  createAnnualPlan,
  samplePlanBasis,
  setPlanIndicators,
  workId,
} from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { changeEditor, editorView } from './editor'
import { openPlanSession, undoPlan, redoPlan } from './plan-session'
import { planSheetData } from './sheet-data'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const ids = { next: () => 'Учебный-id' }
function fresh() {
  let plan = value(createAnnualPlan(2027, samplePlanBasis()))
  plan = value(
    addWork(plan, workId('s'), {
      kind: 'КСП',
      place: { kind: 'station', station: 'S1' },
      volume: 2,
      note: 'Учебная работа',
      callout: false,
    }),
  )
  plan = value(
    setPlanIndicators(plan, { kind: 'pd', pd: 'ПД-2' }, [
      { id: 'i', name: 'Учебный показатель', unit: '', value: 0, note: '' },
    ]),
  )
  return openPlanSession(plan)
}
describe('Настройка таблиц в редакторе', () => {
  it('применяет пакет одним шагом и меняет только вывод выбранного ПД', () => {
    const initial = fresh(),
      before = value(editorView(initial, 'pd:ПД-2'))
    expect(before.pdTables).toHaveLength(10)
    expect(before.pdTables.every((t) => t.visible)).toBe(true)
    const next = value(
      changeEditor(initial, { kind: 'pdTables', hidden: ['summary', 'works'] }, 'pd:ПД-2', ids),
    )
    const after = value(editorView(next, 'pd:ПД-2'))
    expect(after.works).toEqual(before.works)
    expect(after.tables).toEqual(before.tables)
    expect(after.indicators).toEqual(before.indicators)
    expect(after.pdTables.filter((t) => !t.visible).map((t) => t.key)).toEqual(['summary', 'works'])
    const full = value(planSheetData(initial.present)),
      filtered = value(planSheetData(next.present))
    expect(filtered.pds[0]).toEqual(full.pds[0])
    expect(filtered.pds[1]?.works).toEqual(full.pds[1]?.works)
    expect(filtered.pds[1]?.tables.map((t) => t.title)).toEqual([
      'План текущего содержания',
      'Капитальные работы',
      'Ручные показатели ПД',
    ])
    expect(undoPlan(next).present).toBe(initial.present)
    expect(redoPlan(undoPlan(next)).present).toBe(next.present)
    expect(
      value(changeEditor(next, { kind: 'pdTables', hidden: ['works', 'summary'] }, 'pd:ПД-2', ids)),
    ).toBe(next)
    expect(value(editorView(next, 'district')).pdTables).toEqual([])
  })
  it.each(['district', 'station:S1', 'pd:нет'])('не меняет настройку чужой области %s', (area) => {
    expect(changeEditor(fresh(), { kind: 'pdTables', hidden: ['works'] }, area, ids).ok).toBe(false)
  })
  it('может скрыть все семейства, сохраняя станционную работу и показатели', () => {
    const initial = fresh()
    const next = value(
      changeEditor(
        initial,
        {
          kind: 'pdTables',
          hidden: ['current', 'capital', 'other', 'summary', 'works', 'indicators'],
        },
        'pd:ПД-2',
        ids,
      ),
    )
    const pd = value(planSheetData(next.present)).pds[1]!
    expect(pd.tables).toEqual([])
    expect(pd.works.map((w) => w.id)).toEqual(['s'])
    expect(value(editorView(next, 'pd:ПД-2')).indicators).toHaveLength(1)
  })
})
