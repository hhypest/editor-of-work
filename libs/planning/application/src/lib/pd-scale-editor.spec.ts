import { createAnnualPlan, samplePlanBasis } from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { changeEditor, editorView } from './editor'
import { openPlanSession, undoPlan, redoPlan } from './plan-session'
import { planSheetData } from './sheet-data'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const fresh = () => openPlanSession(value(createAnnualPlan(2027, samplePlanBasis())))
const ids = { next: () => 'Учебный-id' }
describe('Закрепление масштаба в редакторе', () => {
  it('создаёт один шаг, сохраняет независимые масштабы в проекции и не создаёт шаг при повторе', () => {
    const initial = fresh()
    const first = value(changeEditor(initial, { kind: 'pdScale', scale: 25000 }, 'pd:ПД-1', ids))
    expect(value(editorView(first, 'pd:ПД-1')).pdScale).toBe(25000)
    expect(value(editorView(first, 'pd:ПД-2')).pdScale).toBe(50000)
    expect(value(editorView(first, 'district')).pdScale).toBeNull()
    expect(value(changeEditor(first, { kind: 'pdScale', scale: 25000 }, 'pd:ПД-1', ids))).toBe(
      first,
    )
    expect(undoPlan(first).present).toBe(initial.present)
    expect(redoPlan(undoPlan(first)).present).toBe(first.present)
    expect(value(planSheetData(first.present)).pds.map((p) => p.scale)).toEqual([25000, 50000])
  })
  it.each(['district', 'station:S1', 'pd:нет'])('не применяет настройку к области %s', (area) => {
    const initial = fresh()
    expect(changeEditor(initial, { kind: 'pdScale', scale: 25000 }, area, ids).ok).toBe(false)
    expect(initial.present.pdScales.size).toBe(0)
  })
  it('не меняет историю при неверном масштабе', () => {
    expect(changeEditor(fresh(), { kind: 'pdScale', scale: 75000 }, 'pd:ПД-1', ids).ok).toBe(false)
  })
})
