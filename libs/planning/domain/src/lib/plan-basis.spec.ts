import { planBasis, type PlanBasisInput } from './plan-basis'
import { describePlanError } from './plan-error'
import { samplePlanBasis } from './testing/sample-basis'

const sample = samplePlanBasis()

function input(): PlanBasisInput {
  return {
    edition: sample.edition,
    lines: [...sample.lines.values()],
    stations: [...sample.stations.values()],
    pds: [...sample.pds.values()],
    workKinds: [...sample.workKinds.values()],
  }
}

function message(patch: Partial<PlanBasisInput>): string | undefined {
  const r = planBasis({ ...input(), ...patch })
  return r.ok ? undefined : describePlanError(r.error)
}

describe('PlanBasis', () => {
  it('владеет неизменяемым срезом перенесённой раскладки станции', () => {
    const layout = {
      tracks: [
        {
          id: 't',
          number: '1',
          purpose: '',
          label: '',
          row: 0,
          x1: 0,
          x2: 20,
          fullMeters: null,
          usefulMeters: null,
          capacity: '',
          left: { switchNumber: '', parent: null },
          right: { switchNumber: '', parent: null },
        },
      ],
      objects: [{ id: 'o', type: 'здание', text: '', x: 2, y: null, width: null, height: null }],
    }
    const r = planBasis({
      ...input(),
      stations: input().stations.map((s) => ({ ...s, legacyLayout: layout })),
    })
    if (!r.ok) throw new Error('не собран срез')
    layout.tracks[0]!.left.switchNumber = '99'
    layout.objects[0]!.x = 99
    const saved = r.value.stations.get('S1')!.legacyLayout!
    expect(saved.tracks[0]!.left.switchNumber).toBe('')
    expect(saved.objects[0]!.x).toBe(2)
    expect(Object.isFrozen(saved.tracks[0]!.left)).toBe(true)
    expect(Object.isFrozen(saved.objects)).toBe(true)
  })

  it('вымышленный срез собирается', () => {
    expect(planBasis(input()).ok).toBe(true)
  })

  it('идентификаторы уникальны', () => {
    expect(message({ stations: [...input().stations, ...input().stations] })).toBe(
      'Станция «S1» встречается в редакции дважды',
    )
    expect(message({ pds: [...input().pds, ...input().pds] })).toBe(
      'ПД «ПД-1» встречается в редакции дважды',
    )
  })

  it('протяжение лежит на своём направлении', () => {
    const [line] = input().lines
    if (!line) throw new Error('нет направления')
    expect(planBasis({ ...input(), lines: [{ ...line, id: 'L2' }] }).ok).toBe(false)
  })

  it('«входит в» ссылается на существующий вид', () => {
    const kinds = input().workKinds.filter((k) => k.code !== 'ППР')
    expect(message({ workKinds: kinds })).toBe('Вид работ «ППРК» входит в неизвестный вид «ППР»')
  })

  it('вид работ не может входить сам в себя', () => {
    const kinds = input().workKinds.map((k) => ({ ...k, includedIn: k.code }))
    expect(message({ workKinds: kinds })).toBe('Вид работ «ППР» не может входить сам в себя')
  })

  it('«входит в» складывает только одинаковые единицы', () => {
    const kinds = input().workKinds.map((k) => (k.code === 'КСП' ? { ...k, includedIn: 'ППР' } : k))
    expect(message({ workKinds: kinds })).toBe(
      'Вид работ «КСП» (компл) не может входить в «ППР» (км): единицы различаются',
    )
    const spaced = input().workKinds.map((k) =>
      k.code === 'ППРК' ? { ...k, unit: ` ${k.unit} ` } : k,
    )
    expect(planBasis({ ...input(), workKinds: spaced }).ok).toBe(true)
  })

  it('отклоняет пересекающиеся и повторяющиеся границы одного ПД', () => {
    const [pd] = input().pds
    const segment = pd?.segments[0]
    if (!pd || !segment) throw new Error('нет границы')
    for (const extra of [segment, { ...segment, from: { ...segment.from, m: 500 } }]) {
      expect(message({ pds: [{ ...pd, segments: [segment, extra] }] })).toBe(
        'Границы внутри ПД-1 перекрываются',
      )
    }
  })

  it('принимает смежные границы одного ПД', () => {
    const [pd] = input().pds
    const segment = pd?.segments[0]
    if (!pd || !segment) throw new Error('нет границы')
    const middle = { ...segment.from, m: 500 }
    expect(
      message({
        stations: [],
        pds: [
          {
            ...pd,
            segments: [
              { ...segment, to: middle },
              { ...segment, from: middle },
            ],
          },
        ],
      }),
    ).toBeUndefined()
  })

  it('границы ПД — на известных направлениях и не перекрываются', () => {
    const [pd1, pd2] = input().pds
    if (!pd1 || !pd2) throw new Error('нет ПД')
    const [segment] = pd1.segments
    if (!segment) throw new Error('нет границы')
    expect(message({ pds: [{ ...pd1, segments: [{ ...segment, line: 'L9' }] }] })).toBe(
      'Граница ПД-1 лежит на неизвестном направлении «L9»',
    )
    expect(message({ pds: [pd1, { ...pd2, segments: [...pd2.segments, segment] }] })).toBe(
      'Границы ПД-1 и ПД-2 перекрываются',
    )
  })

  it('станция отнесена к существующему ПД', () => {
    const stations = input().stations.map((s) => ({ ...s, pd: 'ПД-9' }))
    expect(message({ stations })).toBe('Станция «S1» отнесена к неизвестному ПД «ПД-9»')
  })
})
