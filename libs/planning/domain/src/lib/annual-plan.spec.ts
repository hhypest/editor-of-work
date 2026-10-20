import { parsePlaceSpec, type PlaceSpec, type Result } from '@eow/shared/kernel'
import {
  addWork,
  createAnnualPlan,
  findWork,
  removeWork,
  setApproval,
  updateWork,
  type AnnualPlan,
} from './annual-plan'
import type { PlanBasis } from './plan-basis'
import { describePlanError, type PlanError } from './plan-error'
import { workId, workVolume, type WorkInput } from './planned-work'
import { samplePlanBasis } from './testing/sample-basis'

const basis = samplePlanBasis()

function value<T>(r: Result<T, readonly PlanError[]>): T {
  if (!r.ok) throw new Error(r.error.map(describePlanError).join('\n'))
  return r.value
}

function errorKinds<T>(r: Result<T, readonly PlanError[]>): string[] {
  if (r.ok) throw new Error('ожидалась ошибка')
  return r.error.map((e) => e.kind)
}

function messages<T>(r: Result<T, readonly PlanError[]>): string[] {
  if (r.ok) throw new Error('ожидалась ошибка')
  return r.error.map(describePlanError)
}

function spec(text: string, line = 'L1', b: PlanBasis = basis): PlaceSpec {
  const l = b.lines.get(line)
  if (!l) throw new Error(`нет направления ${line}`)
  const r = parsePlaceSpec(text, line, l.kmLengths)
  if (!r.ok) throw new Error(`не разобрано «${text}»`)
  return r.value
}

function onLine(text: string, extra: Partial<WorkInput> = {}): WorkInput {
  return {
    kind: 'ППР',
    place: { kind: 'line', spec: spec(text) },
    volume: undefined,
    note: '',
    callout: true,
    ...extra,
  }
}

function emptyPlan(): AnnualPlan {
  return value(createAnnualPlan(2027, basis))
}

const w1 = workId('w-1')
const w2 = workId('w-2')

describe('AnnualPlan: создание и гриф', () => {
  it('новый план пуст, гриф по умолчанию утверждается годом раньше', () => {
    const plan = emptyPlan()
    expect(plan.works).toEqual([])
    expect(plan.approval).toEqual({ title: '', name: '', year: 2026 })
  })

  it('год плана и год утверждения — целые числа в разумных пределах', () => {
    expect(errorKinds(createAnnualPlan(27, basis))).toContain('invalid-year')
    expect(errorKinds(createAnnualPlan(2027.5, basis))).toContain('invalid-year')
    expect(errorKinds(setApproval(emptyPlan(), { title: 'Начальник', name: '', year: 0 }))).toEqual(
      ['invalid-year'],
    )
    expect(
      value(setApproval(emptyPlan(), { title: 'Начальник', name: '', year: 2026 })).approval.title,
    ).toBe('Начальник')
  })
})

describe('AnnualPlan: инварианты работы', () => {
  it('вид работ должен быть в редакции плана', () => {
    const r = addWork(emptyPlan(), w1, onLine('12 км', { kind: 'НЕТ' }))
    expect(messages(r)).toEqual(['Вида работ «НЕТ» нет в редакции паспорта плана'])
  })

  it('участки лежат на протяжении направления, разрыв протяжения — вне его', () => {
    expect(addWork(emptyPlan(), w1, onLine('24 км пк 5 – 24 км пк 10')).ok).toBe(true)
    const r = addWork(emptyPlan(), w1, onLine('24 км пк 5 – 30 км пк 2; 61 км'))
    expect(messages(r)).toEqual([
      '24 км пк 5 – 30 км пк 2 — вне протяжения направления «Северная — Южная, 1» в дистанции',
      '61 км — вне протяжения направления «Северная — Южная, 1» в дистанции',
    ])
  })

  it('точка на конце протяжения уже вне его', () => {
    expect(addWork(emptyPlan(), w1, onLine('60+499', { volume: 1 })).ok).toBe(true)
    expect(errorKinds(addWork(emptyPlan(), w1, onLine('60+500', { volume: 1 })))).toEqual([
      'outside-line',
    ])
  })

  it('место должно быть указано', () => {
    expect(errorKinds(addWork(emptyPlan(), w1, onLine('')))).toEqual(['empty-place'])
  })

  it('неизвестное направление, станция, путь и стрелка', () => {
    const elsewhere = { kind: 'line', spec: { line: 'L9', items: spec('12 км').items } } as const
    expect(errorKinds(addWork(emptyPlan(), w1, { ...onLine('12 км'), place: elsewhere }))).toEqual([
      'unknown-line',
    ])
    const station = (object?: WorkInput['place']): WorkInput => ({
      ...onLine('12 км', { kind: 'КСП', volume: 1 }),
      place: object ?? { kind: 'station', station: 'S9' },
    })
    expect(errorKinds(addWork(emptyPlan(), w1, station()))).toEqual(['unknown-station'])
    expect(
      messages(
        addWork(
          emptyPlan(),
          w1,
          station({ kind: 'station', station: 'S1', object: { kind: 'track', number: '7' } }),
        ),
      ),
    ).toEqual(['На станции «Озёрная» нет пути № 7'])
    expect(
      messages(
        addWork(
          emptyPlan(),
          w1,
          station({ kind: 'station', station: 'S1', object: { kind: 'switch', number: '2' } }),
        ),
      ),
    ).toEqual(['На станции «Озёрная» нет стрелочного перевода № 2'])
    expect(
      addWork(
        emptyPlan(),
        w1,
        station({ kind: 'station', station: 'S1', object: { kind: 'switch', number: '3' } }),
      ).ok,
    ).toBe(true)
  })

  it('объём неотрицателен и конечен', () => {
    expect(errorKinds(addWork(emptyPlan(), w1, onLine('12 км', { volume: -1 })))).toEqual([
      'invalid-volume',
    ])
    expect(errorKinds(addWork(emptyPlan(), w1, onLine('12 км', { volume: Number.NaN })))).toEqual([
      'invalid-volume',
    ])
    expect(addWork(emptyPlan(), w1, onLine('12 км', { volume: 0 })).ok).toBe(true)
  })

  it('объём в «компл» и станционный объём в «км» нужно ввести', () => {
    expect(messages(addWork(emptyPlan(), w1, onLine('12 км', { kind: 'КСП' })))).toEqual([
      'Укажите объём: для вида «КСП» в единицах «компл» он не считается по участкам',
    ])
    const atStation: WorkInput = { ...onLine('12 км'), place: { kind: 'station', station: 'S1' } }
    expect(errorKinds(addWork(emptyPlan(), w1, atStation))).toEqual(['volume-required'])
  })

  it('собирает все нарушения сразу', () => {
    const r = addWork(emptyPlan(), w1, onLine('61 км', { kind: 'НЕТ', volume: -2 }))
    expect(errorKinds(r)).toEqual(['unknown-work-kind', 'outside-line'])
  })
})

describe('AnnualPlan: объём', () => {
  it('объём в км по умолчанию — сумма длин участков с учётом нестандартных км', () => {
    const plan = value(addWork(emptyPlan(), w1, onLine('19 км пк 6 – 21 км пк 2; 40 км')))
    const work = findWork(plan, w1)
    if (!work) throw new Error('нет работы')
    // 19+500 → 21+200: 500 + 964 + 200 = 1664 м; плюс 40 км — 1000 м
    expect(workVolume(work, basis)).toEqual({ amount: 2.664, unit: 'км' })
  })

  it('введённый объём важнее длины участков', () => {
    const plan = value(addWork(emptyPlan(), w1, onLine('40 км', { volume: 0.5 })))
    const work = findWork(plan, w1)
    if (!work) throw new Error('нет работы')
    expect(workVolume(work, basis)).toEqual({ amount: 0.5, unit: 'км' })
  })
})

function twoWorks(): AnnualPlan {
  return value(addWork(value(addWork(emptyPlan(), w1, onLine('12 км'))), w2, onLine('13 км')))
}

describe('AnnualPlan: изменение и удаление', () => {
  it('идентификатор работы уникален', () => {
    expect(errorKinds(addWork(twoWorks(), w1, onLine('14 км')))).toEqual(['duplicate-work'])
  })

  it('изменение сохраняет порядок и не трогает другие работы', () => {
    const before = twoWorks()
    const after = value(updateWork(before, w1, onLine('15 км', { note: 'по графику' })))
    expect(after.works.map((w) => w.id)).toEqual([w1, w2])
    expect(after.works[0]?.note).toBe('по графику')
    expect(after.works[1]).toBe(before.works[1])
    expect(before.works[0]?.note).toBe('')
  })

  it('изменение проверяет те же инварианты', () => {
    expect(errorKinds(updateWork(twoWorks(), w1, onLine('61 км')))).toEqual(['outside-line'])
    expect(errorKinds(updateWork(twoWorks(), workId('нет'), onLine('12 км')))).toEqual([
      'work-not-found',
    ])
  })

  it('удаление', () => {
    expect(value(removeWork(twoWorks(), w1)).works.map((w) => w.id)).toEqual([w2])
    expect(errorKinds(removeWork(twoWorks(), workId('нет')))).toEqual(['work-not-found'])
  })
})
