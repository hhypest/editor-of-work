import type { ManualData } from '@eow/passport/import-api'
const period = ['Начало действия', 'Конец действия', 'Идентификатор'] as const
export const MANUAL_COLUMNS = {
  workKinds: [
    'Код',
    'Название',
    'Единица',
    'Группа',
    'Условное обозначение',
    'Входит в',
    ...period,
  ],
  repairNorms: [
    'Вид ремонта',
    'Класс пути',
    'Группа пути',
    'Категория пути',
    'Тип рельсов',
    'Тип шпал',
    'Лет',
    'Млн т брутто',
    ...period,
  ],
  tolerances: ['Код', 'Название', 'Значение', 'Единица', 'Условия', ...period],
  trainPairs: [
    'Направление',
    'Начало, км',
    'Начало, м',
    'Конец, км',
    'Конец, м',
    'Грузовые',
    'Пассажирские',
    'Пригородные',
    ...period,
  ],
  kilometres: ['Направление', 'Км', 'Длина, м', ...period],
} as const
export const MANUAL_KEYS = [
  'workKinds',
  'repairNorms',
  'tolerances',
  'trainPairs',
  'kilometres',
] as const
export const GROUP_LABELS: Readonly<Record<string, string>> = {
  current: 'текущее',
  capital: 'капитальное',
  other: 'прочее',
}
export type ManualCell = string | number | null
export function manualCells(
  data: ManualData,
): Record<keyof ManualData, readonly (readonly ManualCell[])[]> {
  const end = (r: { id: string; validFrom: string | null; validTo: string | null }) => [
    r.validFrom,
    r.validTo,
    r.id,
  ]
  return {
    workKinds: data.workKinds.map((r) => [
      r.code,
      r.name,
      r.unit,
      GROUP_LABELS[r.group] ?? r.group,
      r.symbol,
      r.includedIn,
      ...end(r),
    ]),
    repairNorms: data.repairNorms.map((r) => [
      r.workCode,
      r.trackClass,
      r.trackGroup,
      r.trackCategory,
      r.railType,
      r.sleeperType,
      r.years,
      r.millionTons,
      ...end(r),
    ]),
    tolerances: data.tolerances.map((r) => [
      r.code,
      r.name,
      r.value,
      r.unit,
      r.conditions,
      ...end(r),
    ]),
    trainPairs: data.trainPairs.map((r) => [
      r.line,
      r.from.km,
      r.from.m,
      r.to.km,
      r.to.m,
      r.freight,
      r.passenger,
      r.suburban,
      ...end(r),
    ]),
    kilometres: data.kilometres.map((r) => [r.line, r.km, r.length, ...end(r)]),
  }
}
