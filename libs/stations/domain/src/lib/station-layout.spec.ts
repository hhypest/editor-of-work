import { describe, expect, it } from 'vitest'
import {
  layoutProblems,
  moveNode,
  renumberSwitch,
  renumberTrack,
  trackSpan,
  type StationLayout,
} from './station-layout'

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
const value = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}
const message = (r: { ok: boolean; error?: { message: string } }) =>
  r.ok ? null : r.error?.message
const node = (l: StationLayout, id: string) => l.nodes.find((n) => n.id === id)!

describe('Правка раскладки станции', () => {
  it('исходная раскладка не нарушает правил', () => {
    expect(layoutProblems(layout)).toEqual([])
    expect(trackSpan(layout, layout.tracks[1]!)).toEqual({ from: 4, to: 18 })
  })

  it('переносит узел в свободную клетку, пути следуют за ним', () => {
    const moved = value(moveNode(layout, 'c', { col: 8, row: 0 }))
    expect(node(moved, 'c')).toMatchObject({ col: 8, row: 0 })
    expect(node(layout, 'c').col).toBe(6)
  })

  it('не меняет раскладку, если узел остался в своей клетке', () => {
    expect(value(moveNode(layout, 'c', { col: 6, row: 0 }))).toBe(layout)
  })

  it('сдвигает стрелку только вдоль её ряда', () => {
    expect(node(value(moveNode(layout, 's', { col: 5, row: 1 })), 's').col).toBe(5)
    expect(message(moveNode(layout, 's', { col: 4, row: 2 }))).toBe(
      'Стрелка сдвигается только вдоль своего пути.',
    )
  })

  it('не ставит два узла в одну клетку', () => {
    expect(message(moveNode(layout, 'c', { col: 18, row: 0 }))).toBe('Клетка занята другим узлом.')
  })

  it('не выпускает узел за пределы сетки', () => {
    expect(message(moveNode(layout, 'a', { col: -1, row: 1 }))).toContain('пределах сетки')
    expect(message(moveNode(layout, 'a', { col: 0.5, row: 1 }))).toContain('пределах сетки')
  })

  it('не разворачивает путь справа налево', () => {
    expect(message(moveNode(layout, 'c', { col: 2, row: 0 }))).toBe('Путь 3 идёт справа налево.')
  })

  it('не оставляет остряк и мост вне их путей', () => {
    expect(message(moveNode(layout, 'd', { col: 9, row: 0 }))).toBe(
      'Остряк 3со оказался вне своего пути.',
    )
    expect(message(moveNode(layout, 'b', { col: 13, row: 1 }))).toBe(
      'Мост оказался вне своего пути.',
    )
  })

  it('сообщает о неизвестном узле', () => {
    expect(message(moveNode(layout, 'x', { col: 1, row: 1 }))).toBe('Узел не найден.')
  })

  it('меняет номер пути и отклоняет повтор', () => {
    expect(value(renumberTrack(layout, 't2', ' 5 ')).tracks[1]?.number).toBe('5')
    expect(message(renumberTrack(layout, 't2', 'I'))).toBe('Путь I уже есть на схеме.')
    expect(message(renumberTrack(layout, 'tx', '5'))).toBe('Путь не найден.')
    expect(message(renumberTrack(layout, 't2', '1'.repeat(21)))).toContain('длиннее')
  })

  it('станционный путь без номера становится путём без номера, и обратно', () => {
    const unnamed = value(renumberTrack(layout, 't2', ''))
    expect(unnamed.tracks[1]).toMatchObject({ number: null, kind: 'siding' })
    expect(value(renumberTrack(unnamed, 't2', '3')).tracks[1]).toMatchObject({ kind: 'station' })
    expect(value(renumberTrack(layout, 't2', '3'))).toBe(layout)
  })

  it('не даёт номер съезду', () => {
    const withConnector: StationLayout = {
      ...layout,
      tracks: [
        ...layout.tracks,
        { ...layout.tracks[1]!, id: 't3', number: null, kind: 'connector' },
      ],
    }
    expect(message(renumberTrack(withConnector, 't3', '9'))).toBe('Съезд не получает номер пути.')
  })

  it('меняет номер стрелки', () => {
    expect(value(renumberSwitch(layout, 'w1', '7')).switches[0]?.number).toBe('7')
    expect(value(renumberSwitch(layout, 'w1', null)).switches[0]?.number).toBeNull()
    expect(message(renumberSwitch(layout, 'wx', '7'))).toBe('Стрелка не найдена.')
    expect(value(renumberSwitch(layout, 'w1', '1'))).toBe(layout)
  })

  it('находит стрелку вне пути, чужую ветвь и неизвестные узлы', () => {
    const broken: StationLayout = {
      ...layout,
      nodes: [...layout.nodes, { id: 'e', col: 6, row: 0, kind: 'bend' }],
      tracks: [...layout.tracks, { ...layout.tracks[0]!, id: 't9', nodes: ['zz'] }],
      switches: [{ id: 'w1', number: '1', node: 's', track: 't2', branch: 't1' }],
    }
    const problems = layoutProblems(broken)
    expect(problems).toContain('Два узла в одной клетке (6; 0).')
    expect(problems).toContain('Путь I: неизвестные узлы.')
    expect(problems).toContain('Ветвь стрелки 1 не начинается в её узле.')
  })
})
