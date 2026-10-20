import { parsePlaceSpec } from '@eow/shared/kernel'
import { addWork, createAnnualPlan, updateWork } from './annual-plan'
import { shareIn } from './distribution'
import { samplePlanBasis } from './testing/sample-basis'
import { workId } from './planned-work'

describe('линейная работа, отнесённая к станции', () => {
  const basis = samplePlanBasis()
  const parsed = parsePlaceSpec('18 км — 19 км', 'L1', basis.lines.get('L1')!.kmLengths)
  if (!parsed.ok) throw new Error('нет места')
  const input = {
    kind: 'ППР',
    place: { kind: 'line', spec: parsed.value, station: 'S1' } as const,
    volume: undefined,
    note: '',
    callout: true,
  }
  const empty = createAnnualPlan(2027, basis)
  if (!empty.ok) throw new Error('нет плана')

  it('считает долю в ПД по участку и включает ту же работу в станционную таблицу', () => {
    const added = addWork(empty.value, workId('test'), input)
    if (!added.ok) throw new Error('нет работы')
    const work = added.value.works[0]!
    expect(shareIn(work, { kind: 'pd', pd: 'ПД-2' }, basis)).toBe(1)
    expect(shareIn(work, { kind: 'station', station: 'S1' }, basis)).toBe(1)
    expect(shareIn(work, { kind: 'station', station: 'other' }, basis)).toBe(0)
  })

  it('проверяет станцию и объект и замечает изменение привязки', () => {
    expect(
      addWork(empty.value, workId('bad'), { ...input, place: { ...input.place, station: 'нет' } })
        .ok,
    ).toBe(false)
    expect(
      addWork(empty.value, workId('bad'), {
        ...input,
        place: { kind: 'line', spec: parsed.value, object: { kind: 'track', number: '1' } },
      }).ok,
    ).toBe(false)
    const added = addWork(empty.value, workId('test'), input)
    if (!added.ok) throw new Error('нет работы')
    const changed = updateWork(added.value, workId('test'), {
      ...input,
      place: { kind: 'line', spec: parsed.value },
    })
    expect(changed.ok && changed.value).not.toBe(added.value)
  })
})
