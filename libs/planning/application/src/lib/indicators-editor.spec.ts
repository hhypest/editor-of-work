import { createAnnualPlan, indicatorsOf, samplePlanBasis } from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { openPlanSession, undoPlan, redoPlan } from './plan-session'
import { changeEditor, editorView } from './editor'
import type { EditorIndicatorDraft } from './editor-model'
import { planSheetData } from './sheet-data'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const draft: EditorIndicatorDraft = {
  id: null,
  name: 'Учебный показатель',
  unit: 'шт',
  value: '0',
  note: 'Примечание',
}
const fresh = () => openPlanSession(value(createAnnualPlan(2027, samplePlanBasis())))
describe('Показатели в сценариях редактора', () => {
  it('применяет пакет одним шагом, генерирует стабильные ID в main и отменяет/повторяет', () => {
    const ids = { next: vi.fn<() => string>().mockReturnValueOnce('a').mockReturnValueOnce('b') }
    const session = fresh()
    const next = value(
      changeEditor(
        session,
        { kind: 'indicatorRows', rows: [draft, { ...draft, value: '-1,5' }] },
        'pd:ПД-1',
        ids,
      ),
    )
    const rows = value(editorView(next, 'pd:ПД-1')).indicators
    expect(rows.map((r) => [r.id, r.value])).toEqual([
      ['a', 0],
      ['b', -1.5],
    ])
    expect(undoPlan(next).present).toBe(session.present)
    expect(redoPlan(undoPlan(next)).present).toBe(next.present)
    const same = value(
      changeEditor(
        next,
        { kind: 'indicatorRows', rows: rows.map((r) => ({ ...r, value: String(r.value) })) },
        'pd:ПД-1',
        ids,
      ),
    )
    expect(same).toBe(next)
    expect(ids.next).toHaveBeenCalledTimes(2)
  })
  it.each(['', 'Infinity', 'NaN', '0x10', '1,2,3'])(
    'ошибка числа %j не применяет даже корректную первую строку',
    (text) => {
      const session = fresh()
      expect(
        changeEditor(
          session,
          { kind: 'indicatorRows', rows: [draft, { ...draft, value: text }] },
          'district',
          { next: () => 'i' },
        ).ok,
      ).toBe(false)
      expect(session.present.indicators.size).toBe(0)
    },
  )
  it('сохраняет конечные большие числа в повторном вводе и проекции без Infinity', () => {
    const session = value(
      changeEditor(
        fresh(),
        { kind: 'indicatorRows', rows: [{ ...draft, value: '1e200' }] },
        'pd:ПД-1',
        { next: () => 'i' },
      ),
    )
    const source = value(planSheetData(session.present, 'ПД-1'))
    expect(source.pds[0]?.tables.at(-1)?.rows[0]).toEqual([
      'Учебный показатель',
      'шт',
      '1e+200',
      'Примечание',
    ])
    expect(value(editorView(session, 'district')).indicators).toEqual([])
  })
  it('изолирует области, не подставляет и не агрегирует значения', () => {
    let session = value(
      changeEditor(fresh(), { kind: 'indicatorRows', rows: [draft] }, 'pd:ПД-1', {
        next: () => 'i',
      }),
    )
    session = value(
      changeEditor(
        session,
        { kind: 'indicatorRows', rows: [{ ...draft, value: '9' }] },
        'station:S1',
        { next: () => 's' },
      ),
    )
    expect(indicatorsOf(session.present, { kind: 'pd', pd: 'ПД-1' })[0]?.value).toBe(0)
    expect(value(editorView(session, 'station:S1')).indicators[0]?.value).toBe(9)
    expect(
      value(planSheetData(session.present, 'ПД-2')).pds[1]?.tables.some(
        (t) => t.title === 'Ручные показатели ПД',
      ),
    ).toBe(false)
    expect(
      changeEditor(session, { kind: 'indicatorRows', rows: [draft] }, 'pd:нет', { next: () => 'x' })
        .ok,
    ).toBe(false)
  })
})
