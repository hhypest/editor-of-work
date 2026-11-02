import { describe, expect, it } from 'vitest'
import {
  addCrossing,
  addObject,
  editCrossing,
  editObject,
  moveCrossing,
  moveObject,
  objectProblems,
  removeCrossing,
  removeObject,
} from './scheme-objects'
import type { StationLayout } from './station-layout'

/** Вымышленная станция: главный путь I и путь 3 над ним, переезд у левой горловины. */
const layout: StationLayout = {
  version: 1,
  nodes: [
    { id: 'a', col: 2, row: 1, kind: 'end', end: 'open' },
    { id: 's', col: 6, row: 1, kind: 'switch' },
    { id: 'b', col: 30, row: 1, kind: 'end', end: 'open' },
    { id: 'c', col: 8, row: 0, kind: 'bend' },
    { id: 'd', col: 24, row: 0, kind: 'end', end: 'stop' },
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
      id: 't3',
      number: '3',
      kind: 'station',
      state: 'normal',
      nodes: ['s', 'c', 'd'],
      fullLength: 400,
      capacity: null,
    },
  ],
  switches: [{ id: 'w1', number: '1', node: 's', track: 't1', branch: 't3' }],
  derailers: [],
  bridges: [],
  crossings: [{ id: 'x', label: 'переезд 20км', km: 20, pk: 3, col: 4, fromRow: 0, toRow: 1 }],
}
const value = <T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message)
  return r.value
}
const message = (r: { ok: boolean; error?: { message: string } }) =>
  r.ok ? null : r.error?.message

describe('Здания, платформы и переезды на схеме', () => {
  it('ставит новое здание под схемой у левого края путей и даёт ему свободный id', () => {
    const one = value(addObject(layout, 'building'))
    expect(one.objects).toEqual([
      { id: 'building-1', kind: 'building', label: '', col: 2, row: 2, width: 6, height: 1 },
    ])
    const two = value(addObject(one, 'platform'))
    expect(two.objects?.[1]).toMatchObject({ id: 'platform-1', row: 3, width: 16 })
    expect(layout.objects).toBeUndefined()
  })

  it('переносит объект в клетку сетки и не выпускает его за сетку', () => {
    const added = value(addObject(layout, 'building'))
    expect(value(moveObject(added, 'building-1', { col: 10, row: 0 })).objects?.[0]).toMatchObject({
      col: 10,
      row: 0,
    })
    expect(value(moveObject(added, 'building-1', { col: 2, row: 2 }))).toBe(added)
    expect(message(moveObject(added, 'building-1', { col: -1, row: 0 }))).toContain('сетки')
    expect(message(moveObject(added, 'нет', { col: 1, row: 0 }))).toBe('Объект не найден.')
  })

  it('меняет вид, подпись и размеры объекта в пределах', () => {
    const added = value(addObject(layout, 'building'))
    const edited = value(
      editObject(added, 'building-1', {
        kind: 'platform',
        label: ' Вокзал ',
        width: 10,
        height: 2,
      }),
    )
    expect(edited.objects?.[0]).toMatchObject({ kind: 'platform', label: 'Вокзал', width: 10 })
    expect(value(editObject(edited, 'building-1', { label: 'Вокзал' }))).toBe(edited)
    expect(message(editObject(added, 'building-1', { width: 0 }))).toContain('ширина')
    expect(message(editObject(added, 'building-1', { height: 1.5 }))).toContain('высота')
    expect(message(editObject(added, 'building-1', { label: 'я'.repeat(201) }))).toContain(
      'длиннее',
    )
    expect(value(removeObject(edited, 'building-1')).objects).toEqual([])
    expect(message(removeObject(layout, 'building-1'))).toBe('Объект не найден.')
  })

  it('добавляет переезд посередине через все ряды путей, обходя занятую колонку', () => {
    const one = value(addCrossing(layout))
    expect(one.crossings[1]).toEqual({
      id: 'crossing-1',
      label: 'переезд',
      km: null,
      pk: null,
      col: 16,
      fromRow: 0,
      toRow: 1,
    })
    expect(value(addCrossing(one)).crossings[2]).toMatchObject({ id: 'crossing-2', col: 17 })
  })

  it('сдвигает ось переезда, правит подпись, км и пикет, удаляет', () => {
    expect(value(moveCrossing(layout, 'x', 9)).crossings[0]?.col).toBe(9)
    expect(value(moveCrossing(layout, 'x', 4))).toBe(layout)
    expect(message(moveCrossing(layout, 'x', -2))).toContain('сетки')
    const edited = value(editCrossing(layout, 'x', { label: 'переезд 21км', km: 21, pk: null }))
    expect(edited.crossings[0]).toMatchObject({ label: 'переезд 21км', km: 21, pk: null })
    expect(value(editCrossing(layout, 'x', { km: 20 }))).toBe(layout)
    expect(message(editCrossing(layout, 'x', { label: '  ' }))).toBe('У переезда нет подписи.')
    expect(message(editCrossing(layout, 'x', { pk: 11 }))).toContain('пикет')
    expect(message(editCrossing(layout, 'x', { km: Number.NaN }))).toContain('километр')
    expect(message(editCrossing(layout, 'x', { fromRow: 2 }))).toContain('неверная ось')
    expect(value(removeCrossing(layout, 'x')).crossings).toEqual([])
    expect(message(removeCrossing(layout, 'нет'))).toBe('Переезд не найден.')
  })

  it('находит объект вне пределов', () => {
    expect(
      objectProblems({
        ...layout,
        objects: [{ id: 'o', kind: 'building', label: '', col: 0, row: 0, width: 500, height: 1 }],
      }),
    ).toEqual(['Здание: ширина — от 1 до 400 колонок, высота — от 1 до 20 рядов.'])
  })
})
