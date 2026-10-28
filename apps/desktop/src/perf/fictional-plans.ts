// Вымышленные планы для замера подготовки листов (ADR-0045). Все названия учебные
// (ADR-0008); план собирается из одного зерна и одинаков на любой машине.
import {
  addWork,
  createAnnualPlan,
  planBasis,
  setDatedIndicators,
  setExpectedIndicators,
  setPlanIndicators,
  setPlanItems,
  workId,
  ITEM_TABLE_KINDS,
  type AnnualPlan,
  type BasisLine,
  type BasisPd,
  type BasisStation,
  type PlanArea,
  type WorkInput,
  type WorkKind,
} from '@eow/planning/domain'
import { KmLengths, type PlaceItem, type Result, type TrackSpan } from '@eow/shared/kernel'

export interface PlanProfile {
  /** Ключ в отчёте и базовой линии. */
  readonly id: 'small' | 'typical' | 'limit' | 'sheets30'
  readonly title: string
  /** Длина каждого направления, км; ПД делят направления поровну. */
  readonly lines: readonly number[]
  readonly pds: number
  readonly stationsPerPd: number
  readonly works: number
  /** Строк в каждой таблице показателей и перечне ПД и дистанции. */
  readonly rows: number
  readonly seed: number
}

/**
 * Малый — два ПД на 40 км; типовой — дистанция в 260 км с 10 ПД и 300 работами;
 * предельный — втрое больше ПД, вдесятеро больше работ и строк таблиц; «30 листов» —
 * пакет PDF ровно из 30 листов ПД в масштабе по умолчанию (цель приёмки — меньше 30 с).
 */
export const PLAN_PROFILES: readonly PlanProfile[] = [
  {
    id: 'small',
    title: 'Малый',
    lines: [40],
    pds: 2,
    stationsPerPd: 1,
    works: 40,
    rows: 3,
    seed: 1,
  },
  {
    id: 'typical',
    title: 'Типовой',
    lines: [110, 90, 60],
    pds: 10,
    stationsPerPd: 3,
    works: 300,
    rows: 5,
    seed: 2,
  },
  {
    id: 'limit',
    title: 'Предельный',
    lines: [160, 140, 120, 90, 70, 60],
    pds: 30,
    stationsPerPd: 3,
    works: 3000,
    rows: 30,
    seed: 3,
  },
  {
    id: 'sheets30',
    title: '30 листов',
    lines: [90, 80, 70],
    pds: 6,
    stationsPerPd: 2,
    works: 100,
    rows: 3,
    seed: 4,
  },
]

/** Детерминированный генератор mulberry32: тот же план на любой ОС и версии Node. */
function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KINDS: readonly WorkKind[] = [
  ['В01', 'Учебная выправка пути', 'км', 'current', true],
  ['В02', 'Учебная сплошная смена рельсов', 'км', 'capital', true],
  ['В03', 'Учебная очистка щебня', 'км', 'capital', true],
  ['В04', 'Учебная шлифовка рельсов', 'км', 'current', true],
  ['В05', 'Учебная замена шпал', 'шт', 'current', true],
  ['В06', 'Учебная смена переводных брусьев', 'компл', 'current', true],
  ['В07', 'Учебный ремонт переезда', 'шт', 'other', true],
  ['В08', 'Учебная прочистка водоотводов', 'м', 'other', true],
  ['В09', 'Учебная разгонка зазоров', 'км', 'current', true],
  ['В10', 'Учебная смена стрелочного перевода', 'компл', 'capital', true],
  ['В11', 'Учебная оправка балластной призмы', 'км', 'current', false],
  ['В12', 'Учебная регулировка ширины колеи', 'км', 'current', true],
].map(([code, name, unit, group, inPlanTable]) => ({
  code: code as string,
  name: name as string,
  unit: unit as string,
  group: group as WorkKind['group'],
  inPlanTable: inPlanTable as boolean,
}))

const NOTES = ['', '', '', 'по графику окон', 'после очистки', 'в счёт резерва', 'по заявке ПЧУ']
const START_KM = 100

function value<T>(result: Result<T, unknown>, what: string): T {
  if (!result.ok) throw new Error(`${what}: ${JSON.stringify(result.error)}`)
  return result.value
}

const at = (km: number, m: number) => ({ km, m })

/** Срез редакции: направления подряд, ПД делят их поровну, станции внутри ПД. */
function fictionalBasis(profile: PlanProfile) {
  const lines: BasisLine[] = profile.lines.map((length, index) => {
    // По одному нестандартному километру на направление, как в реальных выгрузках.
    const kmLengths = value(KmLengths.of([[START_KM + 5 + index, index % 2 ? 964 : 1045]]), 'длины')
    return {
      id: `L${index + 1}`,
      name: `Учебное направление ${index + 1}, 1`,
      extent: [{ line: `L${index + 1}`, from: at(START_KM, 0), to: at(START_KM + length, 0) }],
      kmLengths,
    }
  })
  const total = profile.lines.reduce((sum, length) => sum + length, 0)
  const pds: BasisPd[] = []
  const stations: BasisStation[] = []
  // Число ПД на направлении пропорционально его длине, минимум один.
  let left = profile.pds
  profile.lines.forEach((length, index) => {
    const rest = profile.lines.length - index - 1
    const count =
      rest === 0
        ? left
        : Math.max(1, Math.min(left - rest, Math.round((profile.pds * length) / total)))
    left -= count
    const line = `L${index + 1}`
    for (let i = 0; i < count; i++) {
      const from = START_KM + Math.round((length * i) / count)
      const to = START_KM + Math.round((length * (i + 1)) / count)
      const n = pds.length + 1
      const id = `ПД-${n}`
      pds.push({
        id,
        name: id,
        pchu: `ПЧУ-${Math.ceil(n / 5)}`,
        segments: [{ line, from: at(from, 0), to: at(to, 0) }],
      })
      for (let s = 0; s < profile.stationsPerPd; s++)
        stations.push({
          id: `S${stations.length + 1}`,
          name: `Учебная-${stations.length + 1}`,
          tracks: ['1', '2', '3', '4', '5', '6'],
          switches: ['1', '3', '5', '7', '9', '11'],
          pd: id,
        })
    }
  })
  return value(
    planBasis({
      edition: { number: '1', date: '2026-01-15' },
      lines,
      stations,
      pds,
      workKinds: KINDS,
    }),
    'срез',
  )
}

/** Работы на случайных участках ПД: протяжённые, точечные и на станциях. */
function fictionalWork(
  next: () => number,
  pd: BasisPd,
  stations: readonly BasisStation[],
): WorkInput {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T
  const segment = pick(pd.segments)
  const kind = pick(KINDS)
  const note = pick(NOTES)
  const callout = next() < 0.7
  const own = stations.filter((s) => s.pd === pd.id)
  if (kind.unit === 'компл' && own.length && next() < 0.6) {
    const station = pick(own)
    return {
      kind: kind.code,
      place: {
        kind: 'station',
        station: station.id,
        object: { kind: 'switch', number: pick(station.switches) },
      },
      volume: 1,
      note,
      callout,
    }
  }
  const first = segment.from.km
  const span = segment.to.km - first
  const items: PlaceItem[] = []
  // Одна или две части места в пределах ПД, без перекрытия.
  const parts = next() < 0.2 && span >= 4 ? 2 : 1
  const width = Math.floor(span / parts)
  for (let part = 0; part < parts; part++) {
    const base = first + part * width
    const km = base + Math.floor(next() * Math.max(1, width - 1))
    const m = Math.floor(next() * 9) * 100
    if (kind.unit === 'км') {
      const end = km + 1 + Math.floor(next() * 3)
      // Конец не выходит за часть ПД: на границе участок кончается на 0 м.
      const to = end >= base + width ? at(base + width, 0) : at(end, m)
      items.push({
        kind: 'span',
        line: segment.line,
        from: at(km, m),
        to,
      } satisfies { kind: 'span' } & TrackSpan)
    } else items.push({ kind: 'point', line: segment.line, at: at(km, m) })
  }
  return {
    kind: kind.code,
    place: { kind: 'line', spec: { line: segment.line, items } },
    volume: kind.unit === 'км' ? undefined : 1 + Math.floor(next() * 40),
    note,
    callout,
  }
}

/** Таблицы ПД и дистанции, как в листах прототипа: показатели, ожидаемые, перечни. */
function withTables(plan: AnnualPlan, area: PlanArea, rows: number, next: () => number) {
  const n = (scale: number) => Math.round(next() * scale * 1000) / 1000
  const range = Array.from({ length: rows }, (_, i) => i + 1)
  let result = value(
    setDatedIndicators(
      plan,
      area,
      range.map((i) => ({
        id: `d${i}`,
        name: `Учебный показатель ${i}, км`,
        previous: n(500),
        current: n(500),
      })),
    ),
    'показатели на 01.01',
  )
  result = value(
    setExpectedIndicators(
      result,
      area,
      range.map((i) => ({
        id: `e${i}`,
        group: `Учебная группа ${Math.ceil(i / 3)}`,
        name: i % 3 ? `составляющая ${i}` : '',
        unit: 'км',
        value: i % 3 ? n(200) : null,
      })),
    ),
    'ожидаемые показатели',
  )
  result = value(
    setPlanIndicators(
      result,
      area,
      range.map((i) => ({
        id: `i${i}`,
        name: `Учебный ручной показатель ${i}`,
        unit: 'шт',
        value: n(100),
        note: '',
      })),
    ),
    'ручные показатели',
  )
  for (const kind of ITEM_TABLE_KINDS)
    result = value(
      setPlanItems(
        result,
        area,
        kind,
        range.map((i) => ({
          id: `${kind}${i}`,
          name: `Учебная работа перечня ${i}`,
          unit: 'шт',
          quantity: 1 + Math.floor(next() * 20),
          cost: n(5000),
        })),
      ),
      'перечни',
    )
  return result
}

/** План профиля: те же работы и таблицы при каждом вызове. */
export function fictionalPlan(profile: PlanProfile): AnnualPlan {
  const next = random(profile.seed)
  const basis = fictionalBasis(profile)
  let plan = value(
    createAnnualPlan(2027, basis, {
      title: 'Учебная должность',
      name: 'Учебный составитель',
      year: 2026,
    }),
    'план',
  )
  const pds = [...basis.pds.values()]
  const stations = [...basis.stations.values()]
  const works = []
  for (let i = 0; i < profile.works; i++) {
    const pd = pds[i % pds.length] as BasisPd
    works.push(fictionalWork(next, pd, stations))
  }
  // Работы добавляются по одной теми же проверками, что команды редактора.
  works.forEach((work, index) => {
    plan = value(addWork(plan, workId(`w${index + 1}`), work), `работа ${index + 1}`)
  })
  plan = withTables(plan, { kind: 'district' }, profile.rows, next)
  for (const pd of pds) plan = withTables(plan, { kind: 'pd', pd: pd.id }, profile.rows, next)
  return plan
}
