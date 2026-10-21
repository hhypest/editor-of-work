import type { EditionData, EditionLine } from '@eow/passport/application'
import type { SegmentRow } from '@eow/passport/import-api'
import { formatPlus, type Chainage } from '@eow/shared/kernel'

/** Таблица раздела данных редакции: подписи столбцов и уже отформатированные строки. */
export interface TableView {
  readonly title: string
  readonly columns: readonly string[]
  readonly rows: readonly (readonly string[])[]
}

const dash = (value: string | number | boolean | null): string => {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  return String(value)
}
const plus = (value: Chainage | null): string => (value === null ? '—' : formatPlus(value))
const period = (validFrom: string | null, validTo: string | null): string =>
  `${validFrom ?? '…'} — ${validTo === '9999-12-31' ? '…' : (validTo ?? '…')}`

function lineView(lines: readonly EditionLine[]): TableView {
  return {
    title: 'Направления',
    columns: ['Направление', 'Протяжение', 'Нестандартные километры'],
    rows: lines.map((l) => [
      l.name,
      l.extents.length
        ? l.extents.map((e) => `${formatPlus(e.from)} – ${formatPlus(e.to)}`).join('; ')
        : '—',
      l.kmLengths.length ? l.kmLengths.map(([km, m]) => `км ${km}: ${m} м`).join('; ') : '—',
    ]),
  }
}

const SEGMENT_TABLES: Record<
  SegmentRow['form'],
  { title: string; columns: readonly string[]; cells: (row: SegmentRow) => string[] }
> = {
  class: {
    title: 'Класс пути',
    columns: ['Класс пути', 'Группа', 'Категория'],
    cells: (row) =>
      row.form === 'class'
        ? [dash(row.values.trackClass), dash(row.values.group), dash(row.values.category)]
        : [],
  },
  load: {
    title: 'Грузонапряжённость',
    columns: ['Грузонапряжённость, млн ткм/км', 'Осевая нагрузка, т/ось'],
    cells: (row) =>
      row.form === 'load' ? [dash(row.values.grossMillionTonKm), dash(row.values.axleLoad)] : [],
  },
  speeds: {
    title: 'Скорости',
    columns: [
      'Пассажирские, км/ч',
      'Грузовые, км/ч',
      'Пригородные, км/ч',
      'Порожние, км/ч',
      'Экспрессы, км/ч',
      'Скоростные, км/ч',
      'Причина ограничения',
    ],
    cells: (row) =>
      row.form === 'speeds'
        ? [
            dash(row.values.passenger),
            dash(row.values.freight),
            dash(row.values.suburban),
            dash(row.values.empty),
            dash(row.values.express),
            dash(row.values.highSpeed),
            dash(row.values.restrictionReason),
          ]
        : [],
  },
  rails: {
    title: 'Рельсы',
    columns: [
      'Тип рельсов',
      'Признак укладки',
      'Дата укладки',
      'Упрочнение',
      'Боковой износ, мм',
      'Тоннаж до укладки, млн т',
      'Тоннаж после укладки, млн т',
    ],
    cells: (row) =>
      row.form === 'rails'
        ? [
            dash(row.values.railType),
            dash(row.values.layingSign),
            dash(row.values.laidDate),
            dash(row.values.hardening),
            dash(row.values.sideWear),
            dash(row.values.tonnageBefore),
            dash(row.values.tonnageAfter),
          ]
        : [],
  },
  sleepers: {
    title: 'Шпалы и скрепления',
    columns: ['Конструкция', 'Тип шпал', 'Эпюра, шт/км', 'Тип скрепления', 'Тоннаж, млн т'],
    cells: (row) =>
      row.form === 'sleepers'
        ? [
            dash(row.values.structure),
            dash(row.values.sleeperType),
            dash(row.values.density),
            dash(row.values.fasteningType),
            dash(row.values.tonnage),
          ]
        : [],
  },
  ballast: {
    title: 'Балласт',
    columns: ['Тип балласта', 'Толщина, м', 'Засорённость', 'Разделительный слой'],
    cells: (row) =>
      row.form === 'ballast'
        ? [
            dash(row.values.ballastType),
            dash(row.values.thickness),
            dash(row.values.contamination),
            dash(row.values.separatingLayer),
          ]
        : [],
  },
}

function segmentViews(data: EditionData): TableView[] {
  const lineName = new Map(data.lines.map((l) => [l.id, l.name]))
  const base = ['Направление', 'От', 'До', 'Период действия'] as const
  const forms: readonly SegmentRow['form'][] = [
    'class',
    'load',
    'speeds',
    'rails',
    'sleepers',
    'ballast',
  ]
  return forms.map((form) => {
    const spec = SEGMENT_TABLES[form]
    const rows = data.segments.filter((row) => row.form === form)
    return {
      title: spec.title,
      columns: [...base, ...spec.columns],
      rows: rows.map((row) => [
        lineName.get(row.lineId) ?? row.lineId,
        formatPlus(row.from),
        formatPlus(row.to),
        period(row.validFrom, row.validTo),
        ...spec.cells(row),
      ]),
    }
  })
}

function stationViews(data: EditionData): TableView[] {
  const views: TableView[] = []
  const axes = data.stations.filter((row) => row.form === 'station-axes')
  views.push({
    title: 'Станции',
    columns: [
      'Станция',
      'Направление',
      'Ось',
      'Границы',
      'Первая стрелка',
      'Последняя стрелка',
      'Период действия',
    ],
    rows: axes.map((row) =>
      row.form === 'station-axes'
        ? [
            row.values.station,
            row.values.line,
            formatPlus(row.values.axis),
            row.values.from && row.values.to
              ? `${formatPlus(row.values.from)} – ${formatPlus(row.values.to)}`
              : '—',
            dash(row.values.firstSwitch),
            dash(row.values.lastSwitch),
            period(row.validFrom, row.validTo),
          ]
        : [],
    ),
  })
  const tracks = data.stations.filter((row) => row.form === 'station-tracks')
  views.push({
    title: 'Станционные пути',
    columns: [
      'Станция',
      'Путь',
      'Назначение',
      'Парк',
      'Полная длина, м',
      'Полезная длина, м',
      'Последний ремонт',
      'Период действия',
    ],
    rows: tracks.map((row) =>
      row.form === 'station-tracks'
        ? [
            row.values.station,
            row.values.number,
            row.values.purpose,
            dash(row.values.park),
            dash(row.values.fullLength),
            dash(row.values.usefulLength),
            row.values.lastRepairYear === null
              ? '—'
              : `${row.values.lastRepairYear}${row.values.lastRepairKind ? `, ${row.values.lastRepairKind}` : ''}`,
            period(row.validFrom, row.validTo),
          ]
        : [],
    ),
  })
  const switches = data.stations.filter((row) => row.form === 'switches')
  views.push({
    title: 'Стрелочные переводы',
    columns: ['Станция', 'Номер', 'Парк', 'Тип рельсов', 'Марка крестовины', 'Период действия'],
    rows: switches.map((row) =>
      row.form === 'switches'
        ? [
            row.values.station,
            row.values.number,
            dash(row.values.park),
            dash(row.values.railType),
            dash(row.values.frogMark),
            period(row.validFrom, row.validTo),
          ]
        : [],
    ),
  })
  const crossings = data.stations.filter((row) => row.form === 'crossings-general')
  views.push({
    title: 'Переезды',
    columns: ['Номер', 'Название', 'Место', 'Категория', 'Регулируемый', 'Период действия'],
    rows: crossings.map((row) =>
      row.form === 'crossings-general'
        ? [
            row.values.number,
            dash(row.values.name),
            row.values.place
              ? `${row.values.place.km} км ${row.values.place.pk} пк${row.values.place.siding ? `, ${row.values.place.siding}` : ''}`
              : '—',
            dash(row.values.category),
            dash(row.values.regulated),
            period(row.validFrom, row.validTo),
          ]
        : [],
    ),
  })
  const territories = data.stations.filter((row) => row.form === 'okato')
  views.push({
    title: 'Территории',
    columns: ['Название', 'Тип', 'Входит в', 'Период действия'],
    rows: territories.map((row) =>
      row.form === 'okato'
        ? [
            row.values.name,
            row.values.type,
            row.values.parent ? `${row.values.parent} (${row.values.parentType ?? '—'})` : '—',
            period(row.validFrom, row.validTo),
          ]
        : [],
    ),
  })
  return views
}

function manualViews(data: EditionData): TableView[] {
  const { manual } = data
  return [
    {
      title: 'Виды работ',
      columns: ['Код', 'Название', 'Единица', 'Группа', 'Входит в', 'Период действия'],
      rows: manual.workKinds.map((r) => [
        r.code,
        r.name,
        r.unit,
        r.group,
        dash(r.includedIn),
        period(r.validFrom, r.validTo),
      ]),
    },
    {
      title: 'Периодичность ремонтов',
      columns: [
        'Вид ремонта',
        'Класс пути',
        'Группа пути',
        'Категория пути',
        'Тип рельсов',
        'Тип шпал',
        'Лет',
        'Млн т брутто',
        'Период действия',
      ],
      rows: manual.repairNorms.map((r) => [
        r.workCode,
        dash(r.trackClass),
        dash(r.trackGroup),
        dash(r.trackCategory),
        dash(r.railType),
        dash(r.sleeperType),
        dash(r.years),
        dash(r.millionTons),
        period(r.validFrom, r.validTo),
      ]),
    },
    {
      title: 'Допуски',
      columns: ['Код', 'Название', 'Значение', 'Единица', 'Условия', 'Период действия'],
      rows: manual.tolerances.map((r) => [
        r.code,
        r.name,
        dash(r.value),
        r.unit,
        dash(r.conditions),
        period(r.validFrom, r.validTo),
      ]),
    },
    {
      title: 'Пары поездов',
      columns: [
        'Направление',
        'От',
        'До',
        'Грузовые, пар в сутки',
        'Пассажирские, пар в сутки',
        'Пригородные, пар в сутки',
        'Период действия',
      ],
      rows: manual.trainPairs.map((r) => [
        r.line,
        formatPlus(r.from),
        formatPlus(r.to),
        dash(r.freight),
        dash(r.passenger),
        dash(r.suburban),
        period(r.validFrom, r.validTo),
      ]),
    },
    {
      title: 'Нестандартные километры',
      columns: ['Направление', 'Км', 'Длина, м', 'Период действия'],
      rows: manual.kilometres.map((r) => [
        r.line,
        dash(r.km),
        dash(r.length),
        period(r.validFrom, r.validTo),
      ]),
    },
  ]
}

function orgViews(data: EditionData): TableView[] {
  const { org } = data
  const code = new Map(org.subdivisions.map((s) => [s.id, s.code]))
  const subdivision = (id: string | null): string => (id === null ? '—' : (code.get(id) ?? id))
  return [
    {
      title: 'Подразделения',
      columns: ['Код', 'Тип', 'Вышестоящее', 'Вид деятельности', 'Действующее', 'Период действия'],
      rows: org.subdivisions.map((s) => [
        s.code,
        s.type,
        subdivision(s.parentId),
        dash(s.activity),
        dash(s.active),
        period(s.validFrom, s.validTo),
      ]),
    },
    {
      title: 'Границы подразделений',
      columns: ['Направление', 'От', 'До', 'Подразделение', 'Период действия'],
      rows: org.boundaries.map((b) => [
        b.line,
        formatPlus(b.from),
        formatPlus(b.to),
        subdivision(b.subdivisionId),
        period(b.validFrom, b.validTo),
      ]),
    },
    {
      title: 'Привязка станций',
      columns: ['Станция', 'Подразделение', 'Период действия'],
      rows: org.stations.map((s) => [
        s.station,
        subdivision(s.subdivisionId),
        period(s.validFrom, s.validTo),
      ]),
    },
    {
      title: 'Привязка путей',
      columns: ['Станция', 'Путь', 'Подразделение', 'Участок, м', 'Период действия'],
      rows: org.tracks.map((t) => [
        t.station,
        t.track,
        subdivision(t.subdivisionId),
        t.meters ? `${t.meters.start} – ${t.meters.end}` : 'весь путь',
        period(t.validFrom, t.validTo),
      ]),
    },
  ]
}

/** Все разделы данных редакции в порядке показа. */
export function editionDataView(data: EditionData): TableView[] {
  return [
    lineView(data.lines),
    ...segmentViews(data),
    ...stationViews(data),
    ...manualViews(data),
    ...orgViews(data),
  ]
}

/** Подписи полей в сравнении редакций; сначала ищется полный путь, затем последняя часть. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Название',
  extents: 'Протяжение',
  kmLengths: 'Нестандартные километры',
  from: 'От',
  to: 'До',
  statedLength: 'Длина по выгрузке, м',
  validFrom: 'Начало действия',
  validTo: 'Конец действия',
  code: 'Код',
  type: 'Тип',
  group: 'Группа',
  category: 'Категория',
  unit: 'Единица измерения',
  value: 'Значение',
  conditions: 'Условия',
  line: 'Направление',
  km: 'Км',
  length: 'Длина, м',
  station: 'Станция',
  track: 'Путь',
  number: 'Номер',
  park: 'Парк',
  purpose: 'Назначение',
  side: 'Сторона',
  active: 'Действующее',
  parentId: 'Вышестоящее подразделение',
  activity: 'Вид деятельности',
  subdivisionId: 'Подразделение',
  symbol: 'Условное обозначение',
  includedIn: 'Входит в',
  years: 'Лет',
  millionTons: 'Млн т брутто',
  workCode: 'Вид ремонта',
  trackClass: 'Класс пути',
  trackGroup: 'Группа пути',
  trackCategory: 'Категория пути',
  railType: 'Тип рельсов',
  sleeperType: 'Тип шпал',
  ballastType: 'Тип балласта',
  passenger: 'Пассажирские, пар в сутки',
  freight: 'Грузовые, пар в сутки',
  suburban: 'Пригородные, пар в сутки',
  'values.passenger': 'Пассажирские, км/ч',
  'values.freight': 'Грузовые, км/ч',
  'values.suburban': 'Пригородные, км/ч',
  'values.empty': 'Порожние, км/ч',
  'values.express': 'Экспрессы, км/ч',
  'values.highSpeed': 'Скоростные, км/ч',
  'values.restrictionReason': 'Причина ограничения',
  'values.grossMillionTonKm': 'Грузонапряжённость, млн ткм/км',
  'values.axleLoad': 'Осевая нагрузка, т/ось',
  'values.layingSign': 'Признак укладки',
  'values.laidDate': 'Дата укладки',
  'values.linkLength': 'Длина звена',
  'values.hardening': 'Упрочнение',
  'values.plant': 'Завод',
  'values.railClass': 'Класс рельсов',
  'values.railGroup': 'Группа рельсов',
  'values.reducedWear': 'Уменьшенный износ',
  'values.sideWear': 'Боковой износ, мм',
  'values.waveWear': 'Волнообразный износ',
  'values.tonnageBefore': 'Тоннаж до укладки, млн т',
  'values.tonnageAfter': 'Тоннаж после укладки, млн т',
  'values.tonnage': 'Тоннаж, млн т',
  'values.structure': 'Конструкция',
  'values.baseType': 'Тип основания',
  'values.density': 'Эпюра, шт/км',
  'values.manufactureYear': 'Год изготовления',
  'values.fasteningType': 'Тип скрепления',
  'values.fasteningDefective': 'Неисправных скреплений, %',
  'values.laidFlag': 'Признак укладки',
  'values.padType': 'Тип подкладки',
  'values.trackSection': 'Участок',
  'values.upperAbsorberDate': 'Верхний амортизатор: дата',
  'values.upperRepair': 'Верхний амортизатор: ремонт',
  'values.upperPlant': 'Верхний амортизатор: завод',
  'values.upperDefective': 'Верхний амортизатор: неисправных, %',
  'values.lowerAbsorberDate': 'Нижний амортизатор: дата',
  'values.lowerRepair': 'Нижний амортизатор: ремонт',
  'values.lowerPlant': 'Нижний амортизатор: завод',
  'values.lowerDefective': 'Нижний амортизатор: неисправных, %',
  'values.secondarySleeperType': 'Второй тип шпал',
  'values.sidingFlag': 'Признак подъездного пути',
  'values.thickness': 'Толщина, м',
  'values.contamination': 'Засорённость',
  'values.separatingLayer': 'Разделительный слой',
  'values.geogridType': 'Тип георешётки',
  'values.geogridHeight': 'Высота георешётки',
  'values.protectiveThickness': 'Толщина защитного слоя, м',
  'values.protectiveType': 'Тип защитного слоя',
  'values.prismShortageRight': 'Недостаток призмы справа',
  'values.prismShortageLeft': 'Недостаток призмы слева',
  'values.shoulderShortageRight': 'Недостаток обочины справа',
  'values.shoulderShortageLeft': 'Недостаток обочины слева',
  'values.monolithicFlag': 'Признак монолитного основания',
  'values.monolithicType': 'Тип монолитного основания',
  'values.axis': 'Ось',
  'values.firstSwitch': 'Первая стрелка',
  'values.lastSwitch': 'Последняя стрелка',
  'values.via': 'Через стрелки',
  'values.fullLength': 'Полная длина, м',
  'values.usefulLength': 'Полезная длина, м',
  'values.lastRepairYear': 'Год последнего ремонта',
  'values.lastRepairKind': 'Вид последнего ремонта',
  'values.classCode': 'Код класса',
  'values.control': 'Управление',
  'values.frogMark': 'Марка крестовины',
  'values.frogKind': 'Вид крестовины',
  'values.frogs': 'Число крестовин',
  'values.title': 'Обозначение',
  'values.direction': 'Направление',
  'values.stationColumn': 'Станция из выгрузки',
  'values.titleStation': 'Станция по названию',
  'values.regulated': 'Регулируемый',
  'values.signalling': 'Сигнализация',
  'values.surface': 'Покрытие',
  'values.barriers': 'Шлагбаумы',
  'values.trainsPerDay': 'Поездов в сутки',
  'values.vehiclesPerDay': 'Автомобилей в сутки',
  'values.trainSpeed': 'Скорость поездов, км/ч',
  'values.lastOverhaul': 'Последний капитальный ремонт',
  'values.lines': 'Главные пути',
  'values.region': 'Область',
  'values.district': 'Район',
  'values.city': 'Город',
  'values.road': 'Дорога',
  'values.parent': 'Входит в',
  'values.parentType': 'Тип родителя',
  'place.km': 'Км',
  'place.pk': 'Пикет',
  'place.siding': 'Подъездной путь',
  'meters.start': 'Начало участка, м',
  'meters.end': 'Конец участка, м',
}

/** Подпись поля сравнения: полный путь, затем последняя часть, затем сам ключ. */
export function fieldLabel(field: string): string {
  const known = FIELD_LABELS[field]
  if (known) return known
  const parts = field.split('.')
  const last = parts.at(-1) ?? field
  return FIELD_LABELS[last] ?? field
}

export { plus as formatPoint }
