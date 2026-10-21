import { err, ok, type Result } from '@eow/shared/kernel'
import type { ExportError, ExportLocation, ExportTable } from './export-source'
import { parseRows, type RowReader } from './row-reader'

/** Привязка переезда из названия: «38км2пк», «411 км2пк», «257км 10пк», «ш.Горняк 1км10пк». */
export interface CrossingPlace {
  readonly km: number
  readonly pk: number
  /** Подъездной путь, на котором стоит переезд («ш.Горняк»); null — главный путь. */
  readonly siding: string | null
}

/** «Переезд на станции ОЗЕРНАЯ № 1 15км3пк» → станция, номер и привязка. */
export interface CrossingTitle {
  readonly station: string | null
  readonly number: string | null
  readonly place: CrossingPlace | null
}

const PLACE = /(?:^|\s)(?:(\S+?)\s+)?(\d+)\s*км\s*(\d+)\s*пк\s*$/iu

/** Привязка «км пк» в конце названия; подъездной путь — слово перед ней с точкой или буквой. */
export function parseCrossingPlace(text: string): CrossingPlace | null {
  const m = PLACE.exec(text.trim())
  if (!m?.[2] || !m[3]) return null
  const before = m[1] ?? null
  // Перед привязкой стоит номер переезда («№ 5 ш.Горняк 1км10пк») или название ветки.
  const siding = before !== null && /^[^\d№][^\s]*\.[^\s]+$/u.test(before) ? before : null
  const km = Number(m[2]),
    pk = Number(m[3])
  return Number.isSafeInteger(km) && Number.isInteger(pk) && pk >= 1 && pk <= 10
    ? { km, pk, siding }
    : null
}

export function parseCrossingTitle(title: string): CrossingTitle {
  const station = /на станции\s+(.+?)\s+№/iu.exec(title)?.[1]?.trim() ?? null
  const number = /№\s*(\d+)/u.exec(title)?.[1] ?? null
  return { station, number, place: parseCrossingPlace(title) }
}

/** Переезд по трём книгам «Переезды …», сведённым по полному названию. */
export interface ImportedCrossing {
  readonly title: string
  readonly number: string
  readonly name: string | null
  /** Направление из книги: «СЕВЕРНАЯ-ЮЖНАЯ». */
  readonly direction: string | null
  /** Станция из столбца «Станция»: у переездов на главных путях там «-». */
  readonly stationColumn: string | null
  readonly titleStation: string | null
  readonly place: CrossingPlace | null
  readonly category: string | null
  readonly type: string | null
  readonly region: string | null
  readonly district: string | null
  readonly city: string | null
  readonly road: string | null
  readonly regulated: boolean | null
  readonly signalling: string | null
  readonly surface: string | null
  readonly barriers: string | null
  readonly trainsPerDay: number | null
  readonly vehiclesPerDay: number | null
  /** Наибольшая из максимальных скоростей поездов. */
  readonly trainSpeed: number | null
  readonly lastOverhaul: string | null
  readonly at: ExportLocation
}

interface General {
  readonly title: string
  readonly number: string
  readonly name: string | null
  readonly direction: string | null
  readonly stationColumn: string | null
  readonly category: string | null
  readonly type: string | null
  readonly region: string | null
  readonly district: string | null
  readonly city: string | null
  readonly road: string | null
  readonly at: ExportLocation
}

const noDash = (v: string | null): string | null => (v === '-' ? null : v)

function general(r: RowReader): General {
  return {
    title: r.required('Переезд'),
    number: r.required('Номер'),
    name: r.text('Название'),
    direction: noDash(r.text('Направление')),
    stationColumn: noDash(r.text('Станция')),
    category: r.text('Категория переезда'),
    type: r.text('Тип переезда'),
    region: r.text('Область'),
    district: r.text('Район'),
    city: r.text('Город'),
    road: r.text('Название автодороги'),
    at: r.location(),
  }
}

interface Technical {
  readonly at: ExportLocation
  readonly title: string
  readonly regulated: boolean | null
  readonly signalling: string | null
  readonly surface: string | null
  readonly barriers: string | null
}

function technical(r: RowReader): Technical {
  const regulation = r.text('Вид регулирования')
  return {
    title: r.required('Переезд'),
    at: r.location(),
    regulated: regulation === null ? null : regulation.toLowerCase().startsWith('регулир'),
    signalling: r.text('Вид сигнализации'),
    surface: r.text('Материал настила'),
    barriers: r.text('Вид шлагбаума'),
  }
}

interface Operational {
  readonly at: ExportLocation
  readonly title: string
  readonly trainsPerDay: number | null
  readonly vehiclesPerDay: number | null
  readonly trainSpeed: number | null
  readonly lastOverhaul: string | null
}

const SPEEDS = [
  'Макс ск-ть груз четных поездов',
  'Макс ск-ть груз нечетных поездов',
  'Макс ск-ть пасс четных поездов',
  'Макс ск-ть пасс нечетных поездов',
] as const

function operational(r: RowReader): Operational {
  const speeds = SPEEDS.map((h) => r.measurement(h)).filter((v) => v !== null)
  return {
    title: r.required('Переезд'),
    at: r.location(),
    trainsPerDay: r.measurement('Число поездов в сутки'),
    vehiclesPerDay: r.measurement('Число автомобилей в сутки'),
    trainSpeed: speeds.length > 0 ? Math.max(...speeds) : null,
    lastOverhaul: r.date('Дата посл. кап. ремонта'),
  }
}

/** Ошибка сведения книг: переезд есть в одной книге и нет в другой. */
export interface CrossingJoinRemark {
  readonly text: string
  readonly at?: ExportLocation
}

export interface CrossingImport {
  readonly crossings: readonly ImportedCrossing[]
  readonly remarks: readonly CrossingJoinRemark[]
}

/**
 * Три книги переездов сводятся по полному названию («Переезд»). Переезд только
 * в технической или эксплуатационной книге — замечание; без общих данных он не вводится.
 */
export function parseCrossings(
  generalTable: ExportTable | readonly ExportTable[],
  technicalTable: ExportTable | readonly ExportTable[] | undefined,
  operationalTable: ExportTable | readonly ExportTable[] | undefined,
): Result<CrossingImport, readonly ExportError[]> {
  const tables = (
    source: ExportTable | readonly ExportTable[] | undefined,
  ): readonly ExportTable[] => (source === undefined ? [] : 'form' in source ? [source] : source)
  const read = <T extends { readonly title: string; readonly at: ExportLocation }>(
    source: readonly ExportTable[],
    form: ExportTable['form'],
    parser: (r: RowReader) => T,
  ): Result<T[], readonly ExportError[]> => {
    const rows: T[] = [],
      errors: ExportError[] = []
    const titles = new Set<string>()
    for (const table of source) {
      const parsed = parseRows(table, form, parser)
      if (!parsed.ok) {
        errors.push(...parsed.error)
        continue
      }
      for (const row of parsed.value) {
        if (titles.has(row.title))
          errors.push({
            kind: 'bad-value',
            at: row.at,
            value: row.title,
            expected: 'уникальное название переезда в форме',
          })
        titles.add(row.title)
        rows.push(row)
      }
    }
    return errors.length ? err(errors) : ok(rows)
  }
  const g = read(tables(generalTable), 'crossings-general', general)
  const t = read(tables(technicalTable), 'crossings-technical', technical)
  const o = read(tables(operationalTable), 'crossings-operational', operational)
  const errors = [...(g.ok ? [] : g.error), ...(t.ok ? [] : t.error), ...(o.ok ? [] : o.error)]
  if (!g.ok || !t.ok || !o.ok) return err(errors)
  const tech = new Map(t.value.map((x) => [x.title, x]))
  const oper = new Map(o.value.map((x) => [x.title, x]))
  const titles = new Set(g.value.map((x) => x.title))
  const remarks: CrossingJoinRemark[] = []
  for (const row of [...t.value, ...o.value]) {
    const title = row.title
    if (!titles.has(title))
      remarks.push({
        text: `«${title}» есть в книге технических или эксплуатационных данных, но нет в общих данных`,
        at: row.at,
      })
  }
  const crossings = g.value.map((x): ImportedCrossing => {
    const te = tech.get(x.title)
    const op = oper.get(x.title)
    for (const [book, present] of [
      ['технической', tech.has(x.title)],
      ['эксплуатационной', oper.has(x.title)],
    ] as const)
      if (!present)
        remarks.push({ text: `«${x.title}»: нет записи в ${book} книге переездов`, at: x.at })
    const parsed = parseCrossingTitle(x.title)
    return {
      ...x,
      titleStation: parsed.station,
      place: parsed.place ?? (x.name ? parseCrossingPlace(x.name) : null),
      regulated: te?.regulated ?? null,
      signalling: te?.signalling ?? null,
      surface: te?.surface ?? null,
      barriers: te?.barriers ?? null,
      trainsPerDay: op?.trainsPerDay ?? null,
      vehiclesPerDay: op?.vehiclesPerDay ?? null,
      trainSpeed: op?.trainSpeed ?? null,
      lastOverhaul: op?.lastOverhaul ?? null,
    }
  })
  return ok({
    crossings,
    remarks: [
      ...new Map(
        remarks.map((r) => [JSON.stringify([r.text, r.at?.file, r.at?.sheet, r.at?.row]), r]),
      ).values(),
    ],
  })
}
