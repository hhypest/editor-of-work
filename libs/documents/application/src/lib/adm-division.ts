import {
  chainage,
  compareChainage,
  describeChainageError,
  distance,
  formatPlus,
  KmLengths,
  type Chainage,
} from '@eow/shared/kernel'
import {
  formulaText as q,
  sheetRef,
  type CellStyle,
  type Workbook,
  type WorkbookCell,
  type WorkbookSheet,
} from './workbook-model'

/**
 * Срез редакции для административного деления (#32, ADR-0052). Строки уже отобраны по дате
 * редакции и действующим подразделениям; названия станций и назначения путей без пробелов
 * по краям.
 */
export interface AdmDivisionSource {
  readonly edition: { readonly date: string }
  readonly district?: string | undefined
  readonly lines: readonly {
    readonly name: string
    readonly kmLengths: readonly (readonly [number, number])[]
  }[]
  /** Действующие ПЧУ и ПД; у ПД — его ПЧУ по оргструктуре. */
  readonly units: readonly {
    readonly code: string
    readonly kind: 'ПЧУ' | 'ПД'
    readonly head?: string | undefined
    readonly pchu?: string | undefined
  }[]
  readonly boundaries: readonly {
    readonly pd: string
    readonly line: string
    readonly from: Chainage
    readonly to: Chainage
    /** Длина из выгрузки границ — только для сверки. */
    readonly statedLength: number | null
  }[]
  /** Привязка станций к действующим ПД. */
  readonly bindings: readonly { readonly station: string; readonly pd: string }[]
  readonly axes: readonly {
    readonly station: string
    readonly line: string
    readonly at: Chainage
  }[]
  readonly tracks: readonly {
    readonly station: string
    readonly number: string
    readonly purpose: string
    readonly fullLength: number | null
    readonly usefulLength: number | null
  }[]
  readonly switches: readonly {
    readonly station: string
    readonly number: string
    readonly purpose: string | null
    readonly frogMark: string | null
    readonly railType: string | null
  }[]
  readonly warnings: readonly string[]
}

export interface AdmTotals {
  /** Главный путь по границам ПД, м. */
  readonly mainMeters: number
  /** Станционные пути (кроме главных), м; число путей; главный путь на станциях, м. */
  readonly stationMeters: number
  readonly stationTracks: number
  readonly stationMainMeters: number
  readonly switches: number
  readonly stations: number
}

export interface AdmDivision {
  readonly workbook: Workbook
  readonly warnings: readonly string[]
  /** Итоги, посчитанные приложением: по каждому ПД и по дистанции. */
  readonly totals: { readonly byPd: ReadonlyMap<string, AdmTotals>; readonly district: AdmTotals }
}

export const ADM_SHEETS = {
  main: 'Адм. деление',
  stations: 'Станции',
  boundaries: 'Границы ПД',
  reference: 'Справочник',
  tracks: 'Пути (исх.)',
  switches: 'Стрелки (исх.)',
} as const
const MAIN_PURPOSE = 'главный'
/** Наибольшая высота строки книги, пт (предел Excel — 409). */
export const MAX_HEIGHT = 400
/** Сколько строк границ помещается в строку наибольшей высоты. */
const MAX_BOUNDARY_LINES = Math.floor((MAX_HEIGHT - 4) / 13)

const base: CellStyle = { size: 10, border: true, wrap: true, align: 'left' }
const S = {
  caption: { size: 10, color: '#555555' },
  title: { size: 14, bold: true },
  subtitle: { size: 10, color: '#333333' },
  header: { size: 10, bold: true, fill: '#efefef', border: true, wrap: true, align: 'center' },
  text: base,
  small: { ...base, size: 9 },
  km: { ...base, align: 'right', format: '0.000' },
  meters: { ...base, align: 'right', format: '#,##0' },
  count: { ...base, align: 'right', format: '0' },
  group: { ...base, bold: true, fill: '#f2f2f2' },
  groupKm: { ...base, bold: true, fill: '#f2f2f2', align: 'right', format: '0.000' },
  groupCount: { ...base, bold: true, fill: '#f2f2f2', align: 'right', format: '0' },
  groupMeters: { ...base, bold: true, fill: '#f2f2f2', align: 'right', format: '#,##0' },
  note: { size: 9, color: '#333333' },
  plain: { size: 10 },
} as const satisfies Record<string, CellStyle>

const v = (value: string | number, style: CellStyle = S.text): WorkbookCell => ({ value, style })
const f = (formula: string, result: string | number, style: CellStyle = S.text): WorkbookCell => ({
  formula,
  result,
  style,
})
const empty = (style: CellStyle = S.text): WorkbookCell => ({ style })
const byCode = (a: string, b: string) => a.localeCompare(b, 'ru', { numeric: true })
/** Ключ станции как в критериях Excel: без учёта регистра. */
const key = (name: string) => name.toLocaleLowerCase('ru')
const isMain = (purpose: string) => key(purpose) === MAIN_PURPOSE
const plural = (count: number, one: string, few: string, many: string): string => {
  const tens = count % 100,
    units = count % 10
  return `${count} ${tens >= 11 && tens <= 14 ? many : units === 1 ? one : units >= 2 && units <= 4 ? few : many}`
}

interface StationRow {
  readonly name: string
  readonly pd: string
  readonly others: readonly string[]
  readonly axes: readonly { readonly line: string; readonly at: Chainage }[]
}

/** Книга административного деления: главный лист, расчётные и исходные листы. */
export function buildAdmDivision(source: AdmDivisionSource): AdmDivision {
  const warnings = [...source.warnings]
  const units = new Map(source.units.map((u) => [u.code, u]))
  const pds = source.units.filter((u) => u.kind === 'ПД').toSorted((a, b) => byCode(a.code, b.code))
  const pchus = source.units
    .filter((u) => u.kind === 'ПЧУ')
    .toSorted((a, b) => byCode(a.code, b.code))
  // Длины участков ПД — по длинам километров направления, а не по «км × 1000 + м».
  const lengths = new Map<string, KmLengths | undefined>()
  for (const line of source.lines) {
    const parsed = KmLengths.of(line.kmLengths)
    lengths.set(line.name, lengths.has(line.name) || !parsed.ok ? undefined : parsed.value)
  }
  const boundaries = source.boundaries
    .filter((b) => units.has(b.pd))
    .map((b) => {
      const table = lengths.get(b.line)
      let meters: number | undefined
      if (!table)
        warnings.push(
          `${b.pd}: направление «${b.line}» отсутствует или неоднозначно — длина участка не посчитана.`,
        )
      else {
        const from = chainage(b.from.km, b.from.m, table),
          to = chainage(b.to.km, b.to.m, table)
        if (!from.ok) warnings.push(`${b.pd}, ${b.line}: ${describeChainageError(from.error)}.`)
        else if (!to.ok) warnings.push(`${b.pd}, ${b.line}: ${describeChainageError(to.error)}.`)
        else if (compareChainage(from.value, to.value) >= 0)
          warnings.push(`${b.pd}, ${b.line}: начало участка не раньше конца.`)
        else {
          meters = distance(from.value, to.value, table)
          if (b.statedLength !== null && b.statedLength !== meters)
            warnings.push(
              `${b.pd}, ${b.line} км ${formatPlus(b.from)} — ${formatPlus(b.to)}: в выгрузке длина ${b.statedLength} м, по координатам и длинам км ${meters} м.`,
            )
        }
      }
      return { ...b, meters }
    })
    .toSorted(
      (a, b) =>
        byCode(a.pd, b.pd) || a.line.localeCompare(b.line, 'ru') || compareChainage(a.from, b.from),
    )
  // Станции: одна строка на станцию, ПД — первый по коду из её привязок.
  const bound = new Map<string, { name: string; pds: Set<string> }>()
  for (const b of source.bindings) {
    if (!units.has(b.pd)) continue
    const entry = bound.get(key(b.station)) ?? { name: b.station, pds: new Set<string>() }
    entry.pds.add(b.pd)
    bound.set(key(b.station), entry)
  }
  const axesOf = new Map<string, { line: string; at: Chainage }[]>()
  for (const a of source.axes)
    axesOf.set(key(a.station), [...(axesOf.get(key(a.station)) ?? []), a])
  const stations: StationRow[] = [...bound.values()].map(({ name, pds: codes }) => {
    const [pd = '', ...others] = [...codes].toSorted(byCode)
    if (others.length)
      warnings.push(
        `Станция ${name} привязана к нескольким ПД (${[pd, ...others].join(', ')}): в итоги входит по ${pd}.`,
      )
    if (/[*?~]|^[<>=]/u.test(name))
      warnings.push(
        `Название станции «${name}» содержит знаки * ? ~ < > =: Excel может считать её итоги иначе.`,
      )
    return {
      name,
      pd,
      others,
      axes: (axesOf.get(key(name)) ?? []).toSorted(
        (a, b) => a.line.localeCompare(b.line, 'ru') || compareChainage(a.at, b.at),
      ),
    }
  })
  const lineOrder = (pd: string, line: string) => {
    const index = boundaries.findIndex((b) => b.pd === pd && b.line === line)
    return index < 0 ? Number.MAX_SAFE_INTEGER : index
  }
  /** Ось для порядка: на направлении участка ПД, при нескольких — на первом из них. */
  const anchor = (s: StationRow) =>
    s.axes
      .map((a) => ({ ...a, order: lineOrder(s.pd, a.line) }))
      .toSorted((a, b) => a.order - b.order || compareChainage(a.at, b.at))[0]
  stations.sort((a, b) => {
    const pdOrder = byCode(a.pd, b.pd)
    if (pdOrder) return pdOrder
    const [x, y] = [anchor(a), anchor(b)]
    if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1) || a.name.localeCompare(b.name, 'ru')
    return (
      x.order - y.order ||
      x.line.localeCompare(y.line, 'ru') ||
      compareChainage(x.at, y.at) ||
      a.name.localeCompare(b.name, 'ru')
    )
  })
  // Станции из путей и стрелок без привязки к ПД: в итоги не входят.
  const listed = new Set(stations.map((s) => key(s.name)))
  const loose = new Map<string, string>()
  for (const row of [...source.tracks, ...source.switches])
    if (!listed.has(key(row.station)) && !loose.has(key(row.station)))
      loose.set(key(row.station), row.station)
  const unbound = [...loose.values()].toSorted((a, b) => a.localeCompare(b, 'ru'))
  // Итоги приложения — те же правила, что у формул книги.
  const statsOf = (name: string) => stationStats(source, name)
  const totalsOf = (codes: ReadonlySet<string>): AdmTotals => {
    const own = stations.filter((s) => codes.has(s.pd)).map((s) => statsOf(s.name))
    return {
      mainMeters: boundaries
        .filter((b) => codes.has(b.pd))
        .reduce((n, b) => n + (b.meters ?? 0), 0),
      stationMeters: own.reduce((n, s) => n + s.meters, 0),
      stationTracks: own.reduce((n, s) => n + s.tracks, 0),
      stationMainMeters: own.reduce((n, s) => n + s.main, 0),
      switches: own.reduce((n, s) => n + s.switches, 0),
      stations: own.length,
    }
  }
  for (const pd of pds) {
    const count = boundaries.filter((b) => b.pd === pd.code).length
    if (count > MAX_BOUNDARY_LINES)
      warnings.push(
        `${pd.code}: ${count} участков границ — в строке главного листа видны первые ${MAX_BOUNDARY_LINES}, полный список на листе «${ADM_SHEETS.boundaries}».`,
      )
  }
  const byPd = new Map(pds.map((p) => [p.code, totalsOf(new Set([p.code]))]))
  const district = totalsOf(new Set(pds.map((p) => p.code)))
  const sheets = [
    mainSheet(source, pds, pchus, boundaries, stations, unbound, byPd, totalsOf),
    stationsSheet(source, stations, unbound, statsOf, units),
    boundariesSheet(boundaries, units),
    referenceSheet(pchus, pds),
    tracksSheet(source),
    switchesSheet(source),
  ]
  return { workbook: { sheets }, warnings, totals: { byPd, district } }
}

const ref = (sheet: string, column: string, rows?: readonly [number, number]) =>
  rows
    ? `${sheetRef(sheet)}$${column}$${rows[0]}:$${column}$${rows[1]}`
    : `${sheetRef(sheet)}$${column}:$${column}`
/** «ПД-1» и руководитель из справочника; T() не даёт Excel превратить пустую ячейку в 0. */
const headFormula = (code: string, head: string | undefined): WorkbookCell =>
  f(
    `=${q(code)}&CHAR(10)&T(INDEX(${ref(ADM_SHEETS.reference, 'C')},MATCH(${q(code)},${ref(ADM_SHEETS.reference, 'A')},0)))`,
    head ? `${code}\n${head}` : `${code}\n`,
  )
/** ПЧУ по коду ПД из справочника; T() даёт пустую строку вместо 0 у ПД без ПЧУ. */
const pchuFormula = (cell: string, pchu: string | undefined): WorkbookCell =>
  f(
    `=T(INDEX(${ref(ADM_SHEETS.reference, 'D')},MATCH(${cell},${ref(ADM_SHEETS.reference, 'A')},0)))`,
    pchu ?? '',
    S.text,
  )

function mainSheet(
  source: AdmDivisionSource,
  pds: AdmDivisionSource['units'],
  pchus: AdmDivisionSource['units'],
  boundaries: readonly (AdmDivisionSource['boundaries'][number] & { meters: number | undefined })[],
  stations: readonly StationRow[],
  unbound: readonly string[],
  byPd: ReadonlyMap<string, AdmTotals>,
  totalsOf: (codes: ReadonlySet<string>) => AdmTotals,
): WorkbookSheet {
  const district = source.district?.trim()
  const rows: (WorkbookCell | null)[][] = [
    [v(`ОАО «РЖД»${district ? ` · ${district}` : ''}`, S.caption)],
    [v('АДМИНИСТРАТИВНОЕ ДЕЛЕНИЕ ДИСТАНЦИИ', S.title)],
    [
      v(
        'Эксплуатационные и линейные участки, границы главного пути, протяжённость путей, стрелочные переводы',
        S.subtitle,
      ),
    ],
    [],
    [
      '№',
      'Эксплуатационный участок, руководитель',
      'Линейный участок, руководитель',
      'Границы главного пути',
      'Станции, входящие в участок',
      'Главный путь, км',
      'Станционные пути, км',
      'Стрелочные переводы, шт.',
    ].map((t) => v(t, S.header)),
  ]
  const merges: string[] = ['A1:H1', 'A2:H2', 'A3:H3']
  const heights: Record<number, number> = { 2: 18, 5: 42 }
  const lastStation = Math.max(2, stations.length + 1)
  const groups = [
    ...pchus.map((u) => ({ pchu: u, members: pds.filter((p) => p.pchu === u.code) })),
    {
      pchu: undefined,
      members: pds.filter((p) => !p.pchu || !pchus.some((u) => u.code === p.pchu)),
    },
  ].filter((g) => g.members.length)
  const subtotals: number[] = []
  let number = 0
  for (const group of groups) {
    const first = rows.length + 1
    for (const [i, pd] of group.members.entries()) {
      const own = boundaries.filter((b) => b.pd === pd.code)
      const names = stations.filter((s) => s.pd === pd.code).map((s) => s.name)
      const totals = byPd.get(pd.code)
      const text = own
        .map((b) => `${b.line}: км ${formatPlus(b.from)} — ${formatPlus(b.to)}`)
        .join('\n')
      rows.push([
        v(++number, { ...S.text, align: 'center' }),
        group.pchu
          ? i === 0
            ? headFormula(group.pchu.code, group.pchu.head)
            : empty()
          : v('—', S.text),
        headFormula(pd.code, pd.head),
        v(text || '—', S.small),
        v(names.join(', ') || '—', S.text),
        f(
          `=SUMIFS(${ref(ADM_SHEETS.boundaries, 'H')},${ref(ADM_SHEETS.boundaries, 'A')},${q(pd.code)})/1000`,
          (totals?.mainMeters ?? 0) / 1000,
          S.km,
        ),
        f(
          `=SUMIFS(${ref(ADM_SHEETS.stations, 'H', [2, lastStation])},${ref(ADM_SHEETS.stations, 'E', [2, lastStation])},${q(pd.code)})/1000`,
          (totals?.stationMeters ?? 0) / 1000,
          S.km,
        ),
        f(
          `=SUMIFS(${ref(ADM_SHEETS.stations, 'J', [2, lastStation])},${ref(ADM_SHEETS.stations, 'E', [2, lastStation])},${q(pd.code)})`,
          totals?.switches ?? 0,
          S.count,
        ),
      ])
      // Excel не допускает строку выше 409 пт: длинный перечень границ виден частично.
      heights[rows.length] = Math.min(MAX_HEIGHT, Math.max(30, 13 * Math.max(own.length, 2) + 4))
    }
    const last = rows.length
    if (group.pchu && last > first) merges.push(`B${first}:B${last}`)
    const totals = totalsOf(new Set(group.members.map((p) => p.code)))
    rows.push([
      empty(S.group),
      v(
        `${group.pchu ? `Итого по ${group.pchu.code}` : 'Итого по ПД без ПЧУ'} · станций: ${totals.stations}`,
        S.group,
      ),
      empty(S.group),
      empty(S.group),
      empty(S.group),
      f(`=SUM(F${first}:F${last})`, totals.mainMeters / 1000, S.groupKm),
      f(`=SUM(G${first}:G${last})`, totals.stationMeters / 1000, S.groupKm),
      f(`=SUM(H${first}:H${last})`, totals.switches, S.groupCount),
    ])
    merges.push(`B${rows.length}:E${rows.length}`)
    heights[rows.length] = 18
    subtotals.push(rows.length)
  }
  const all = totalsOf(new Set(pds.map((p) => p.code)))
  const sum = (column: string) =>
    subtotals.length ? `=${subtotals.map((r) => `${column}${r}`).join('+')}` : '=0'
  rows.push([
    empty(S.group),
    v(
      `ВСЕГО по дистанции · ${plural(pchus.length, 'ПЧУ', 'ПЧУ', 'ПЧУ')} · ${plural(pds.length, 'ПД', 'ПД', 'ПД')} · станций: ${all.stations}`,
      S.group,
    ),
    empty(S.group),
    empty(S.group),
    empty(S.group),
    f(sum('F'), all.mainMeters / 1000, S.groupKm),
    f(sum('G'), all.stationMeters / 1000, S.groupKm),
    f(sum('H'), all.switches, S.groupCount),
  ])
  merges.push(`B${rows.length}:E${rows.length}`)
  heights[rows.length] = 19.5
  rows.push([])
  const notes = [
    `Главный путь — сумма длин участков ПД (лист «${ADM_SHEETS.boundaries}»), длины по длинам километров направления.`,
    `Станционные пути — без главных, по полной длине; стрелочные переводы — все переводы станции (лист «${ADM_SHEETS.stations}»).`,
    ...(unbound.length
      ? [
          `Станции ${unbound.join(', ')} есть в путях или стрелочных переводах, но нет в привязке станций к ПД — в итоги не включены.`,
        ]
      : []),
    `Сведения на ${source.edition.date.split('-').toReversed().join('.')}.`,
  ]
  for (const note of notes) {
    rows.push([v(note, S.note)])
    merges.push(`A${rows.length}:H${rows.length}`)
  }
  rows.push([])
  rows.push([
    v('Начальник дистанции  ______________________ / ______________________ /', S.plain),
    null,
    null,
    null,
    null,
    v('«___» ____________ 20__ г.', S.plain),
  ])
  merges.push(`A${rows.length}:E${rows.length}`, `F${rows.length}:H${rows.length}`)
  return {
    name: ADM_SHEETS.main,
    columns: [5, 21, 18, 38, 31, 12, 15, 13],
    rows,
    heights,
    merges,
    freeze: { rows: 5, columns: 0 },
    print: { orientation: 'landscape', onePage: true },
  }
}

function stationsSheet(
  source: AdmDivisionSource,
  stations: readonly StationRow[],
  unbound: readonly string[],
  statsOf: (name: string) => ReturnType<typeof stationStats>,
  units: ReadonlyMap<string, AdmDivisionSource['units'][number]>,
): WorkbookSheet {
  const tracks = ADM_SHEETS.tracks,
    switches = ADM_SHEETS.switches
  const statCells = (row: number, stats: ReturnType<typeof statsOf>): WorkbookCell[] => [
    f(
      `=COUNTIFS(${ref(tracks, 'B')},B${row},${ref(tracks, 'C')},${q(`<>${MAIN_PURPOSE}`)})`,
      stats.tracks,
      S.count,
    ),
    f(
      `=SUMIFS(${ref(tracks, 'D')},${ref(tracks, 'B')},B${row},${ref(tracks, 'C')},${q(`<>${MAIN_PURPOSE}`)})`,
      stats.meters,
      S.meters,
    ),
    f(
      `=SUMIFS(${ref(tracks, 'D')},${ref(tracks, 'B')},B${row},${ref(tracks, 'C')},${q(MAIN_PURPOSE)})`,
      stats.main,
      S.meters,
    ),
    f(`=COUNTIF(${ref(switches, 'B')},B${row})`, stats.switches, S.count),
  ]
  const rows: (WorkbookCell | null)[][] = [
    [
      '№',
      'Станция',
      'Направление',
      'Ось станции, км+м',
      'ПД',
      'ПЧУ',
      'Станц. путей, шт.',
      'Станц. пути, м',
      'Главный путь на станции, м',
      'Стрелочные переводы, шт.',
      'Примечание',
    ].map((t) => v(t, S.header)),
  ]
  for (const [i, s] of stations.entries()) {
    const row = rows.length + 1
    const lines = [...new Set(s.axes.map((a) => a.line))]
    const notes = [
      ...(lines.length > 1 ? ['Примыкание направлений'] : []),
      ...(s.others.length ? [`Привязана также к ${s.others.join(', ')}`] : []),
    ]
    rows.push([
      v(i + 1, { ...S.text, align: 'center' }),
      v(s.name),
      v(lines.join(' / ') || '—'),
      v(s.axes.map((a) => formatPlus(a.at)).join('; ') || 'нет данных'),
      v(s.pd),
      pchuFormula(`E${row}`, units.get(s.pd)?.pchu),
      ...statCells(row, statsOf(s.name)),
      notes.length ? v(notes.join('; ')) : empty(),
    ])
  }
  const last = stations.length + 1
  /** Без строк станций итог — константа: SUM(G2:G2) в строке 2 ссылался бы сам на себя. */
  const sum = (column: string) => (stations.length ? `=SUM(${column}2:${column}${last})` : '=0')
  const total = stations.map((s) => statsOf(s.name))
  rows.push([
    empty(S.group),
    v('Итого по станциям дистанции', S.group),
    empty(S.group),
    empty(S.group),
    empty(S.group),
    empty(S.group),
    f(
      sum('G'),
      total.reduce((n, s) => n + s.tracks, 0),
      S.groupCount,
    ),
    f(
      sum('H'),
      total.reduce((n, s) => n + s.meters, 0),
      S.groupMeters,
    ),
    f(
      sum('I'),
      total.reduce((n, s) => n + s.main, 0),
      S.groupMeters,
    ),
    f(
      sum('J'),
      total.reduce((n, s) => n + s.switches, 0),
      S.groupCount,
    ),
    empty(S.group),
  ])
  const merges = [`B${rows.length}:F${rows.length}`]
  if (unbound.length) {
    rows.push([])
    rows.push([
      null,
      v(
        'Есть в путях или стрелочных переводах, но нет в привязке станций к ПД — в итоги не включены:',
        S.note,
      ),
    ])
    merges.push(`B${rows.length}:K${rows.length}`)
    const axes = new Map<string, string[]>()
    for (const a of source.axes)
      axes.set(key(a.station), [...(axes.get(key(a.station)) ?? []), formatPlus(a.at)])
    for (const name of unbound) {
      const row = rows.length + 1
      rows.push([
        empty(),
        v(name),
        v('—'),
        v(axes.get(key(name))?.join('; ') ?? 'нет данных'),
        v('—'),
        v('—'),
        ...statCells(row, statsOf(name)),
        v('Нет в привязке к ПД'),
      ])
    }
  }
  return {
    name: ADM_SHEETS.stations,
    columns: [5, 15, 22, 18, 7, 8, 10, 11, 12, 12, 30],
    rows,
    merges,
    freeze: { rows: 1, columns: 2 },
    print: { orientation: 'landscape', onePage: false },
  }
}

/** Пути и стрелки станции по правилам формул: без учёта регистра, главный путь отдельно. */
function stationStats(source: AdmDivisionSource, name: string) {
  const tracks = source.tracks.filter((t) => key(t.station) === key(name))
  const station = tracks.filter((t) => !isMain(t.purpose))
  return {
    tracks: station.length,
    meters: station.reduce((n, t) => n + (t.fullLength ?? 0), 0),
    main: tracks.filter((t) => isMain(t.purpose)).reduce((n, t) => n + (t.fullLength ?? 0), 0),
    switches: source.switches.filter((s) => key(s.station) === key(name)).length,
  }
}

function boundariesSheet(
  boundaries: readonly (AdmDivisionSource['boundaries'][number] & { meters: number | undefined })[],
  units: ReadonlyMap<string, AdmDivisionSource['units'][number]>,
): WorkbookSheet {
  const rows: (WorkbookCell | null)[][] = [
    [
      'ПД',
      'ПЧУ',
      'Направление (главный путь)',
      'Начало, км',
      'Начало, м',
      'Конец, км',
      'Конец, м',
      'Длина, м',
    ].map((t) => v(t, S.header)),
  ]
  for (const b of boundaries) {
    const row = rows.length + 1
    rows.push([
      v(b.pd),
      pchuFormula(`A${row}`, units.get(b.pd)?.pchu),
      v(b.line),
      v(b.from.km, S.count),
      v(b.from.m, S.count),
      v(b.to.km, S.count),
      v(b.to.m, S.count),
      b.meters === undefined ? empty(S.meters) : v(b.meters, S.meters),
    ])
  }
  rows.push([
    v('Итого', S.group),
    ...Array.from({ length: 6 }, () => empty(S.group)),
    f(
      boundaries.length ? `=SUM(H2:H${boundaries.length + 1})` : '=0',
      boundaries.reduce((n, b) => n + (b.meters ?? 0), 0),
      S.groupMeters,
    ),
  ])
  rows.push([])
  rows.push([
    v(
      'Длина посчитана программой по координатам и длинам километров направления (нестандартные километры учтены); формула «км × 1000 + м» не используется.',
      S.note,
    ),
  ])
  rows.push([
    v('Источник: границы действующих ПД из оргструктуры паспорта на дату редакции.', S.note),
  ])
  return {
    name: ADM_SHEETS.boundaries,
    columns: [8, 8, 28, 11, 10, 11, 10, 12],
    rows,
    freeze: { rows: 1, columns: 0 },
    print: { orientation: 'landscape', onePage: false },
  }
}

function referenceSheet(
  pchus: AdmDivisionSource['units'],
  pds: AdmDivisionSource['units'],
): WorkbookSheet {
  const rows: (WorkbookCell | null)[][] = [
    ['Подразделение', 'Тип', 'Руководитель', 'Входит в ПЧУ'].map((t) => v(t, S.header)),
    ...[...pchus, ...pds].map((u) => [
      v(u.code),
      v(u.kind === 'ПЧУ' ? 'Эксплуатационный участок' : 'Линейный участок'),
      u.head ? v(u.head) : empty(),
      u.pchu ? v(u.pchu) : empty(),
    ]),
    [],
    [
      v(
        'Руководители — с листа «Руководители» шаблона ручных данных; ПЧУ для ПД — по оргструктуре паспорта.',
        S.note,
      ),
    ],
  ]
  return {
    name: ADM_SHEETS.reference,
    columns: [16, 28, 22, 16],
    rows,
    print: { orientation: 'portrait', onePage: false },
  }
}

function tracksSheet(source: AdmDivisionSource): WorkbookSheet {
  return {
    name: ADM_SHEETS.tracks,
    columns: [6, 16, 24, 16, 18, 10],
    rows: [
      ['№', 'Станция', 'Назначение по ТРА', 'Длина полная, м', 'Длина полезная, м', 'Путь'].map(
        (t) => v(t, S.header),
      ),
      ...source.tracks.map((t, i) => [
        v(i + 1, S.count),
        v(t.station),
        t.purpose ? v(t.purpose) : empty(),
        t.fullLength === null ? empty(S.meters) : v(t.fullLength, S.meters),
        t.usefulLength === null ? empty(S.meters) : v(t.usefulLength, S.meters),
        v(t.number),
      ]),
    ],
    freeze: { rows: 1, columns: 0 },
    print: { orientation: 'portrait', onePage: false },
  }
}

const optional = (value: string | null) => (value ? v(value) : empty())

function switchesSheet(source: AdmDivisionSource): WorkbookSheet {
  return {
    name: ADM_SHEETS.switches,
    columns: [6, 16, 24, 10, 16, 16],
    rows: [
      ['№', 'Станция', 'Назначение', 'Номер', 'Марка крестовины', 'Тип рельсов'].map((t) =>
        v(t, S.header),
      ),
      ...source.switches.map((s, i) => [
        v(i + 1, S.count),
        v(s.station),
        optional(s.purpose),
        v(s.number),
        optional(s.frogMark),
        optional(s.railType),
      ]),
    ],
    freeze: { rows: 1, columns: 0 },
    print: { orientation: 'portrait', onePage: false },
  }
}
