import {
  describePlaceSpecError,
  sequentialIds,
  type IdGenerator,
  type Result,
} from '@eow/shared/kernel'
import {
  createAnnualPlan,
  describePlanError,
  planRows,
  samplePlanBasis,
  workVolume,
  type AnnualPlan,
  type WorkId,
} from '@eow/planning/domain'
import {
  addWorkToPlan,
  canRedoPlan,
  canUndoPlan,
  editWork,
  finishEditing,
  openPlanSession,
  redoPlan,
  removeWorkFromPlan,
  setPlanValue,
  undoPlan,
  type PlanSession,
  type WorkCommand,
  type WorkCommandError,
} from './plan-session'

const basis = samplePlanBasis()

function value<T>(r: Result<T, WorkCommandError>): T {
  if (r.ok) return r.value
  const e = r.error
  const text =
    e.kind === 'place' ? e.errors.map(describePlaceSpecError) : e.errors.map(describePlanError)
  throw new Error(text.join('\n'))
}

function failure<T>(r: Result<T, WorkCommandError>): WorkCommandError {
  if (r.ok) throw new Error('ожидалась ошибка')
  return r.error
}

function pprk(text: string, note = ''): WorkCommand {
  return {
    kind: 'ППРК',
    place: { kind: 'line', line: 'L1', text },
    volume: undefined,
    note,
    callout: true,
  }
}

function newSession(): PlanSession {
  const plan = createAnnualPlan(2027, basis)
  if (!plan.ok) throw new Error('план не создан')
  return openPlanSession(plan.value)
}

function add(
  session: PlanSession,
  command: WorkCommand,
  ids: IdGenerator,
): { session: PlanSession; id: WorkId } {
  return value(addWorkToPlan(session, command, ids))
}

function places(plan: AnnualPlan): string[] {
  return plan.works.map((w) => `${workVolume(w, basis).amount} ${w.note}`.trim())
}

describe('Сценарий: добавить работу', () => {
  it('разбирает место, выдаёт идентификатор и считает объём', () => {
    const { session, id } = add(newSession(), pprk('12 км пк 1 – 13 км пк 5'), sequentialIds('w'))
    expect(id).toBe('w-1')
    expect(places(session.present)).toEqual(['1.5'])
    expect(canUndoPlan(session)).toBe(true)
  })

  it('ошибка в тексте места возвращается с позицией и не меняет план', () => {
    const before = newSession()
    const e = failure(addWorkToPlan(before, pprk('12 км; 13 км пк 11'), sequentialIds('w')))
    const texts = e.kind === 'place' ? e.errors.map(describePlaceSpecError) : []
    expect(texts).toEqual(['Позиция 8, «13 км пк 11»: Пикет 11 вне 1–10 (13 км)'])
    expect(before.present.works).toEqual([])
  })

  it('нарушение правил плана — ошибка плана', () => {
    const e = failure(addWorkToPlan(newSession(), pprk('61 км'), sequentialIds('w')))
    expect(e).toMatchObject({ kind: 'plan', errors: [{ kind: 'outside-line' }] })
  })

  it('неизвестное направление в команде', () => {
    const command: WorkCommand = {
      ...pprk('12 км'),
      place: { kind: 'line', line: 'L9', text: '12 км' },
    }
    const e = failure(addWorkToPlan(newSession(), command, sequentialIds('w')))
    expect(e).toMatchObject({ kind: 'plan', errors: [{ kind: 'unknown-line' }] })
  })

  it('станционная работа со стрелкой', () => {
    const command: WorkCommand = {
      kind: 'КСП',
      place: { kind: 'station', station: 'S1', object: { kind: 'switch', number: '5' } },
      volume: 1,
      note: '',
      callout: false,
    }
    const { session } = add(newSession(), command, sequentialIds('w'))
    expect(session.present.works[0]?.place).toEqual(command.place)
  })
})

describe('Сценарий: отмена и повтор', () => {
  it('добавление, изменение и удаление отменяются по шагу и повторяются', () => {
    const ids = sequentialIds('w')
    const first = add(newSession(), pprk('12 км'), ids)
    const id = first.id
    let session = first.session
    session = add(session, pprk('14 км'), ids).session
    session = value(editWork(session, id, pprk('12 км пк 1 – 12 км пк 5')))
    session = value(removeWorkFromPlan(session, id))
    expect(places(session.present)).toEqual(['1'])

    session = undoPlan(session)
    expect(places(session.present)).toEqual(['0.5', '1'])
    session = undoPlan(session)
    expect(places(session.present)).toEqual(['1', '1'])
    session = undoPlan(undoPlan(session))
    expect(session.present.works).toEqual([])
    expect(canUndoPlan(session)).toBe(false)

    session = redoPlan(redoPlan(redoPlan(redoPlan(session))))
    expect(places(session.present)).toEqual(['1'])
    expect(canRedoPlan(session)).toBe(false)
  })

  it('набор примечания по буквам — один шаг отмены', () => {
    const first = add(newSession(), pprk('12 км'), sequentialIds('w'))
    const id = first.id
    let session = first.session
    for (const note of ['п', 'по', 'по г', 'по графику']) {
      session = value(editWork(session, id, pprk('12 км', note), { group: `note:${id}` }))
    }
    session = finishEditing(session)
    expect(places(session.present)).toEqual(['1 по графику'])
    expect(places(undoPlan(session).present)).toEqual(['1'])
  })

  it('после завершения правки следующая правка того же поля — новый шаг', () => {
    const first = add(newSession(), pprk('12 км'), sequentialIds('w'))
    const id = first.id
    let session = first.session
    session = value(editWork(session, id, pprk('12 км', 'а'), { group: 'note' }))
    session = finishEditing(session)
    session = value(editWork(session, id, pprk('12 км', 'аб'), { group: 'note' }))
    expect(places(undoPlan(session).present)).toEqual(['1 а'])
  })

  it('добавление работы не сливается с открытой группой правок', () => {
    const ids = sequentialIds('w')
    const first = add(newSession(), pprk('12 км'), ids)
    const id = first.id
    let session = first.session
    session = value(editWork(session, id, pprk('12 км', 'а'), { group: 'note' }))
    session = add(session, pprk('14 км'), ids).session
    expect(places(undoPlan(session).present)).toEqual(['1 а'])
  })

  it('неудачная команда не добавляет шаг и не сбрасывает повтор', () => {
    const ids = sequentialIds('w')
    let { session } = add(newSession(), pprk('12 км'), ids)
    session = undoPlan(session)
    expect(addWorkToPlan(session, pprk('61 км'), ids).ok).toBe(false)
    expect(canRedoPlan(session)).toBe(true)
  })
})

describe('Сценарий: ручное значение в таблице', () => {
  const pd1 = { kind: 'pd', pd: 'ПД-1' } as const

  it('ввод в ячейку по цифрам — один шаг; значение помечено и отменяется', () => {
    const first = add(newSession(), pprk('12 км'), sequentialIds('w'))
    let session = first.session
    for (const v of [1, 12, 12.5]) {
      session = value(setPlanValue(session, pd1, 'overrides', 'ППР', v, { group: 'cell:ПД-1:ППР' }))
    }
    session = finishEditing(session)
    expect(planRows(session.present, pd1, 'current')[0]).toMatchObject({
      computed: 1,
      value: 12.5,
      manual: true,
    })
    session = undoPlan(session)
    expect(planRows(session.present, pd1, 'current')[0]).toMatchObject({ value: 1, manual: false })
  })

  it('ошибка ручного значения не меняет план', () => {
    const e = failure(setPlanValue(newSession(), pd1, 'needs', 'ППР', -3))
    expect(e).toMatchObject({ kind: 'plan', errors: [{ kind: 'invalid-manual-value' }] })
  })
})
