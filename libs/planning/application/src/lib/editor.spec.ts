import { createAnnualPlan, samplePlanBasis } from '@eow/planning/domain'
import { sequentialIds, type Result } from '@eow/shared/kernel'
import { openPlanSession } from './plan-session'
import { changeEditor, editorView, inspectEditorPlace } from './editor'
import type { EditorDraft, EditorChange } from './editor-model'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Ошибка учебного плана')
  return r.value
}
const initial = () => openPlanSession(value(createAnnualPlan(2027, samplePlanBasis())))
const draft: EditorDraft = {
  kind: 'ППР',
  mode: 'line',
  line: 'L1',
  text: '20 км пк 10',
  station: '',
  objectKind: 'none',
  objectNumber: '',
  volume: '',
  note: 'Учебная работа',
  callout: true,
}
const ids = () => sequentialIds('work')

describe('Сценарии редактора плана', () => {
  it('разбирает пикет нестандартного километра, показывает ошибку с позицией и сохраняет нулевой объём', () => {
    const start = initial()
    expect(inspectEditorPlace(start, 'L1', draft.text)).toMatchObject({ meters: 64, issues: [] })
    const parsed = inspectEditorPlace(start, 'L1', '20 км пк 11')
    expect(parsed.issues[0]).toMatchObject({ field: 'place', start: 0 })
    expect(parsed.issues[0]?.message).toContain('вне 1–10')
    const changed = value(changeEditor(start, { kind: 'add', draft }, 'district', ids()))
    expect(value(editorView(changed, 'district')).works[0]).toMatchObject({
      volume: 0.064,
      draft: { volume: '' },
    })
    const zero = value(
      changeEditor(start, { kind: 'add', draft: { ...draft, volume: '0' } }, 'district', ids()),
    )
    expect(value(editorView(zero, 'district')).works[0]?.volume).toBe(0)
    expect(
      changeEditor(
        start,
        { kind: 'add', draft: { ...draft, volume: 'не число' } },
        'district',
        ids(),
      ),
    ).toMatchObject({ ok: false, error: [{ field: 'volume' }] })
    expect(
      changeEditor(
        start,
        { kind: 'add', draft: { ...draft, text: '24+000 – 31+000' } },
        'district',
        ids(),
      ),
    ).toMatchObject({ ok: false, error: [{ field: 'place' }] })
  })
  it('фильтрует по ПД, показывает полный объём в списке и долю в таблице', () => {
    const session = value(
      changeEditor(
        initial(),
        { kind: 'add', draft: { ...draft, text: '17+000 – 21+000' } },
        'district',
        ids(),
      ),
    )
    const view = value(editorView(session, 'pd:ПД-1'))
    expect(view.works).toHaveLength(1)
    expect(view.works[0]?.volume).toBe(3.964)
    expect(view.tables[0]?.rows[0]).toMatchObject({
      computed: 1,
      value: 1,
      need: null,
      manual: false,
    })
    expect(editorView(session, 'pd:нет')).toMatchObject({ ok: false })
  })
  it('сохраняет все поля станционной и гибридной работы при выборе для изменения', () => {
    const station = {
      ...draft,
      kind: 'КСП',
      mode: 'station' as const,
      station: 'S1',
      objectKind: 'switch' as const,
      objectNumber: '3',
      volume: '2,5',
    }
    let session = value(changeEditor(initial(), { kind: 'add', draft: station }, 'district', ids()))
    let view = value(editorView(session, 'station:S1'))
    expect(view.works[0]?.draft).toMatchObject({
      mode: 'station',
      station: 'S1',
      objectKind: 'switch',
      objectNumber: '3',
      volume: '2,5',
      callout: true,
    })
    const id = view.works[0]!.id
    session = value(
      changeEditor(
        session,
        { kind: 'edit', id, draft: { ...station, mode: 'line', text: '20+000 – 21+000' } },
        'district',
        ids(),
      ),
    )
    view = value(editorView(session, 'station:S1'))
    expect(view.works[0]?.draft).toMatchObject({
      mode: 'line',
      station: 'S1',
      objectKind: 'switch',
      objectNumber: '3',
    })
  })
  it('применяет таблицы атомарно и отменяет пакет одним шагом', () => {
    const start = initial(),
      bad: EditorChange = {
        kind: 'manualRows',
        rows: [
          { code: 'ППР', plan: '5', need: '10' },
          { code: 'КСП', plan: '2', need: '-1' },
        ],
      }
    expect(changeEditor(start, bad, 'pd:ПД-1', ids())).toMatchObject({ ok: false })
    expect(start.present.manual.size).toBe(0)
    const session = value(
      changeEditor(
        start,
        {
          kind: 'manualRows',
          rows: [
            { code: 'ППР', plan: '5', need: '10' },
            { code: 'КСП', plan: '0', need: '' },
          ],
        },
        'pd:ПД-1',
        ids(),
      ),
    )
    expect(value(editorView(session, 'pd:ПД-1')).tables[0]?.rows[0]).toMatchObject({
      value: 5,
      need: 10,
      manual: true,
    })
    const undo = value(changeEditor(session, { kind: 'undo' }, 'district', ids()))
    expect(undo.present).toBe(start.present)
    const redo = value(changeEditor(undo, { kind: 'redo' }, 'district', ids()))
    expect(redo.present).toBe(session.present)
  })
  it('гриф и удаление входят в историю; повтор восстанавливает работу без изменения исходного плана', () => {
    const start = initial(),
      added = value(changeEditor(start, { kind: 'add', draft }, 'district', ids())),
      id = added.present.works[0]!.id
    const approval = value(
      changeEditor(
        added,
        { kind: 'approval', title: 'Учебная должность', name: 'Учебный составитель', year: 2026 },
        'district',
        ids(),
      ),
    )
    expect(Object.keys(approval.present.approval).toSorted()).toEqual(['name', 'title', 'year'])
    const removed = value(changeEditor(approval, { kind: 'remove', id }, 'district', ids()))
    expect(removed.present.works).toHaveLength(0)
    const undo = value(changeEditor(removed, { kind: 'undo' }, 'district', ids()))
    expect(undo.present.works).toHaveLength(1)
    expect(start.present.works).toHaveLength(0)
    expect(
      changeEditor(undo, { kind: 'approval', title: '', name: '', year: 0 }, 'district', ids()),
    ).toMatchObject({ ok: false })
  })
})
