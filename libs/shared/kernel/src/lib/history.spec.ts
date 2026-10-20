import * as fc from 'fast-check'
import {
  canRedo,
  canUndo,
  commit,
  endGroup,
  HISTORY_LIMIT,
  historyOf,
  redo,
  undo,
  type History,
} from './history'

interface State {
  readonly n: number
}

const s = (n: number): State => ({ n })

function steps(h: History<State>, ...values: number[]): History<State> {
  return values.reduce((acc, n) => commit(acc, s(n)), h)
}

describe('History', () => {
  it('отмена и повтор возвращают прежние версии', () => {
    const h = steps(historyOf(s(0)), 1, 2)
    expect(undo(h).present).toEqual(s(1))
    expect(undo(undo(h)).present).toEqual(s(0))
    expect(redo(undo(undo(h))).present).toEqual(s(1))
    expect(canUndo(historyOf(s(0)))).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('отмена на пустой истории и повтор без отмен ничего не меняют', () => {
    const h = historyOf(s(0))
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it('новая правка после отмены сбрасывает повтор', () => {
    const h = commit(undo(steps(historyOf(s(0)), 1, 2)), s(5))
    expect(canRedo(h)).toBe(false)
    expect(undo(h).present).toEqual(s(1))
  })

  it('та же версия состояния — не шаг', () => {
    const h = historyOf(s(0))
    expect(commit(h, h.present)).toBe(h)
  })

  it('правки одной группы подряд — один шаг отмены', () => {
    let h = commit(historyOf(s(0)), s(1))
    for (const n of [2, 3, 4]) h = commit(h, s(n), { group: 'drag' })
    expect(h.present).toEqual(s(4))
    expect(undo(h).present).toEqual(s(1))
  })

  it('после завершения группы та же группа начинает новый шаг', () => {
    let h = commit(historyOf(s(0)), s(1), { group: 'note' })
    h = commit(h, s(2), { group: 'note' })
    h = endGroup(h)
    h = commit(h, s(3), { group: 'note' })
    expect(undo(h).present).toEqual(s(2))
    expect(undo(undo(h)).present).toEqual(s(0))
  })

  it('правка другой группы или без группы начинает новый шаг', () => {
    let h = commit(historyOf(s(0)), s(1), { group: 'a' })
    h = commit(h, s(2), { group: 'b' })
    h = commit(h, s(3))
    expect(h.past.map((x) => x.n)).toEqual([0, 1, 2])
  })

  it('отмена закрывает группу', () => {
    let h = commit(commit(historyOf(s(0)), s(1)), s(2), { group: 'g' })
    h = commit(undo(h), s(3), { group: 'g' })
    expect(h.past.map((x) => x.n)).toEqual([0, 1])
  })

  it(`хранит не больше ${HISTORY_LIMIT} шагов отмены`, () => {
    const values = Array.from({ length: HISTORY_LIMIT + 50 }, (_, i) => i + 1)
    let h = steps(historyOf(s(0)), ...values)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    while (canUndo(h)) h = undo(h)
    expect(h.present).toEqual(s(50))
  })

  it('неизменённые части состояния переходят в новую версию теми же объектами', () => {
    const shared = { big: [1, 2, 3] }
    const h = commit(historyOf({ shared, n: 0 }), { shared, n: 1 })
    expect(undo(h).present.shared).toBe(h.present.shared)
  })
})

describe('History: свойства', () => {
  it('k отмен и k повторов возвращают ту же версию', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { minLength: 1, maxLength: 30 }),
        fc.nat(30),
        (values, k) => {
          const h = steps(historyOf(s(Number.NaN)), ...values)
          let x = h
          for (let i = 0; i < k; i++) x = undo(x)
          for (let i = 0; i < k; i++) x = redo(x)
          expect(x.present).toBe(h.present)
        },
      ),
    )
  })
})
