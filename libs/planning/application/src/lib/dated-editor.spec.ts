import { createAnnualPlan, datedIndicatorsOf, samplePlanBasis } from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { openPlanSession, undoPlan, redoPlan } from './plan-session'
import { changeEditor, editorView } from './editor'
import type { EditorDatedDraft } from './editor-model'
import { planSheetData } from './sheet-data'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const draft: EditorDatedDraft = {
  id: null,
  name: 'Учебная протяжённость, км',
  previous: '',
  current: '',
}
const fresh = () => openPlanSession(value(createAnnualPlan(2027, samplePlanBasis())))
const ids = (...values: string[]) => {
  const next = vi.fn<() => string>()
  for (const v of values) next.mockReturnValueOnce(v)
  return { next }
}
describe('Таблица «Показатели» в сценариях редактора', () => {
  it('применяет пакет одним шагом: пустое поле — без значения, ноль и знак сохраняются', () => {
    const session = fresh(),
      generator = ids('a', 'b')
    const next = value(
      changeEditor(
        session,
        {
          kind: 'datedRows',
          rows: [draft, { ...draft, previous: ' -2,5 ', current: '0' }],
        },
        'pd:ПД-1',
        generator,
      ),
    )
    const rows = value(editorView(next, 'pd:ПД-1')).dated
    expect(rows).toEqual([
      { id: 'a', name: 'Учебная протяжённость, км', previous: null, current: null },
      { id: 'b', name: 'Учебная протяжённость, км', previous: -2.5, current: 0 },
    ])
    expect(undoPlan(next).present).toBe(session.present)
    expect(redoPlan(undoPlan(next)).present).toBe(next.present)
    const same = value(
      changeEditor(
        next,
        {
          kind: 'datedRows',
          rows: (rows ?? []).map((r) => ({
            ...r,
            previous: r.previous === null ? '' : String(r.previous),
            current: r.current === null ? '' : String(r.current),
          })),
        },
        'pd:ПД-1',
        generator,
      ),
    )
    expect(same).toBe(next)
    expect(generator.next).toHaveBeenCalledTimes(2)
  })
  it.each(['Infinity', 'NaN', '0x10', '1,2,3', 'ноль'])(
    'ошибка числа %j не применяет даже корректную первую строку',
    (text) => {
      const session = fresh()
      const result = changeEditor(
        session,
        {
          kind: 'datedRows',
          rows: [
            { ...draft, current: '1' },
            { ...draft, previous: text },
          ],
        },
        'district',
        { next: () => 'e' },
      )
      expect(result).toMatchObject({
        ok: false,
        error: [{ message: expect.stringMatching(/^Показатель 2:/u) }],
      })
      expect(session.present.datedIndicators.size).toBe(0)
    },
  )
  it('доступна для дистанции и ПД, у станции раздела нет', () => {
    const session = fresh()
    expect(value(editorView(session, 'district')).dated).toEqual([])
    expect(value(editorView(session, 'pd:ПД-1')).dated).toEqual([])
    expect(value(editorView(session, 'station:S1')).dated).toBeNull()
    expect(
      changeEditor(session, { kind: 'datedRows', rows: [draft] }, 'station:S1', {
        next: () => 's',
      }),
    ).toMatchObject({
      ok: false,
      error: [{ message: 'Таблица «Показатели» ведётся только для дистанции и ПД' }],
    })
    expect(
      changeEditor(session, { kind: 'datedRows', rows: [{ ...draft, name: ' ' }] }, 'district', {
        next: () => 'n',
      }),
    ).toMatchObject({ ok: false, error: [{ message: 'Укажите наименование каждого показателя' }] })
  })
  it('выводит таблицу первой на листе ПД с годами, изменением и процентом', () => {
    let session = value(
      changeEditor(
        fresh(),
        {
          kind: 'datedRows',
          rows: [
            { ...draft, previous: '10', current: '12,5' },
            { ...draft, name: 'Учебное снижение', previous: '8', current: '6' },
            { ...draft, name: 'Учебный с нулевой базой', previous: '0', current: '3' },
            { ...draft, name: 'Учебный без прошлого', previous: '', current: '4' },
            { ...draft, name: 'Учебный без изменений', previous: '1,0004', current: '1,0001' },
          ],
        },
        'pd:ПД-1',
        ids('a', 'b', 'c', 'd', 'e'),
      ),
    )
    session = value(
      changeEditor(session, { kind: 'datedRows', rows: [{ ...draft, current: '7' }] }, 'district', {
        next: () => 'f',
      }),
    )
    const tables = value(planSheetData(session.present, 'ПД-1')).pds[0]?.tables ?? []
    expect(tables[0]?.title).toBe('Показатели')
    expect(tables[0]?.columns.map((c) => c.title)).toEqual([
      'Показатель',
      'на 01.01.2026',
      'на 01.01.2027',
      '+/−',
      '%',
    ])
    expect(tables[0]?.rows).toEqual([
      ['Учебная протяжённость, км', '10', '12,5', '+2,5', '25'],
      ['Учебное снижение', '8', '6', '-2', '-25'],
      ['Учебный с нулевой базой', '0', '3', '+3', '—'],
      ['Учебный без прошлого', '', '4', '', '—'],
      ['Учебный без изменений', '1', '1', '0', '0'],
    ])
    expect(
      value(planSheetData(session.present, 'ПД-2')).pds[1]?.tables.some(
        (t) => t.title === 'Показатели',
      ),
    ).toBe(false)
    expect(datedIndicatorsOf(session.present, { kind: 'district' })[0]?.current).toBe(7)
  })
  it('скрытие таблицы убирает её с листа, но сохраняет строки в плане и редакторе', () => {
    let session = value(
      changeEditor(fresh(), { kind: 'datedRows', rows: [{ ...draft, current: '3' }] }, 'pd:ПД-1', {
        next: () => 'a',
      }),
    )
    session = value(
      changeEditor(session, { kind: 'pdTables', hidden: ['dated'] }, 'pd:ПД-1', {
        next: () => 'x',
      }),
    )
    const view = value(editorView(session, 'pd:ПД-1'))
    expect(view.pdTables[0]).toEqual({ key: 'dated', label: 'Показатели', visible: false })
    expect(view.dated?.[0]?.current).toBe(3)
    expect(
      value(planSheetData(session.present, 'ПД-1')).pds[0]?.tables.some(
        (t) => t.title === 'Показатели',
      ),
    ).toBe(false)
  })
})
