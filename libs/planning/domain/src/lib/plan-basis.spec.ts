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
