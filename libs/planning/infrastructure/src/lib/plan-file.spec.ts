import { createHash } from 'node:crypto'
import {
  addWork,
  createAnnualPlan,
  planRows,
  samplePlanBasis,
  setManualValue,
  workId,
  type AnnualPlan,
} from '@eow/planning/domain'
import { parsePlaceSpec, type Result } from '@eow/shared/kernel'
import { decodePlan, encodePlan, readPlanFile, restorePlan } from './plan-file'
import { snapshotSchema, type PlanFile } from './plan-file-schema'
import { v1Fixture } from './testing/v1-fixture'
import { v2Fixture } from './testing/v2-fixture'

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

export function sampleDocument(): AnnualPlan {
  const basis = samplePlanBasis()
  const lengths = basis.lines.get('L1')!.kmLengths
  const place = value(parsePlaceSpec('19 км — 21 км', 'L1', lengths))
  let plan = value(createAnnualPlan(2027, basis))
  plan = value(
    addWork(plan, workId('line'), {
      kind: 'ППРК',
      place: { kind: 'line', spec: place },
      volume: undefined,
      note: 'Вымышленная работа',
      callout: true,
    }),
  )
  plan = value(
    addWork(plan, workId('station'), {
      kind: 'КСП',
      place: { kind: 'station', station: 'S1', object: { kind: 'switch', number: '3' } },
      volume: 2,
      note: '',
      callout: false,
    }),
  )
  plan = value(setManualValue(plan, { kind: 'pd', pd: 'ПД-2' }, 'overrides', 'ППР', 17))
  return value(setManualValue(plan, { kind: 'station', station: 'S1' }, 'needs', 'КСП', 0))
}

function file(): PlanFile {
  return value(readPlanFile(value(encodePlan(sampleDocument(), '0.1.0'))))
}
function rehash(f: PlanFile): void {
  f.edition.checksum = createHash('sha256')
    .update(JSON.stringify(snapshotSchema.parse(f.edition.snapshot)))
    .digest('hex')
}

describe('формат плана v1', () => {
  it('мигрирует v1/v2 в текущий формат и сохраняет закреплённый образец v2 со снимком и принадлежностью к станции', () => {
    const migrated = value(readPlanFile(JSON.stringify(v1Fixture)))
    expect(migrated.format.version).toBe(7)
    expect(migrated.plan.prototype).toBeNull()
    const plan = value(decodePlan(JSON.stringify(v2Fixture)))
    expect(plan.works[0]!.place).toMatchObject({ kind: 'line', station: 'S' })
    expect(planRows(plan, { kind: 'station', station: 'S' }, 'current')).toMatchObject([
      { computed: 0.964 },
    ])
    const reopened = value(decodePlan(value(encodePlan(plan, '0.2.0'))))
    expect(reopened.prototype).toEqual(v2Fixture.plan.prototype)
    expect(Object.isFrozen(reopened.prototype!.report)).toBe(true)
  })
  it('открывает закреплённый вымышленный образец первой версии', () => {
    const plan = value(decodePlan(JSON.stringify(v1Fixture)))
    expect(plan.year).toBe(2027)
    expect(plan.works).toHaveLength(1)
    expect(planRows(plan, { kind: 'pd', pd: 'D' }, 'current')).toMatchObject([
      { computed: 0.964, value: 2, manual: true, need: 0 },
    ])
  })

  it('переносит срез, порядок нормативов, работы, автоматический объём и ручные значения без потерь', () => {
    const original = sampleDocument()
    const restored = value(decodePlan(value(encodePlan(original, '0.1.0'))))
    expect(restored).toEqual(original)
    expect(restored.basis.lines.get('L1')!.kmLengths.lengthOf(20)).toBe(964)
    expect(restored.works[0]!.volume).toBeUndefined()
    expect(planRows(restored, { kind: 'pd', pd: 'ПД-2' }, 'current')).toEqual(
      planRows(original, { kind: 'pd', pd: 'ПД-2' }, 'current'),
    )
  })

  it('возвращает понятную ошибку для обрезанного файла и будущего формата', () => {
    expect(decodePlan('{')).toMatchObject({ ok: false, error: { kind: 'invalid-file' } })
    expect(decodePlan('{"format":{"version":8}}')).toMatchObject({
      ok: false,
      error: { kind: 'future-version' },
    })
    expect(decodePlan('{"format":{"version":0}}').ok).toBe(false)
  })

  it('не теряет неизвестные поля молча', () => {
    expect(decodePlan(JSON.stringify({ ...file(), unknown: true })).ok).toBe(false)
  })

  it('проверяет контрольную сумму редакции', () => {
    const changed = file()
    changed.edition.snapshot.lines[0]!.name = 'Изменено'
    expect(decodePlan(JSON.stringify(changed))).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('контрольная сумма') },
    })
  })

  it.each(['year', 'kind', 'station', 'coordinate', 'span', 'duplicate', 'manual'] as const)(
    'проверяет предметные данные из JSON: %s',
    (change) => {
      const f = file()
      const work = f.plan.works[0]!
      switch (change) {
        case 'year':
          f.plan.year = 1999
          break
        case 'kind':
          work.kind = 'нет'
          break
        case 'station':
          work.place = { kind: 'station', station: 'нет' }
          break
        case 'coordinate':
          work.place = {
            kind: 'line',
            spec: { line: 'L1', items: [{ kind: 'point', line: 'L1', at: { km: 20, m: 980 } }] },
          }
          break
        case 'span':
          work.place = {
            kind: 'line',
            spec: {
              line: 'L1',
              items: [{ kind: 'span', line: 'L1', from: { km: 21, m: 0 }, to: { km: 20, m: 0 } }],
            },
          }
          break
        case 'duplicate':
          f.plan.works.push(work)
          break
        case 'manual':
          f.plan.manual[0]!.overrides.push(['нет', 12])
          break
      }
      expect(decodePlan(JSON.stringify(f)).ok).toBe(false)
    },
  )

  it('повторно проверяет границы и правила нормативов из файла', () => {
    const f = file()
    f.edition.snapshot.pds[0]!.segments.push(f.edition.snapshot.pds[0]!.segments[0]!)
    rehash(f)
    expect(decodePlan(JSON.stringify(f)).ok).toBe(false)
    const norms = file()
    norms.edition.snapshot.workKinds[0]!.includedIn = 'ППР'
    rehash(norms)
    expect(restorePlan(norms).ok).toBe(false)
  })

  it('отклоняет повтор ручного значения вместо потери данных при построении Map', () => {
    const f = file()
    f.plan.manual[0]!.overrides.push(['ППР', 25])
    expect(decodePlan(JSON.stringify(f)).ok).toBe(false)
  })
})
