import { formatPlus, type Chainage } from '@eow/shared/kernel'
import type { SegmentRow, StationRow } from '@eow/passport/import-api'
import type { EditionData, EditionLine } from './edition-data'

/** Изменение одного поля строки; имена полей — из DTO, подписи подставляет интерфейс. */
export interface EditionFieldChange {
  readonly field: string
  readonly before: string
  readonly after: string
}
export interface EditionDiffRow {
  readonly key: string
  readonly label: string
  readonly changes: readonly EditionFieldChange[]
}
export type EditionDiffSectionName =
  'lines' | 'segments' | 'org' | 'stations' | 'crossings' | 'territories' | 'manual'
export interface EditionDiffSection {
  readonly section: EditionDiffSectionName
  readonly added: readonly EditionDiffRow[]
  readonly removed: readonly EditionDiffRow[]
  readonly changed: readonly EditionDiffRow[]
}
export interface EditionDiff {
  readonly sections: readonly EditionDiffSection[]
}

const SEGMENT_TITLES: Record<SegmentRow['form'], string> = {
  class: 'Класс пути',
  load: 'Грузонапряжённость',
  speeds: 'Скорости',
  rails: 'Рельсы',
  sleepers: 'Шпалы и скрепления',
  ballast: 'Балласт',
}

/** Служебные поля, которые не являются данными: позиция в файле импорта не меняет смысл строки. */
const SKIP = new Set(['id', 'importFileId', 'lineId'])

function isChainage(value: unknown): value is Chainage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'km' in value &&
    'm' in value &&
    Object.keys(value).length === 2
  )
}

function isExtent(value: unknown): value is { readonly from: Chainage; readonly to: Chainage } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'from' in value &&
    'to' in value &&
    Object.keys(value).length === 2 &&
    isChainage(value.from) &&
    isChainage(value.to)
  )
}

function display(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'number' || typeof value === 'string') return String(value)
  if (isChainage(value)) return formatPlus(value)
  if (isExtent(value)) return `${formatPlus(value.from)} – ${formatPlus(value.to)}`
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((v) => typeof v === 'number'))
      return `км ${value[0]}: ${value[1]} м`
    return value.length ? value.map((item) => display(item)).join('; ') : '—'
  }
  return JSON.stringify(value)
}

/** Раскрывает вложенные объекты в плоский список полей; массивы сравниваются целиком. */
function fields(value: unknown, prefix: string, out: Map<string, string>): void {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && !isChainage(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (prefix === '' && SKIP.has(key)) continue
      fields(nested, prefix === '' ? key : `${prefix}.${key}`, out)
    }
    return
  }
  if (!SKIP.has(prefix)) out.set(prefix, display(value))
}

interface RowDiff {
  readonly added: EditionDiffRow[]
  readonly removed: EditionDiffRow[]
  readonly changed: EditionDiffRow[]
}

function diffRows<T>(
  before: readonly T[],
  after: readonly T[],
  key: (row: T) => string,
  label: (row: T) => string,
): RowDiff {
  const earlier = new Map(before.map((row) => [key(row), row]))
  const later = new Map(after.map((row) => [key(row), row]))
  const added: EditionDiffRow[] = []
  const removed: EditionDiffRow[] = []
  const changed: EditionDiffRow[] = []
  for (const [k, row] of later) {
    const old = earlier.get(k)
    if (!old) {
      added.push({ key: k, label: label(row), changes: [] })
      continue
    }
    const beforeFields = new Map<string, string>()
    const afterFields = new Map<string, string>()
    fields(old, '', beforeFields)
    fields(row, '', afterFields)
    const changes: EditionFieldChange[] = []
    for (const [field, value] of afterFields) {
      const previous = beforeFields.get(field)
      if (previous === undefined) changes.push({ field, before: '—', after: value })
      else if (previous !== value) changes.push({ field, before: previous, after: value })
    }
    for (const [field, value] of beforeFields)
      if (!afterFields.has(field)) changes.push({ field, before: value, after: '—' })
    if (changes.length) changed.push({ key: k, label: label(row), changes })
  }
  for (const [k, row] of earlier)
    if (!later.has(k)) removed.push({ key: k, label: label(row), changes: [] })
  return { added, removed, changed }
}

const point = (c: Chainage): readonly unknown[] => [c.km, c.m]
const keyOf = (...parts: readonly unknown[]): string => JSON.stringify(parts)

function stationKey(row: StationRow): string {
  switch (row.form) {
    case 'station-axes':
      return keyOf(row.form, row.values.station, row.values.line, row.validFrom)
    case 'station-tracks':
      return keyOf(row.form, row.values.station, row.values.number, row.validFrom)
    case 'switches':
      return keyOf(row.form, row.values.station, row.values.number, row.validFrom)
    case 'crossings-general':
      return keyOf(row.form, row.values.number)
    case 'okato':
      return keyOf(row.form, row.values.type, row.values.name)
  }
}

function stationLabel(row: StationRow): string {
  switch (row.form) {
    case 'station-axes':
      return `Ось станции ${row.values.station} (${row.values.line})`
    case 'station-tracks':
      return `Путь ${row.values.number} станции ${row.values.station}`
    case 'switches':
      return `Стрелка ${row.values.number} станции ${row.values.station}`
    case 'crossings-general':
      return `Переезд ${row.values.number}${row.values.name ? ` ${row.values.name}` : ''}`
    case 'okato':
      return row.values.name
  }
}

function merge(parts: readonly RowDiff[]): RowDiff {
  return {
    added: parts.flatMap((p) => p.added),
    removed: parts.flatMap((p) => p.removed),
    changed: parts.flatMap((p) => p.changed),
  }
}

const STATION_FORMS_VIEW = ['station-axes', 'station-tracks', 'switches'] as const
const byForm = (rows: readonly StationRow[], forms: readonly string[]): readonly StationRow[] =>
  rows.filter((row) => forms.includes(row.form))

/** Сравнение двух срезов редакции: добавленное, удалённое и изменённое по каждому разделу. */
export function compareEditionData(before: EditionData, after: EditionData): EditionDiff {
  const lineName = new Map<string, string>()
  for (const l of [...before.lines, ...after.lines])
    if (!lineName.has(l.id)) lineName.set(l.id, l.name)
  const subdivisionCode = new Map<string, string>()
  for (const s of [...before.org.subdivisions, ...after.org.subdivisions])
    subdivisionCode.set(s.id, s.code)
  const codeOf = (id: string): string => subdivisionCode.get(id) ?? id
  const sections: EditionDiffSection[] = []
  sections.push({
    section: 'lines',
    ...diffRows(
      before.lines,
      after.lines,
      (l: EditionLine) => l.name,
      (l) => l.name,
    ),
  })
  sections.push({
    section: 'segments',
    ...diffRows(
      before.segments,
      after.segments,
      (row) => keyOf(row.form, row.lineId, point(row.from), point(row.to), row.validFrom),
      (row) =>
        `${SEGMENT_TITLES[row.form]}: ${lineName.get(row.lineId) ?? row.lineId}, ${formatPlus(row.from)} – ${formatPlus(row.to)}`,
    ),
  })
  sections.push({
    section: 'org',
    ...merge([
      diffRows(
        before.org.subdivisions,
        after.org.subdivisions,
        // У подразделений id — устойчивый внешний идентификатор ЕК АСУИ.
        (row) => row.id,
        (row) => `${row.type} ${row.code}`,
      ),
      diffRows(
        before.org.boundaries,
        after.org.boundaries,
        (row) => keyOf(row.line, point(row.from), point(row.to), row.subdivisionId, row.validFrom),
        (row) =>
          `Граница ${codeOf(row.subdivisionId)}: ${row.line}, ${formatPlus(row.from)} – ${formatPlus(row.to)}`,
      ),
      diffRows(
        before.org.stations,
        after.org.stations,
        (row) => keyOf(row.station, row.subdivisionId, row.validFrom),
        (row) => `Станция ${row.station} → ${codeOf(row.subdivisionId)}`,
      ),
      diffRows(
        before.org.tracks,
        after.org.tracks,
        (row) => keyOf(row.station, row.track, row.subdivisionId, row.validFrom),
        (row) => `Путь ${row.track} станции ${row.station} → ${codeOf(row.subdivisionId)}`,
      ),
    ]),
  })
  sections.push({
    section: 'stations',
    ...diffRows(
      byForm(before.stations, STATION_FORMS_VIEW),
      byForm(after.stations, STATION_FORMS_VIEW),
      stationKey,
      stationLabel,
    ),
  })
  sections.push({
    section: 'crossings',
    ...diffRows(
      byForm(before.stations, ['crossings-general']),
      byForm(after.stations, ['crossings-general']),
      stationKey,
      stationLabel,
    ),
  })
  sections.push({
    section: 'territories',
    ...diffRows(
      byForm(before.stations, ['okato']),
      byForm(after.stations, ['okato']),
      stationKey,
      stationLabel,
    ),
  })
  sections.push({
    section: 'manual',
    ...merge([
      diffRows(
        before.manual.workKinds,
        after.manual.workKinds,
        (row) => keyOf(row.code, row.validFrom),
        (row) => `${row.code} ${row.name}`,
      ),
      diffRows(
        before.manual.repairNorms,
        after.manual.repairNorms,
        (row) =>
          keyOf(
            row.workCode,
            row.trackClass,
            row.trackGroup,
            row.trackCategory,
            row.railType,
            row.sleeperType,
            row.validFrom,
          ),
        (row) => {
          const conditions = [
            row.trackClass,
            row.trackGroup,
            row.trackCategory,
            row.railType,
            row.sleeperType,
          ]
            .filter((part) => part !== null)
            .join(', ')
          return `Норма ${row.workCode}${conditions ? ` (${conditions})` : ''}`
        },
      ),
      diffRows(
        before.manual.tolerances,
        after.manual.tolerances,
        (row) => keyOf(row.code, row.validFrom),
        (row) => `${row.code} ${row.name}`,
      ),
      diffRows(
        before.manual.trainPairs,
        after.manual.trainPairs,
        (row) => keyOf(row.line, point(row.from), point(row.to), row.validFrom),
        (row) => `Пары поездов ${row.line}: ${formatPlus(row.from)} – ${formatPlus(row.to)}`,
      ),
      diffRows(
        before.manual.kilometres,
        after.manual.kilometres,
        (row) => keyOf(row.line, row.km),
        (row) => `Нестандартный километр ${row.line}, км ${row.km}`,
      ),
    ]),
  })
  return { sections }
}
