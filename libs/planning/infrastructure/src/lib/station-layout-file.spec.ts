import { createHash } from 'node:crypto'
import { createAnnualPlan, sampleStationLayout, samplePlanBasis } from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { decodePlan, encodePlan, readPlanFile } from './plan-file'
import { planFileV8Schema, snapshotSchema } from './plan-file-schema'
import { v1Fixture } from './testing/v1-fixture'
import { v5Fixture } from './testing/v5-fixture'
import { v8Fixture } from './testing/v8-fixture'

const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
const sampleText = () =>
  value(encodePlan(value(createAnnualPlan(2027, samplePlanBasis())), '0.6.0'))

describe('Раскладка станции в срезе плана и формат v9', () => {
  it.each([v1Fixture, v5Fixture, v8Fixture])(
    'открывает прежний формат: станции без раскладки, срез и контрольная сумма прежние',
    (old) => {
      const original = JSON.stringify(old),
        file = value(readPlanFile(original))
      expect(file.format.version).toBe(9)
      expect(file.edition).toEqual(old.edition)
      const plan = value(decodePlan(original))
      expect([...plan.basis.stations.values()].every((s) => s.layout === undefined)).toBe(true)
      expect(value(decodePlan(value(encodePlan(plan, '0.6.0'))))).toEqual(plan)
      expect(JSON.stringify(old)).toBe(original)
    },
  )

  it('сохраняет раскладку без потерь и замораживает её в срезе', () => {
    const text = sampleText(),
      plan = value(decodePlan(text)),
      layout = plan.basis.stations.get('S1')!.layout!
    expect(layout).toEqual(sampleStationLayout())
    expect(Object.isFrozen(layout.tracks[0]!.nodes)).toBe(true)
    expect(Object.isFrozen(layout.crossings[0])).toBe(true)
    expect(value(decodePlan(value(encodePlan(plan, '0.6.0'))))).toEqual(plan)
    expect(planFileV8Schema.safeParse(JSON.parse(text)).success).toBe(false)
  })

  it.each(['node', 'track', 'cell', 'unknown'] as const)(
    'отклоняет повреждённую раскладку (%s)',
    (problem) => {
      const file = JSON.parse(sampleText())
      const layout = file.edition.snapshot.stations[0].layout
      if (problem === 'node') layout.tracks[0].nodes.push('нет')
      if (problem === 'track') layout.derailers[0].track = 'нет'
      if (problem === 'cell') layout.nodes[0].col = -1
      if (problem === 'unknown') layout.extra = true
      // Пересчёт контрольной суммы: ошибка должна прийти от проверки раскладки, а не от суммы.
      const parsed = snapshotSchema.safeParse(file.edition.snapshot)
      if (parsed.success)
        file.edition.checksum = createHash('sha256')
          .update(JSON.stringify(parsed.data))
          .digest('hex')
      expect(decodePlan(JSON.stringify(file))).toMatchObject({
        ok: false,
        error: { kind: 'invalid-file' },
      })
    },
  )
})
