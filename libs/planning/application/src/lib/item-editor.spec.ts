import { createAnnualPlan, itemsOf, samplePlanBasis } from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { openPlanSession, undoPlan, redoPlan } from './plan-session'
import { changeEditor, editorView } from './editor'
import type { EditorItemDraft } from './editor-model'
import { planSheetData } from './sheet-data'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Учебная ошибка')
  return r.value
}
const draft: EditorItemDraft = {
  id: null,
  name: 'Учебная подрядная работа',
  unit: 'м3',
  quantity: '12,5',
  cost: '3,256',
}
const fresh = () => openPlanSession(value(createAnnualPlan(2027, samplePlanBasis())))
const ids = () => ({
  next: vi.fn<() => string>().mockReturnValueOnce('a').mockReturnValueOnce('b'),
})

describe('Перечни работ в сценариях редактора', () => {
  it('применяет пакет одного перечня одним шагом и не трогает остальные', () => {
    const session = fresh()
    const generator = ids()
    const next = value(
      changeEditor(
        session,
        {
          kind: 'itemRows',
          table: 'contract',
          rows: [draft, { ...draft, quantity: '0', cost: '' }],
        },
        'pd:ПД-1',
        generator,
      ),
    )
    const view = value(editorView(next, 'pd:ПД-1'))
    expect(view.items?.map((t) => [t.table, t.title, t.rows.length])).toEqual([
      ['contract', 'Работы подрядным способом', 2],
      ['isso', 'Работы по содержанию ИССО', 0],
      ['zp', 'Работы по содержанию земляного полотна', 0],
    ])
    expect(view.items?.[0]?.rows.map((r) => [r.id, r.quantity, r.cost])).toEqual([
      ['a', 12.5, 3.256],
      ['b', 0, 0],
    ])
    expect(undoPlan(next).present).toBe(session.present)
    expect(redoPlan(undoPlan(next)).present).toBe(next.present)
    const same = value(
      changeEditor(
        next,
        {
          kind: 'itemRows',
          table: 'contract',
          rows: (view.items?.[0]?.rows ?? []).map((r) => ({
            ...r,
            quantity: String(r.quantity),
            cost: String(r.cost),
          })),
        },
        'pd:ПД-1',
        generator,
      ),
    )
    expect(same).toBe(next)
    expect(generator.next).toHaveBeenCalledTimes(2)
  })
  it.each(['-1', 'много', 'Infinity', '1,2,3'])(
    'ошибка объёма или стоимости %j не применяет пакет',
    (text) => {
      const session = fresh()
      for (const row of [
        { ...draft, quantity: text },
        { ...draft, cost: text },
      ])
        expect(
          changeEditor(
            session,
            { kind: 'itemRows', table: 'isso', rows: [draft, row] },
            'district',
            { next: () => 'x' },
          ),
        ).toMatchObject({ ok: false, error: [{ message: expect.stringMatching(/^Строка 2:/u) }] })
      expect(session.present.itemTables.size).toBe(0)
    },
  )
  it('станция не ведёт перечни; пустое наименование отклоняется доменом', () => {
    const session = fresh()
    expect(value(editorView(session, 'station:S1')).items).toBeNull()
    expect(
      changeEditor(session, { kind: 'itemRows', table: 'zp', rows: [draft] }, 'station:S1', {
        next: () => 's',
      }),
    ).toMatchObject({
      ok: false,
      error: [{ message: 'Подрядные работы, ИССО и ЗП ведутся только для дистанции и ПД' }],
    })
    expect(
      changeEditor(
        session,
        { kind: 'itemRows', table: 'zp', rows: [{ ...draft, name: ' ' }] },
        'district',
        { next: () => 'd' },
      ),
    ).toMatchObject({
      ok: false,
      error: [{ message: 'Укажите наименование каждой работы перечня' }],
    })
  })
  it('лист ПД выводит строки с объёмом или стоимостью, пустой перечень — без строк, скрытие сохраняет данные', () => {
    let session = value(
      changeEditor(
        fresh(),
        {
          kind: 'itemRows',
          table: 'contract',
          rows: [draft, { ...draft, name: 'Нулевая', quantity: '0', cost: '0' }],
        },
        'pd:ПД-1',
        ids(),
      ),
    )
    session = value(
      changeEditor(
        session,
        { kind: 'itemRows', table: 'zp', rows: [{ ...draft, quantity: '0', cost: '0' }] },
        'pd:ПД-1',
        { next: () => 'z' },
      ),
    )
    const tables = value(planSheetData(session.present, 'ПД-1')).pds[0]?.tables ?? []
    const contract = tables.find((t) => t.title === 'Работы подрядным способом')
    expect(contract?.rows).toEqual([['1', 'Учебная подрядная работа', 'м3', '12,5', '3,26']])
    expect(tables.find((t) => t.title === 'Работы по содержанию земляного полотна')?.rows).toEqual(
      [],
    )
    expect(tables.some((t) => t.title === 'Работы по содержанию ИССО')).toBe(false)
    session = value(
      changeEditor(session, { kind: 'pdTables', hidden: ['contract'] }, 'pd:ПД-1', {
        next: () => 'h',
      }),
    )
    expect(
      value(planSheetData(session.present, 'ПД-1')).pds[0]?.tables.some(
        (t) => t.title === 'Работы подрядным способом',
      ),
    ).toBe(false)
    expect(itemsOf(session.present, { kind: 'pd', pd: 'ПД-1' }, 'contract')).toHaveLength(2)
    expect(
      value(planSheetData(session.present, 'ПД-2')).pds[1]?.tables.some((t) =>
        t.title.startsWith('Работы'),
      ),
    ).toBe(false)
  })
  it('округляет стоимость по десятичной записи и не печатает Infinity для больших чисел', () => {
    const session = value(
      changeEditor(
        fresh(),
        {
          kind: 'itemRows',
          table: 'contract',
          rows: [
            { ...draft, quantity: '1', cost: '1,005' },
            { ...draft, quantity: '100000000000000000000', cost: '99,995' },
          ],
        },
        'pd:ПД-1',
        ids(),
      ),
    )
    const table = value(planSheetData(session.present, 'ПД-1')).pds[0]?.tables.find(
      (t) => t.title === 'Работы подрядным способом',
    )
    expect(table?.rows.map((r) => [r[3], r[4]])).toEqual([
      ['1', '1,01'],
      ['100000000000000000000', '100'],
    ])
  })
})
