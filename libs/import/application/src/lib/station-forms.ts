import type { Result } from '@eow/shared/kernel'
import type { ExportError, ExportLocation, ExportTable } from './export-source'
import { numberOf } from './export-values'
import { parseRows, type ExportPoint, type RowReader, type Validity } from './row-reader'

/** Ось станции на главном пути; у станции примыкания осей несколько. */
export interface ImportedStationAxis {
  readonly station: string
  readonly line: string
  readonly axis: ExportPoint
  /** Границы станции; у остановочных пунктов без стрелок их в выгрузке нет. */
  readonly from: ExportPoint | null
  readonly to: ExportPoint | null
  /** Номера крайних стрелок: «Стрелочный перевод № 1, на станции …» → «1». */
  readonly firstSwitch: string | null
  readonly lastSwitch: string | null
  readonly trackSection: string | null
  readonly validity: Validity
  readonly at: ExportLocation
}

/** Путь из экспликации станционных путей (отчёт BEx). */
export interface ImportedTrack {
  readonly station: string
  readonly purpose: string
  readonly park: string | null
  readonly number: string
  /** Граница пути «от / через / до»: номера стрелок или «упор». */
  readonly from: string | null
  readonly via: readonly string[]
  readonly to: string | null
  readonly fullLength: number | null
  readonly usefulLength: number | null
  /** Тип рельсов с наибольшей длиной на пути. */
  readonly railType: string | null
  readonly ballastType: string | null
  readonly sleeperType: string | null
  /** Последний ремонт капитального характера: год и вид (КРс, КРн). */
  readonly lastRepairYear: number | null
  readonly lastRepairKind: string | null
  readonly classCode: string | null
  readonly at: ExportLocation
}

/** Стрелочный перевод из экспликации стрелочных переводов (отчёт BEx). */
export interface ImportedSwitch {
  readonly station: string
  readonly number: string
  readonly park: string | null
  readonly purpose: string | null
  /** Путь, как он назван в отчёте: главный путь или «Путь … № 3 на станции …». */
  readonly track: string | null
  readonly side: string | null
  readonly laidDate: string | null
  readonly control: string | null
  readonly railType: string | null
  readonly frogMark: string | null
  readonly frogKind: string | null
  /** Число крестовин: у глухих пересечений и перекрёстных переводов их несколько. */
  readonly frogs: number
  readonly sleeperType: string | null
  readonly at: ExportLocation
}

/** «-» в отчётах BEx — значения нет (парк, марка крестовины у сбрасывающей стрелки). */
const noDash = (v: string | null): string | null => (v === '-' ? null : v)

const SWITCH_NAME = /№\s*([^,\s]+)/u

/** «Стрелочный перевод № 1, на станции ОЗЕРНАЯ» → «1». */
export function switchNumber(text: string | null): string | null {
  return text === null ? null : (SWITCH_NAME.exec(text)?.[1] ?? null)
}

/** Строки итогов в отчётах BEx («Итого по типу …») — не пути и не стрелки. */
const isSubtotal = (...values: (string | null)[]): boolean =>
  values.some((v) => v !== null && /^итого(?:\s|$)/iu.test(v))

export function parseStationAxes(
  table: ExportTable,
): Result<ImportedStationAxis[], readonly ExportError[]> {
  return parseRows(table, 'station-axes', (r) => ({
    station: r.required('Станция'),
    line: r.required('Путь'),
    // «Привязка, м» бывает «-----»: точку оси дают столбцы «Ось».
    axis: r.point('Ось, км', 'Ось, м'),
    from: r.optionalPoint('Граница начала, км', 'Граница начала, м'),
    to: r.optionalPoint('Граница конца, км', 'Граница конца, м'),
    firstSwitch: switchNumber(r.text('Стрелка начала')),
    lastSwitch: switchNumber(r.text('Стрелка конца')),
    trackSection: r.text('Участок пути'),
    validity: r.validity('Начало действия', 'Конец действия'),
    at: r.location(),
  }))
}

const RAIL_TYPES = ['Р75', 'Р65', 'Р50', 'P49', 'Р43', 'легче Р43'] as const

function mainRailType(r: RowReader): string | null {
  let best: string | null = null
  let longest = 0
  for (const t of RAIL_TYPES) {
    const length = r.number(`Полная длина по типам рельсов, м / ${t}`) ?? 0
    if (length > longest) {
      longest = length
      // В шапке отчёта «P49» набрано латиницей; в данных — по-русски.
      best = t.replace('P', 'Р')
    }
  }
  return best
}

/** Год ремонта; в отчёте BEx вместо пустого бывает «#» — это «нет данных», а не ошибка. */
function year(r: RowReader, header: string): number | null {
  const n = numberOf(r.text(header))
  return n !== null && n !== undefined && Number.isInteger(n) ? n : null
}

const list = (text: string | null): string[] =>
  text === null
    ? []
    : text
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')

export function parseStationTracks(
  table: ExportTable,
): Result<ImportedTrack[], readonly ExportError[]> {
  const parsed = parseRows(table, 'station-tracks', (r) => {
    // Итоги по назначению и общий итог «Итого по станциям» в столбце станции.
    if (isSubtotal(r.text('Станция'), r.text('Назначение путей по ТРА'))) return null
    return {
      station: r.required('Станция'),
      purpose: r.required('Назначение путей по ТРА'),
      park: noDash(r.text('Парк')),
      number: r.required('Номер'),
      from: r.text('Граница / От'),
      via: list(r.text('Граница / Через')),
      to: r.text('Граница / До'),
      fullLength: r.number('Длина, м / Полн.'),
      usefulLength: r.number('Длина, м / Полезная'),
      railType: mainRailType(r),
      ballastType: r.text('Данные о балласте / Род балласта'),
      sleeperType: r.text('Шпалы / тип'),
      lastRepairYear: year(r, 'Последний ремонт капитального характера / год'),
      lastRepairKind: r.text('Последний ремонт капитального характера / вид'),
      classCode: r.text('Класс, код группы, диапaзон'),
      at: r.location(),
    }
  })
  return parsed.ok ? { ok: true, value: parsed.value.filter((x) => x !== null) } : parsed
}

export function parseStationSwitches(
  table: ExportTable,
): Result<ImportedSwitch[], readonly ExportError[]> {
  const parsed = parseRows(table, 'switches', (r) => {
    if (isSubtotal(r.text('Станция'), r.text('№ стр. перевода'))) return null
    // Строка без станции и номера — следующая крестовина предыдущего перевода.
    if (r.text('Станция') === null && r.text('№ стр. перевода') === null) return 'frog' as const
    return {
      station: r.required('Станция'),
      number: r.required('№ стр. перевода'),
      park: noDash(r.text('Парк')),
      purpose: r.text('Назначение по ТРА путей'),
      track: r.text('Путь'),
      side: r.text('Направление'),
      laidDate: r.date('Дата укладки стрелочного перевода'),
      control: r.text('Способ управления'),
      railType: r.text('Тип рельса'),
      frogMark: noDash(r.text('Крестовины / марка')),
      frogKind: r.text('Крестовины / род'),
      frogs: 1,
      sleeperType: r.text('Переводные брусья / тип'),
      at: r.location(),
    }
  })
  if (!parsed.ok) return parsed
  const out: ImportedSwitch[] = []
  for (const row of parsed.value) {
    if (row === null) continue
    const last = out.at(-1)
    if (row === 'frog') {
      if (last) out[out.length - 1] = { ...last, frogs: last.frogs + 1 }
      continue
    }
    out.push(row)
  }
  return { ok: true, value: out }
}
