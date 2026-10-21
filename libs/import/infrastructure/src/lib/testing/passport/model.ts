/**
 * Вымышленная дистанция для фикстур выгрузок ЕК АСУИ (ADR-0008).
 *
 * Здесь нет ни одного настоящего названия, ФИО или координаты: направления, станции,
 * подразделения и люди придуманы. Зато сохранены особенности настоящих выгрузок,
 * которые обязан выдержать импорт (docs/architecture.md, раздел 8.3).
 */

export interface Point {
  readonly km: number
  readonly m: number
}

export interface FixtureLine {
  /** Наименование из ЕК АСУИ: «Главный путь …, 1». */
  readonly name: string
  /** Направление в книгах переездов: заглавными, без «Главный путь». */
  readonly direction: string
  /** Участок пути в осях станций. */
  readonly section: string
  /** Протяжение в дистанции; между кусками — участок другой дистанции. */
  readonly extent: readonly (readonly [Point, Point])[]
  /** Нестандартные километры: [км, длина в м]. */
  readonly kmLengths: readonly (readonly [number, number])[]
}

export const ROAD = 'Условная'
export const ROAD_SHORT = 'УСЛ'
export const ENTERPRISE = 'ИЧ-0 УЧЕБНАЯ П'
export const OPEN_END = '31.12.9999'

/** Вымышленные ФИО для столбцов «Скорректировал»: импорт их не сохраняет. */
export const EDITORS = ['Иванов Иван Иванович', 'Петрова Анна Сергеевна', ''] as const

export const L1: FixtureLine = {
  name: 'Главный путь Северная-Южная, 1',
  direction: 'СЕВЕРНАЯ-ЮЖНАЯ',
  section: 'Северная-Южная',
  extent: [
    [
      { km: 10, m: 0 },
      { km: 25, m: 0 },
    ],
    [
      { km: 30, m: 0 },
      { km: 60, m: 500 },
    ],
  ],
  kmLengths: [
    [20, 964],
    [41, 1045],
  ],
}

export const L2: FixtureLine = {
  name: 'Главный путь Восточная-Западная, 1',
  direction: 'ВОСТОЧНАЯ-ЗАПАДНАЯ',
  section: 'Восточная-Западная',
  extent: [
    [
      { km: 100, m: 200 },
      { km: 131, m: 700 },
    ],
  ],
  kmLengths: [[115, 990]],
}

export const LINES = [L1, L2] as const

export function kmLength(line: FixtureLine, km: number): number {
  return line.kmLengths.find(([k]) => k === km)?.[1] ?? 1000
}

/** Расстояние по длинам километров направления, м. */
export function distance(line: FixtureLine, a: Point, b: Point): number {
  let total = b.m - a.m
  for (let km = a.km; km < b.km; km++) total += kmLength(line, km)
  return total
}

// --- Оргструктура -----------------------------------------------------------

export interface Subdivision {
  readonly code: string
  readonly id: string
  readonly type: 'ПЧУ' | 'ПД' | 'ЗП' | 'ПДУ' | 'ПДБ' | 'ПЧДЕФ'
  readonly activity: string
  readonly number: number
  readonly parent: string
  readonly parentType: string
  readonly start: string
  readonly end: string
  readonly passportOwner: boolean
}

const CURRENT = 'Неотложные работы'

function unit(
  code: string,
  type: Subdivision['type'],
  n: number,
  parent: string,
  start: string,
  end = OPEN_END,
): Subdivision {
  return {
    code,
    id: `PODR_${9000 + n}`,
    type,
    activity: type === 'ПЧДЕФ' ? 'Диагностика' : CURRENT,
    number: Number(code.replace(/\D+/gu, '')),
    parent,
    parentType: parent === ENTERPRISE ? 'ПЧ (ИЧ)' : 'ПЧУ',
    start,
    end,
    passportOwner: type === 'ПД',
  }
}

/**
 * После реорганизации 01.04.2026 появились ПД-1…ПД-4, а прежние ПД-11…ПД-14 так и
 * остались открытыми: действующие подразделения выбирает пользователь при импорте.
 * ПД-15 закрыт честно — его период действия кончился.
 */
export const SUBDIVISIONS: readonly Subdivision[] = [
  unit('ПЧУ-1', 'ПЧУ', 1, ENTERPRISE, '28.07.2020'),
  unit('ПЧУ-2', 'ПЧУ', 2, ENTERPRISE, '28.07.2020'),
  unit('ПД-1', 'ПД', 3, 'ПЧУ-1', '01.04.2026'),
  unit('ПД-2', 'ПД', 4, 'ПЧУ-1', '01.04.2026'),
  unit('ПД-3', 'ПД', 5, 'ПЧУ-2', '01.04.2026'),
  unit('ПД-4', 'ПД', 6, 'ПЧУ-2', '01.04.2026'),
  unit('ПД-11', 'ПД', 7, 'ПЧУ-1', '01.08.2017'),
  unit('ПД-12', 'ПД', 8, 'ПЧУ-1', '01.08.2017'),
  unit('ПД-13', 'ПД', 9, 'ПЧУ-2', '01.08.2017'),
  unit('ПД-14', 'ПД', 10, 'ПЧУ-2', '01.08.2017'),
  unit('ПД-15', 'ПД', 11, 'ПЧУ-2', '01.08.2017', '31.03.2026'),
  unit('ЗП-1', 'ЗП', 12, ENTERPRISE, '26.10.2017'),
  unit('ПДУ-1', 'ПДУ', 13, 'ПЧУ-1', '26.10.2017'),
  unit('ПДБ-1', 'ПДБ', 14, 'ПЧУ-2', '26.10.2017'),
  unit('ПЧДЕФ-1', 'ПЧДЕФ', 15, ENTERPRISE, '26.10.2017'),
]

export interface Boundary {
  readonly code: string
  readonly line: FixtureLine
  readonly from: Point
  readonly to: Point
  readonly start: string
}

const p = (km: number, m = 0): Point => ({ km, m })

export const BOUNDARIES: readonly Boundary[] = [
  { code: 'ПД-1', line: L1, from: p(10), to: p(18), start: '01.04.2026' },
  { code: 'ПД-2', line: L1, from: p(18), to: p(25), start: '01.04.2026' },
  { code: 'ПД-2', line: L1, from: p(30), to: p(45), start: '01.04.2026' },
  { code: 'ПД-3', line: L1, from: p(45), to: p(60, 500), start: '01.04.2026' },
  { code: 'ПД-4', line: L2, from: p(100, 200), to: p(131, 700), start: '01.04.2026' },
  { code: 'ПД-11', line: L1, from: p(10), to: p(25), start: '01.08.2017' },
  { code: 'ПД-12', line: L1, from: p(30), to: p(60, 500), start: '01.08.2017' },
  { code: 'ПД-13', line: L2, from: p(100, 200), to: p(115), start: '01.08.2017' },
  { code: 'ПД-14', line: L2, from: p(115), to: p(131, 700), start: '01.08.2017' },
  { code: 'ЗП-1', line: L1, from: p(10), to: p(60, 500), start: '26.10.2017' },
]

/** Прежний код ПД, который стоит в столбце «ПД» таблиц характеристик (он не используется). */
export function legacyPd(line: FixtureLine, at: Point): string {
  if (line === L1) return at.km < 30 ? 'ПД-11' : 'ПД-12'
  return at.km < 115 ? 'ПД-13' : 'ПД-14'
}

// --- Станции ----------------------------------------------------------------

export interface StationAxis {
  readonly line: FixtureLine
  readonly axis: Point
  readonly from: Point
  readonly to: Point
}

export interface FixtureTrack {
  readonly purpose: 'главный' | 'приемо-отпр.' | 'погр.-выгр.' | 'вытяжной'
  readonly number: string
  readonly from: string
  readonly via: string
  readonly to: string
  readonly full: number
  readonly useful: number
}

export interface FixtureSwitch {
  readonly number: string
  readonly track: string
  readonly purpose: FixtureTrack['purpose']
  readonly side: 'лев' | 'пр' | 'сбп'
  readonly laid: string
}

export interface FixtureStation {
  readonly name: string
  readonly pd: string
  readonly legacyPd: string
  readonly axes: readonly StationAxis[]
  readonly tracks: readonly FixtureTrack[]
  readonly switches: readonly FixtureSwitch[]
  /** Ликвидирована, но осталась в осях, привязке к ПД и названиях переездов. */
  readonly liquidated?: boolean
}

function axis(line: FixtureLine, km: number, m: number, half = 650): StationAxis {
  const from = m >= half ? p(km, m - half) : p(km - 1, kmLength(line, km - 1) - (half - m))
  const to =
    m + half < kmLength(line, km) ? p(km, m + half) : p(km + 1, m + half - kmLength(line, km))
  return { line, axis: p(km, m), from, to }
}

function tracks(main: string): FixtureTrack[] {
  return [
    { purpose: 'главный', number: main, from: '1', via: '3, 5', to: '2', full: 1210, useful: 0 },
    { purpose: 'приемо-отпр.', number: '3', from: '3', via: '7', to: '4', full: 905, useful: 850 },
    { purpose: 'приемо-отпр.', number: '4', from: '5', via: '', to: '6', full: 842, useful: 790 },
    { purpose: 'погр.-выгр.', number: '7', from: '9', via: '', to: 'упор', full: 310, useful: 260 },
  ]
}

function switches(main: string): FixtureSwitch[] {
  return [
    { number: '1', track: main, purpose: 'главный', side: 'лев', laid: '01.06.1998' },
    { number: '2', track: main, purpose: 'главный', side: 'пр', laid: '15.09.2011' },
    { number: '3', track: '3', purpose: 'приемо-отпр.', side: 'пр', laid: '01.01.1987' },
    { number: '5', track: '4', purpose: 'приемо-отпр.', side: 'лев', laid: '12.07.2004' },
    { number: '7СО', track: '3', purpose: 'приемо-отпр.', side: 'сбп', laid: '01.08.2004' },
    { number: '9', track: '7', purpose: 'погр.-выгр.', side: 'лев', laid: '01.01.1979' },
  ]
}

export const STATIONS: readonly FixtureStation[] = [
  {
    name: 'ОЗЕРНАЯ',
    pd: 'ПД-1',
    legacyPd: 'ПД-11',
    axes: [axis(L1, 15, 400)],
    tracks: tracks('I'),
    switches: switches('I'),
  },
  {
    name: 'ЗАРЕЧЬЕ',
    pd: 'ПД-2',
    legacyPd: 'ПД-11',
    axes: [axis(L1, 22, 100, 300)],
    tracks: [],
    switches: [],
    liquidated: true,
  },
  {
    name: 'БЕРЕЗОВКА',
    pd: 'ПД-2',
    legacyPd: 'ПД-12',
    axes: [axis(L1, 33, 250)],
    tracks: tracks('I'),
    switches: switches('I'),
  },
  {
    name: 'КЛЮЧЕВАЯ',
    pd: 'ПД-3',
    legacyPd: 'ПД-12',
    axes: [axis(L1, 52, 700)],
    tracks: tracks('I'),
    switches: switches('I'),
  },
  {
    // Станция примыкания: оси на обоих направлениях.
    name: 'РАЗЪЕЗДНАЯ',
    pd: 'ПД-3',
    legacyPd: 'ПД-12',
    axes: [axis(L1, 58, 100), axis(L2, 101, 0)],
    tracks: tracks('I'),
    switches: switches('I'),
  },
  {
    name: 'ЛЕСНАЯ',
    pd: 'ПД-4',
    legacyPd: 'ПД-14',
    axes: [axis(L2, 120, 300)],
    tracks: tracks('II'),
    switches: switches('II'),
  },
]

// --- Территории и переезды --------------------------------------------------

export interface Territory {
  readonly name: string
  readonly type: 'Область' | 'Район' | 'Город'
  readonly parent: string
  readonly parentType: '' | 'Область' | 'Район'
}

export const TERRITORIES: readonly Territory[] = [
  { name: 'Условная область', type: 'Область', parent: '', parentType: '' },
  { name: 'Северный район', type: 'Район', parent: 'Условная область', parentType: 'Область' },
  { name: 'Южный район', type: 'Район', parent: 'Условная область', parentType: 'Область' },
  { name: 'г. Озерск', type: 'Город', parent: 'Северный район', parentType: 'Район' },
]

export interface FixtureCrossing {
  readonly number: number
  /** Привязка, как её пишут в названии: «15км3пк», «22 км4пк», «ш.Рудник 1км10пк». */
  readonly place: string
  /** Станция в полном названии; бывает указана неверно — это замечание импорта. */
  readonly station: string
  readonly line: FixtureLine
  readonly district: string
  readonly city: string
  readonly trains: number
  readonly cars: number
  /** Подъездной путь станции: в столбце «Станция» стоит её название, а не «-». */
  readonly siding?: boolean
}

export const CROSSINGS: readonly FixtureCrossing[] = [
  {
    number: 1,
    place: '15км3пк',
    station: 'ОЗЕРНАЯ',
    line: L1,
    district: 'Северный район',
    city: 'г. Озерск',
    trains: 14,
    cars: 1640,
  },
  // Переезд на перегоне записан «на станции ОЗЕРНАЯ», хотя 21 км далеко за её границами.
  {
    number: 2,
    place: '21км7пк',
    station: 'ОЗЕРНАЯ',
    line: L1,
    district: 'Северный район',
    city: 'Нет данных',
    trains: 12,
    cars: 250,
  },
  // Ликвидированная станция в названии.
  {
    number: 3,
    place: '22 км4пк',
    station: 'ЗАРЕЧЬЕ',
    line: L1,
    district: 'Северный район',
    city: 'Нет данных',
    trains: 12,
    cars: 90,
  },
  {
    number: 4,
    place: '33км 10пк',
    station: 'БЕРЕЗОВКА',
    line: L1,
    district: 'Южный район',
    city: 'Нет данных',
    trains: 10,
    cars: 420,
  },
  {
    number: 5,
    place: 'ш.Рудник 1км10пк',
    station: 'ЛЕСНАЯ',
    line: L2,
    district: 'Южный район',
    city: 'Нет данных',
    trains: 2,
    cars: 35,
    siding: true,
  },
  {
    number: 6,
    place: '120км4пк',
    station: 'ЛЕСНАЯ',
    line: L2,
    district: 'Южный район',
    city: 'Нет данных',
    trains: 8,
    cars: 980,
  },
]

export function crossingTitle(c: FixtureCrossing): string {
  return `Переезд на станции ${c.station} № ${c.number} ${c.place}`
}
