import { describe, expect, it } from 'vitest'
import {
  applyEdit,
  canRedoEdit,
  canUndoEdit,
  openEditor,
  type StationLayout,
} from './station-editor'
import { cellAt, cellPoint, layoutDrawing } from './layout-drawing'

/** Вымышленная станция: главный I, путь 3 ответвляется стрелкой 1 и кончается упором. */
const layout: StationLayout = {
  version: 1,
  nodes: [
    { id: 'a', col: 0, row: 1, kind: 'end', end: 'open' },
    { id: 's', col: 4, row: 1, kind: 'switch' },
    { id: 'b', col: 20, row: 1, kind: 'end', end: 'open' },
    { id: 'c', col: 6, row: 0, kind: 'bend' },
    { id: 'd', col: 18, row: 0, kind: 'end', end: 'stop' },
  ],
  tracks: [
    {
      id: 't1',
      number: 'I',
      kind: 'main',
      state: 'normal',
      nodes: ['a', 's', 'b'],
      fullLength: null,
      capacity: null,
    },
    {
      id: 't2',
      number: '3',
      kind: 'station',
      state: 'normal',
      nodes: ['s', 'c', 'd'],
      fullLength: 400,
      capacity: '40',
    },
  ],
  switches: [{ id: 'w1', number: '1', node: 's', track: 't1', branch: 't2' }],
  derailers: [{ id: 'r1', number: '3со', track: 't2', col: 10 }],
  bridges: [{ id: 'g1', label: null, track: 't1', fromCol: 12, toCol: 14 }],
  crossings: [],
}
const nodeOf = (l: StationLayout, id: string) => l.nodes.find((n) => n.id === id)!

describe('Сеанс правки схемы станции', () => {
  it('сводит все сдвиги одного перетаскивания в один шаг отмены', () => {
    let s = openEditor(layout)
    for (const col of [7, 8, 9])
      s = applyEdit(s, { kind: 'move', node: 'c', to: { col, row: 0 }, drag: 'd1' })
    s = applyEdit(s, { kind: 'end-drag' })
    expect(nodeOf(s.history.present, 'c').col).toBe(9)
    s = applyEdit(s, { kind: 'undo' })
    expect(nodeOf(s.history.present, 'c').col).toBe(6)
    expect(canUndoEdit(s)).toBe(false)
    expect(canRedoEdit(s)).toBe(true)
    s = applyEdit(s, { kind: 'redo' })
    expect(nodeOf(s.history.present, 'c').col).toBe(9)
  })

  it('каждое отдельное перемещение — свой шаг отмены', () => {
    let s = openEditor(layout)
    s = applyEdit(s, { kind: 'move', node: 'c', to: { col: 7, row: 0 } })
    s = applyEdit(s, { kind: 'move', node: 'c', to: { col: 8, row: 0 } })
    s = applyEdit(s, { kind: 'undo' })
    expect(nodeOf(s.history.present, 'c').col).toBe(7)
  })

  it('отклонённая правка оставляет схему и сообщает причину до следующей удачной', () => {
    let s = openEditor(layout)
    s = applyEdit(s, { kind: 'move', node: 's', to: { col: 4, row: 3 } })
    expect(s.error).toBe('Стрелка сдвигается только вдоль своего пути.')
    expect(s.history.present).toBe(layout)
    s = applyEdit(s, { kind: 'renumber-track', track: 't2', number: '5' })
    expect(s.error).toBeNull()
    s = applyEdit(s, { kind: 'renumber-switch', switchId: 'w1', number: '9' })
    expect(s.history.present.switches[0]?.number).toBe('9')
  })
})

describe('Рисунок схемы станции', () => {
  it('переводит клетки в точки и обратно', () => {
    const p = cellPoint({ col: 5, row: 2 })
    expect(cellAt(p)).toEqual({ col: 5, row: 2 })
    expect(cellAt({ x: p.x + 7, y: p.y - 15 })).toEqual({ col: 5, row: 2 })
    expect(cellAt({ x: -100, y: -100 })).toEqual({ col: 0, row: 0 })
  })

  it('кладёт остряк и мост на линию своего пути', () => {
    const d = layoutDrawing(layout)
    const derailer = d.derailers[0]!
    expect(derailer.y).toBe(cellPoint({ col: 10, row: 0 }).y)
    const bridge = d.bridges[0]!
    expect([bridge.from.y, bridge.to.y]).toEqual([
      cellPoint({ col: 0, row: 1 }).y,
      cellPoint({ col: 0, row: 1 }).y,
    ])
  })

  it('подписывает пути номером и длиной, стрелки — номером', () => {
    const d = layoutDrawing(layout)
    expect(d.tracks.map((t) => t.label?.text)).toEqual(['I', '3 · 400 м'])
    expect(d.nodes.find((n) => n.id === 's')?.label).toBe('1')
    expect(d.width).toBeGreaterThan(cellPoint({ col: 20, row: 0 }).x)
  })
})
