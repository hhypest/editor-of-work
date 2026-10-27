import { createAnnualPlan, expectedIndicatorsOf, samplePlanBasis } from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { openPlanSession, undoPlan, redoPlan } from './plan-session'
import { changeEditor, editorView } from './editor'
import type { EditorExpectedDraft } from './editor-model'
import { planSheetData } from './sheet-data'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const draft: EditorExpectedDraft = {
  id: null,
  group: 'Учебная протяжённость',
  name: '',
  unit: 'км',
  value: '',
}
const fresh = () => openPlanSession(value(createAnnualPlan(2027, samplePlanBasis())))
describe('Ожидаемые показатели в сценариях редактора', () => {
  it('применяет пакет одним шагом: пустое поле — без значения, ноль и знак сохраняются', () => {
    const ids = {
      next: vi
        .fn<() => string>()
        .mockReturnValueOnce('a')
        .mockReturnValueOnce('b')
        .mockReturnValueOnce('c'),
    }
    const session = fresh()
    const next = value(
      changeEditor(
        session,
        {
          kind: 'expectedRows',
          rows: [
            draft,
            { ...draft, name: 'учебная часть', value: '0' },
            { ...draft, value: ' -2,5 ' },
          ],
        },
        'pd:ПД-1',
        ids,
      ),
    )
    const rows = value(editorView(next, 'pd:ПД-1')).expected
    expect(rows?.map((r) => [r.id, r.value])).toEqual([
      ['a', null],
      ['b', 0],
      ['c', -2.5],
    ])
    expect(undoPlan(next).present).toBe(session.present)
    expect(redoPlan(undoPlan(next)).present).toBe(next.present)
    const same = value(
      changeEditor(
        next,
        {
          kind: 'expectedRows',
          rows: (rows ?? []).map((r) => ({
            ...r,
            value: r.value === null ? '' : String(r.value),
          })),
        },
        'pd:ПД-1',
        ids,
      ),
    )
    expect(same).toBe(next)
    expect(ids.next).toHaveBeenCalledTimes(3)
  })
  it.each(['Infinity', 'NaN', '0x10', '1,2,3', 'ноль'])(
    'ошибка числа %j не применяет даже корректную первую строку',
    (text) => {
      const session = fresh()
      const result = changeEditor(
        session,
        {
          kind: 'expectedRows',
          rows: [
            { ...draft, value: '1' },
            { ...draft, value: text },
          ],
        },
        'district',
        { next: () => 'e' },
      )
      expect(result).toMatchObject({
        ok: false,
        error: [{ message: expect.stringMatching(/^Ожидаемый показатель 2:/u) }],
      })
      expect(session.present.expectedIndicators.size).toBe(0)
    },
  )
  it('доступен для дистанции и ПД, у станции раздела нет', () => {
    const session = fresh()
    expect(value(editorView(session, 'district')).expected).toEqual([])
    expect(value(editorView(session, 'pd:ПД-1')).expected).toEqual([])
    expect(value(editorView(session, 'station:S1')).expected).toBeNull()
    const onStation = changeEditor(session, { kind: 'expectedRows', rows: [draft] }, 'station:S1', {
      next: () => 's',
    })
    expect(onStation).toMatchObject({
      ok: false,
      error: [{ message: 'Ожидаемые показатели ведутся только для дистанции и ПД' }],
    })
    expect(
      changeEditor(session, { kind: 'expectedRows', rows: [draft] }, 'pd:нет', { next: () => 'x' })
        .ok,
    ).toBe(false)
  })
  it('выводит таблицу ПД с годом, группами и пустыми значениями, не трогая соседей', () => {
    let session = value(
      changeEditor(
        fresh(),
        {
          kind: 'expectedRows',
          rows: [
            draft,
            { ...draft, name: 'учебная часть', value: '1,25' },
            { ...draft, group: 'Учебный итог', unit: 'шт', value: '1e200' },
          ],
        },
        'pd:ПД-1',
        {
          next: vi
            .fn<() => string>()
            .mockReturnValueOnce('a')
            .mockReturnValueOnce('b')
            .mockReturnValueOnce('c'),
        },
      ),
    )
    session = value(
      changeEditor(
        session,
        { kind: 'expectedRows', rows: [{ ...draft, value: '7' }] },
        'district',
        {
          next: () => 'd',
        },
      ),
    )
    const data = value(planSheetData(session.present, 'ПД-1'))
    const table = data.pds[0]?.tables.find((t) => t.title.startsWith('Ожидаемые'))
    expect(table?.title).toBe('Ожидаемые показатели на 01.01.2028')
    expect(table?.groupColumn).toBe(0)
    expect(table?.rows).toEqual([
      ['Учебная протяжённость', '', 'км', ''],
      ['Учебная протяжённость', 'учебная часть', 'км', '1,25'],
      ['Учебный итог', '', 'шт', '1e+200'],
    ])
    expect(
      value(planSheetData(session.present, 'ПД-2')).pds[1]?.tables.some((t) =>
        t.title.startsWith('Ожидаемые'),
      ),
    ).toBe(false)
    expect(expectedIndicatorsOf(session.present, { kind: 'district' })[0]?.value).toBe(7)
  })
  it('скрытие таблицы убирает её с листа, но сохраняет строки в плане и редакторе', () => {
    let session = value(
      changeEditor(fresh(), { kind: 'expectedRows', rows: [{ ...draft, value: '3' }] }, 'pd:ПД-1', {
        next: () => 'a',
      }),
    )
    session = value(
      changeEditor(session, { kind: 'pdTables', hidden: ['expected'] }, 'pd:ПД-1', {
        next: () => 'x',
      }),
    )
    const view = value(editorView(session, 'pd:ПД-1'))
    expect(view.pdTables.find((t) => t.key === 'expected')).toEqual({
      key: 'expected',
      label: 'Ожидаемые показатели',
      visible: false,
    })
    expect(view.expected?.[0]?.value).toBe(3)
    expect(
      value(planSheetData(session.present, 'ПД-1')).pds[0]?.tables.some((t) =>
        t.title.startsWith('Ожидаемые'),
      ),
    ).toBe(false)
  })
})
