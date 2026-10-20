import { parsePlaceSpec, type PlaceSpec, type Result } from '@eow/shared/kernel'
import {
  addWork,
  createAnnualPlan,
  MIN_PLAN_YEAR,
  findWork,
  removeWork,
  setApproval,
  updateWork,
  type AnnualPlan,
} from './annual-plan'
import { planBasis, type PlanBasis } from './plan-basis'
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
      ['invalid-approval-year'],
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
    expect(errorKinds(r)).toEqual(['unknown-work-kind', 'outside-line', 'invalid-volume'])
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

function splitExtentBasis(): PlanBasis {
  // Протяжение L1 задано двумя смежными кусками: 10–15 и 15–25 км.
  const line = basis.lines.get('L1')
  const [first] = line?.extent ?? []
  if (!line || !first) throw new Error('нет направления')
  const r = planBasis({
    edition: basis.edition,
    lines: [
      {
        ...line,
        extent: [
          { ...first, to: { km: 15, m: 0 } },
          { ...first, from: { km: 15, m: 0 } },
        ],
      },
    ],
    stations: [...basis.stations.values()],
    pds: [...basis.pds.values()],
    workKinds: [...basis.workKinds.values()],
  })
  if (!r.ok) throw new Error(describePlanError(r.error))
  return r.value
}

describe('AnnualPlan: правки по ревью', () => {
  it('минимальный год плана создаётся с грифом по умолчанию', () => {
    expect(value(createAnnualPlan(MIN_PLAN_YEAR, basis)).approval.year).toBe(MIN_PLAN_YEAR - 1)
    expect(
      errorKinds(createAnnualPlan(2027, basis, { title: '', name: '', year: MIN_PLAN_YEAR - 2 })),
    ).toEqual(['invalid-approval-year'])
  })

  it('участок на стыке смежных кусков протяжения лежит на направлении', () => {
    const plan = value(createAnnualPlan(2027, splitExtentBasis()))
    expect(addWork(plan, w1, onLine('14 км пк 6 – 15 км пк 5')).ok).toBe(true)
  })

  it('при неизвестном виде работ объём всё равно проверяется', () => {
    expect(
      errorKinds(addWork(emptyPlan(), w1, onLine('12 км', { kind: 'НЕТ', volume: -2 }))),
    ).toEqual(['unknown-work-kind', 'invalid-volume'])
  })

  it('изменение объекта команды после добавления не меняет работу в плане', () => {
    const place = {
      kind: 'station' as const,
      station: 'S1',
      object: { kind: 'track' as const, number: '1' },
    }
    const input: WorkInput = { ...onLine('12 км', { kind: 'КСП', volume: 1 }), place }
    const plan = value(addWork(emptyPlan(), w1, input))
    place.object.number = '7'
    expect(findWork(plan, w1)?.place).toEqual({
      kind: 'station',
      station: 'S1',
      object: { kind: 'track', number: '1' },
    })
    expect(Object.isFrozen(findWork(plan, w1)?.place)).toBe(true)
  })

  it('правка без изменений возвращает ту же версию плана', () => {
    const plan = value(addWork(emptyPlan(), w1, onLine('12 км пк 1 – 12 км пк 5', { note: 'а' })))
    expect(value(updateWork(plan, w1, onLine('12 км пк 1–5', { note: 'а' })))).toBe(plan)
    expect(value(updateWork(plan, w1, onLine('12 км пк 1–6', { note: 'а' })))).not.toBe(plan)
    expect(value(setApproval(plan, plan.approval))).toBe(plan)
  })
})
