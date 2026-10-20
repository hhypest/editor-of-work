import { parsePlaceSpec, type Result } from '@eow/shared/kernel'
import { addWork, createAnnualPlan, setManualValue, type AnnualPlan } from './annual-plan'
import { workShares, type PlanArea } from './distribution'
import { areaVolumes, planRows } from './plan-calculation'
import { describePlanError, type PlanError } from './plan-error'
import { workId, type PlannedWork, type WorkInput } from './planned-work'
import { samplePlanBasis } from './testing/sample-basis'

const basis = samplePlanBasis()
const lengths = basis.lines.get('L1')?.kmLengths

function value<T>(r: Result<T, readonly PlanError[]>): T {
  if (!r.ok) throw new Error(r.error.map(describePlanError).join('\n'))
  return r.value
}

function onLine(kind: string, text: string, volume?: number): WorkInput {
  if (!lengths) throw new Error('нет направления')
  const spec = parsePlaceSpec(text, 'L1', lengths)
  if (!spec.ok) throw new Error(`не разобрано «${text}»`)
  return { kind, place: { kind: 'line', spec: spec.value }, volume, note: '', callout: true }
}

const atStation: WorkInput = {
  kind: 'КСП',
  place: { kind: 'station', station: 'S1', object: { kind: 'switch', number: '3' } },
  volume: 2,
  note: '',
  callout: true,
}

function planWith(...inputs: WorkInput[]): AnnualPlan {
  let plan = value(createAnnualPlan(2027, basis))
  inputs.forEach((input, i) => {
    plan = value(addWork(plan, workId(`w-${i + 1}`), input))
  })
  return plan
}

function work(input: WorkInput): PlannedWork {
  const [w] = planWith(input).works
  if (!w) throw new Error('нет работы')
  return w
}

/** Объёмы области по кодам, для сравнения одной строкой. */
function volumes(plan: AnnualPlan, area: PlanArea): Record<string, number> {
  return Object.fromEntries(areaVolumes(plan, area))
}

const district: PlanArea = { kind: 'district' }
const pd1: PlanArea = { kind: 'pd', pd: 'ПД-1' }
const pd2: PlanArea = { kind: 'pd', pd: 'ПД-2' }
const s1: PlanArea = { kind: 'station', station: 'S1' }

describe('Распределение объёма по ПД', () => {
  it('участок через границу ПД делится по длине', () => {
    // 17+500 → 19+500: 500 м в ПД-1 и 1500 м в ПД-2
    const shares = workShares(work(onLine('ППРК', '17 км пк 6 – 19 км пк 5')), basis)
    expect(Object.fromEntries(shares.byPd)).toEqual({ 'ПД-1': 0.25, 'ПД-2': 0.75 })
    expect(shares.outside).toBe(0)
  })

  it('часть вне действующих ПД остаётся только в итоге дистанции', () => {
    // 20 км (964 м) — ПД-2, 46 км (1000 м) — вне ПД
    const shares = workShares(work(onLine('ППР', '20 км; 46 км')), basis)
    expect(shares.byPd.get('ПД-2')).toBeCloseTo(964 / 1964, 12)
    expect(shares.outside).toBeCloseTo(1000 / 1964, 12)
  })

  it('точечная работа уходит в один ПД целиком', () => {
    const shares = workShares(work(onLine('КСП', '15+300', 1)), basis)
    expect(Object.fromEntries(shares.byPd)).toEqual({ 'ПД-1': 1 })
  })

  it('несколько точек делятся между ПД поровну', () => {
    const shares = workShares(work(onLine('КСП', '15+300; 20+100', 2)), basis)
    expect(Object.fromEntries(shares.byPd)).toEqual({ 'ПД-1': 0.5, 'ПД-2': 0.5 })
  })

  it('станционная работа целиком уходит в ПД станции', () => {
    expect(Object.fromEntries(workShares(work(atStation), basis).byPd)).toEqual({ 'ПД-2': 1 })
  })

  it('точка на границе ПД относится к ПД, который начинается в ней', () => {
    expect(Object.fromEntries(workShares(work(onLine('КСП', '18+000', 1)), basis).byPd)).toEqual({
      'ПД-2': 1,
    })
  })
})

describe('Расчёт плана на вымышленном примере', () => {
  const plan = planWith(
    onLine('ППРК', '17 км пк 6 – 19 км пк 5'), // 2 км: 0,5 в ПД-1, 1,5 в ПД-2
    onLine('ППР', '20 км; 46 км'), // 1,964 км: 0,964 в ПД-2, 1 вне ПД
    atStation, // 2 компл, ст. Озёрная, ПД-2
    onLine('ППР', '12 км – 14 км', 3), // объём введён: 3 км в ПД-1
    onLine('КСП', '15+300', 1), // точка в ПД-1
  )

  it('итог дистанции: ППРК входит в ППР', () => {
    expect(volumes(plan, district)).toEqual({ ППРК: 2, ППР: 6.964, КСП: 3 })
  })

  it('по ПД — доли участков, станционные и точечные работы целиком', () => {
    expect(volumes(plan, pd1)).toEqual({ ППРК: 0.5, ППР: 3.5, КСП: 1 })
    expect(volumes(plan, pd2)).toEqual({ ППРК: 1.5, ППР: 2.464, КСП: 2 })
  })

  it('ПД и вне ПД в сумме дают итог дистанции', () => {
    const outsidePpr = 1
    const [a, b, total] = [pd1, pd2, district].map((area) => volumes(plan, area)['ППР'] ?? 0)
    expect((a ?? 0) + (b ?? 0) + outsidePpr).toBeCloseTo(total ?? 0, 9)
  })

  it('лист станции — только работы этой станции', () => {
    expect(volumes(plan, s1)).toEqual({ КСП: 2 })
  })

  it('таблица группы — виды группы, отмеченные для таблицы, в порядке нормативов', () => {
    expect(planRows(plan, pd2, 'current')).toEqual([
      {
        code: 'ППР',
        name: 'Планово-предупредительная выправка',
        unit: 'км',
        computed: 2.464,
        value: 2.464,
        manual: false,
        need: undefined,
      },
    ])
    expect(planRows(plan, s1, 'capital').map((r) => [r.code, r.value])).toEqual([['КСП', 2]])
    expect(planRows(plan, s1, 'current').map((r) => [r.code, r.value])).toEqual([['ППР', 0]])
  })
})

describe('Сверка с прототипом', () => {
  // Тот же пример, но все км стандартные: прототип не знает нестандартных км.
  // Значения получены запуском расчёта прототипа (planValues) на этих работах.
  const plan = planWith(
    onLine('ППРК', '17 км пк 6 – 19 км пк 5'),
    onLine('ППР', '21 км; 46 км'),
    atStation,
    onLine('ППР', '12 км – 14 км', 3),
    onLine('КСП', '15+300', 1),
  )

  it('доли и суммы совпадают с прототипом', () => {
    expect(volumes(plan, district)).toEqual({ ППРК: 2, ППР: 7, КСП: 3 })
    expect(volumes(plan, pd1)).toEqual({ ППРК: 0.5, ППР: 3.5, КСП: 1 })
    expect(volumes(plan, pd2)).toEqual({ ППРК: 1.5, ППР: 2.5, КСП: 2 })
    expect(volumes(plan, s1)).toEqual({ КСП: 2 })
  })
})

describe('Ручные значения', () => {
  it('ручное значение помечается и переживает пересчёт', () => {
    let plan = planWith(onLine('ППР', '12 км – 14 км', 3))
    plan = value(setManualValue(plan, pd1, 'overrides', 'ППР', 4))
    expect(planRows(plan, pd1, 'current')[0]).toMatchObject({ computed: 3, value: 4, manual: true })

    plan = value(addWork(plan, workId('w-9'), onLine('ППР', '15 км')))
    expect(planRows(plan, pd1, 'current')[0]).toMatchObject({ computed: 4, value: 4, manual: true })
    expect(planRows(plan, district, 'current')[0]).toMatchObject({ value: 4, manual: false })

    plan = value(setManualValue(plan, pd1, 'overrides', 'ППР', undefined))
    expect(planRows(plan, pd1, 'current')[0]).toMatchObject({ value: 4, manual: false })
  })

  it('потребность хранится отдельно от плана', () => {
    const plan = value(setManualValue(planWith(), pd2, 'needs', 'ППР', 12.5))
    expect(planRows(plan, pd2, 'current')[0]).toMatchObject({ need: 12.5, value: 0, manual: false })
    expect(planRows(plan, pd1, 'current')[0]?.need).toBeUndefined()
  })

  it('ручное значение — для существующих области и вида, неотрицательное', () => {
    const r = setManualValue(planWith(), { kind: 'pd', pd: 'ПД-9' }, 'overrides', 'НЕТ', -1)
    expect(r.ok ? [] : r.error.map(describePlanError)).toEqual([
      'ПД «ПД-9» нет в редакции паспорта плана',
      'Вида работ «НЕТ» нет в редакции паспорта плана',
      'Значение должно быть неотрицательным числом, а не -1',
    ])
  })
})
