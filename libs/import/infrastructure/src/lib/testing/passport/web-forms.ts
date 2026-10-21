import {
  BOUNDARIES,
  distance,
  EDITORS,
  ENTERPRISE,
  kmLength,
  legacyPd,
  LINES,
  OPEN_END,
  ROAD,
  STATIONS,
  SUBDIVISIONS,
  TERRITORIES,
  type FixtureLine,
  type Point,
} from './model'
import type { CellKind, WebColumn, WebTable } from './web-xls'

/** Форма с заголовками как в ЕК АСУИ; «|» в заголовке — перенос `<br>`. */
function columns(spec: readonly (readonly [string, CellKind])[]): WebColumn[] {
  return spec.map(([header, kind]) => ({ header, kind }))
}

const f1 = (n: number): string => `${n}.0`
const editor = (i: number): string => EDITORS[i % EDITORS.length] ?? ''

/** Отрезок характеристики направления. */
interface Segment {
  readonly line: FixtureLine
  readonly from: Point
  readonly to: Point
  readonly index: number
}

/** Нарезка протяжения на отрезки по границам из splits (км), с метрами внутри. */
function segmentsOf(line: FixtureLine, cuts: readonly Point[]): Segment[] {
  const out: Segment[] = []
  for (const [start, end] of line.extent) {
    const inside = cuts.filter(
      (c) =>
        (c.km > start.km || (c.km === start.km && c.m > start.m)) &&
        (c.km < end.km || (c.km === end.km && c.m < end.m)),
    )
    let from = start
    for (const to of [...inside, end]) {
      out.push({ line, from, to, index: out.length })
      from = to
    }
  }
  return out
}

const cut = (km: number, m = 0): Point => ({ km, m })

/** Отрезки для всех направлений; на коротком 20 км и длинном 41 км есть границы отрезков. */
function allSegments(cuts: Readonly<Record<string, readonly Point[]>>): Segment[] {
  // Номер отрезка сквозной по всем направлениям: от него зависят значения характеристик.
  return LINES.flatMap((line) => segmentsOf(line, cuts[line.name] ?? [])).map((s, index) => ({
    ...s,
    index,
  }))
}

const [N, E] = LINES

/**
 * Нарезка отрезков у каждой формы своя, как в настоящих выгрузках: по пересечению
 * форм сверка длин находит нестандартные километры (20, 41 и 115 км).
 */
const CUTS: Readonly<Record<string, Record<string, readonly Point[]>>> = {
  class: {
    [N.name]: [cut(12, 350), cut(20, 500), cut(36, 80), cut(41, 1020), cut(50)],
    [E.name]: [cut(108, 640), cut(115, 300)],
  },
  load: {
    [N.name]: [cut(15), cut(19, 500), cut(20, 500), cut(21), cut(40), cut(42), cut(55)],
    [E.name]: [cut(110), cut(115, 300), cut(116)],
  },
  speeds: {
    [N.name]: [cut(11), cut(18), cut(20, 200), cut(21, 300), cut(30, 600), cut(41, 500), cut(48)],
    [E.name]: [cut(105), cut(115, 500), cut(125)],
  },
  rails: {
    [N.name]: [cut(12, 350), cut(16), cut(21), cut(36, 80), cut(41, 500), cut(42, 100), cut(50)],
    [E.name]: [cut(108, 640), cut(116)],
  },
  sleepers: {
    [N.name]: [cut(13), cut(18), cut(19, 500), cut(20, 500), cut(33), cut(44)],
    [E.name]: [cut(102), cut(118)],
  },
  ballast: {
    [N.name]: [cut(14), cut(22), cut(35), cut(41, 1020), cut(52)],
    [E.name]: [cut(112), cut(120)],
  },
}

const segmentsFor = (form: string): Segment[] => allSegments(CUTS[form] ?? {})

function length(s: Segment): string {
  return String(distance(s.line, s.from, s.to))
}

// --- Характеристики по отрезкам ---------------------------------------------

function classForm(): WebTable {
  return {
    sheet: 'Список Класс пути',
    columns: columns([
      ['Главный путь', 'str'],
      ['Км|нач', 'num'],
      ['М|нач', 'num'],
      ['Км|кон', 'num'],
      ['М|кон', 'num'],
      ['Длина', 'num'],
      ['Класс', 'str'],
      ['Группа', 'str'],
      ['Категория', 'str'],
      ['Предприятие', 'str'],
      ['Cкорректировал', 'str'],
    ]),
    rows: segmentsFor('class').map((s) => {
      // Второй отрезок записан с длиной, которая не сходится с координатами: замечание сверки.
      const len = s.index === 1 ? String(Number(length(s)) + 7) : length(s)
      return [
        s.line.name,
        f1(s.from.km),
        f1(s.from.m),
        f1(s.to.km),
        f1(s.to.m),
        len,
        s.index % 3 === 0 ? '3' : '4',
        s.index % 2 === 0 ? 'V' : 'Г',
        String(2 + (s.index % 3)),
        ENTERPRISE,
        editor(s.index),
      ]
    }),
  }
}

function loadForm(): WebTable {
  return {
    sheet: 'Список Грузонапряженность, осевые нагрузки',
    columns: columns([
      ['Главный путь', 'str'],
      ['Км|нач', 'num'],
      ['М|нач', 'num'],
      ['Км|кон', 'num'],
      ['М|кон', 'num'],
      ['Длина', 'num'],
      ['Грузонапряженность', 'num'],
      ['Осевая|нагрузка', 'num'],
      ['Предприятие', 'str'],
    ]),
    rows: segmentsFor('load').map((s) => [
      s.line.name,
      f1(s.from.km),
      f1(s.from.m),
      f1(s.to.km),
      f1(s.to.m),
      length(s),
      (1.1 + s.index * 0.37).toFixed(2),
      (13 + (s.index % 4) * 0.42).toFixed(2),
      ENTERPRISE,
    ]),
  }
}

function speedForm(): WebTable {
  return {
    sheet: 'Список Установленные скорости движения',
    columns: columns([
      ['Главный путь', 'str'],
      ['КМ н.', 'num'],
      ['М н.', 'num'],
      ['КМ к.', 'num'],
      ['М к.', 'num'],
      ['Длина,|м', 'num'],
      ['Причина', 'str'],
      ['ПАСС;', 'num'],
      ['ГРУЗ;', 'num'],
      ['ПРИГ;', 'num'],
      ['ПРЖ;', 'num'],
      ['СКОР;', 'str'],
      ['ВСКОР;', 'str'],
      ['Предприятие', 'str'],
      ['Cкорректировал', 'str'],
    ]),
    rows: segmentsFor('speeds').map((s) => {
      const v = s.index % 4 === 2 ? 60 : 80
      return [
        s.line.name,
        f1(s.from.km),
        f1(s.from.m),
        f1(s.to.km),
        f1(s.to.m),
        length(s),
        s.index % 4 === 2 ? 'кривая малого радиуса' : '',
        f1(v + 10),
        f1(v),
        f1(v + 10),
        f1(v),
        '',
        '',
        ENTERPRISE,
        editor(s.index),
      ]
    }),
  }
}

/** Признаки укладки П, Н и о — год последнего КР берётся по любому из них. */
const LAYING = ['Н', 'П', 'о'] as const

function railForm(): WebTable {
  return {
    sheet: 'Список Рельсы',
    columns: columns([
      ['Главный путь', 'str'],
      ['ПД', 'str'],
      ['КМ н.', 'num'],
      ['М н.', 'num'],
      ['КМ к.', 'num'],
      ['М к.', 'num'],
      ['Длина,|м', 'num'],
      ['Тип', 'str'],
      ['Признак|укладки', 'str'],
      ['Длина', 'str'],
      ['Закалка', 'str'],
      ['Назначение', 'str'],
      ['Завод-|изготовитель', 'str'],
      ['Класс', 'str'],
      ['Группа', 'str'],
      ['Дата|укладки', 'date'],
      ['Износ|прив.', 'str'],
      ['Износ|бок.', 'num'],
      ['Износ|волн.', 'str'],
      ['Тоннаж|до|переукладки', 'num'],
      ['Тоннаж|после|укладки', 'num'],
      ['Предприятие', 'str'],
      ['Cкорректировал', 'str'],
    ]),
    rows: segmentsFor('rails').map((s) => [
      s.line.name,
      legacyPd(s.line, s.from),
      String(s.from.km),
      String(s.from.m),
      String(s.to.km),
      String(s.to.m),
      length(s),
      s.index % 5 === 4 ? 'Р50' : 'Р65',
      LAYING[s.index % LAYING.length] ?? 'Н',
      s.index % 2 === 0 ? 'б.п.' : '25.0',
      'Т1',
      '',
      s.index % 2 === 0 ? 'ЗСМК' : 'ЕВРАЗ',
      s.index % 3 === 0 ? 'Нет данных' : '1',
      '1',
      `${String(10 + (s.index % 18)).padStart(2, '0')}.0${1 + (s.index % 9)}.${1994 + s.index * 2}`,
      '0-12',
      String(s.index % 3),
      '',
      f1(0),
      (12.4 + s.index * 23.1).toFixed(1),
      ENTERPRISE,
      editor(s.index),
    ]),
  }
}

function sleeperForm(): WebTable {
  return {
    sheet: 'Список Шпалы и скрепления',
    columns: columns([
      ['Путь', 'str'],
      ['КМ н.', 'num'],
      ['М н.', 'num'],
      ['КМ к.', 'num'],
      ['М к.', 'num'],
      ['Длина', 'num'],
      ['№ СТП,|тип ИССО', 'str'],
      ['Подрельсовое|основание', 'str'],
      ['Тип|шпал', 'str'],
      ['Эпюра|шпал', 'str'],
      ['Год выпуска', 'num'],
      ['Тип|скреплений', 'str'],
      ['Негодные скрепления, |%', 'num'],
      ['Уложены', 'str'],
      ['Тип прокладок', 'str'],
      ['Участок СТП', 'str'],
      ['Нашпальные аморт.|дата укладки', 'str'],
      ['Нашпальные аморт.|вид ремонта', 'str'],
      ['Нашпальные аморт.|завод-изготовитель', 'str'],
      ['Нашпальные аморт.|% негодных', 'num'],
      ['Подрельсовые аморт.|дата укладки', 'str'],
      ['Подрельсовые аморт.|вид ремонта', 'str'],
      ['Подрельсовые аморт.|завод-изготовитель', 'str'],
      ['Подрельсовые аморт.|процент негодных', 'num'],
      ['Тип|шпал', 'str'],
      ['Тоннаж|до переукладки', 'num'],
      ['Тоннаж|после переукладки', 'num'],
      ['Пропущенный|тоннаж', 'num'],
      ['Признак|подъездной', 'str'],
      // В выгрузке два столбца «Предприятие»: во втором — код ПД.
      ['Предприятие', 'str'],
      ['Предприятие', 'str'],
    ]),
    rows: segmentsFor('sleepers').map((s) => {
      const tonnage = (20.5 + s.index * 17.3).toFixed(1)
      return [
        s.line.name,
        f1(s.from.km),
        f1(s.from.m),
        f1(s.to.km),
        f1(s.to.m),
        length(s),
        '',
        s.index % 4 === 3 ? 'БПД' : 'БПЖ',
        '',
        s.index % 2 === 0 ? '1840' : '2000',
        f1(0),
        'КБ',
        '1.0',
        'Н',
        '',
        '',
        '',
        '',
        'Нет данных',
        f1(0),
        '',
        '',
        'Нет данных',
        f1(0),
        '',
        f1(0),
        tonnage,
        tonnage,
        'Н',
        ENTERPRISE,
        legacyPd(s.line, s.from),
      ]
    }),
  }
}

function ballastForm(): WebTable {
  return {
    sheet: 'Список Балласт',
    columns: columns([
      ['Главный путь', 'str'],
      ['ПД', 'str'],
      ['КМ н.', 'num'],
      ['М н.', 'num'],
      ['КМ к.', 'num'],
      ['М к.', 'num'],
      ['Длина|участка', 'num'],
      ['Род|балласта', 'str'],
      ['Толщина|балласта', 'str'],
      ['Наличие|загрязненности', 'str'],
      ['Наличие|разделительного|слоя', 'str'],
      ['Вид|георешетки', 'str'],
      ['Высота|георешетки', 'str'],
      ['Толщина|защитного|слоя', 'num'],
      ['Род|защитного|слоя', 'str'],
      ['Нед.шир.|бал.призмы|правая', 'num'],
      ['Нед.шир.|бал.призмы|левая', 'num'],
      ['Нед.шир.|обочины|правая', 'num'],
      ['Нед.шир.|обочины|левая', 'num'],
      ['Предприятие', 'str'],
      ['Cкорректировал', 'str'],
      ['Омоноличивание', 'str'],
      ['Тип омоноличивания', 'str'],
    ]),
    // «Нет данных» и «-1» — так выгрузка записывает пустые значения.
    rows: segmentsFor('ballast').map((s) => [
      s.line.name,
      legacyPd(s.line, s.from),
      f1(s.from.km),
      f1(s.from.m),
      f1(s.to.km),
      f1(s.to.m),
      length(s),
      'щеб',
      s.index % 2 === 0 ? '35-50' : '25-34',
      s.index % 3 === 0 ? 'Д' : 'Н',
      '',
      '',
      'Нет данных',
      '-1',
      '',
      f1(0),
      f1(0),
      f1(0),
      f1(s.index % 2),
      ENTERPRISE,
      editor(s.index),
      'нет',
      '',
    ]),
  }
}

// --- Оргструктура -----------------------------------------------------------

function subdivisionForm(): WebTable {
  return {
    sheet: 'Список Эксплуатационные и линейные участки, цеха',
    columns: columns([
      ['Дорога', 'str'],
      ['Предприятие', 'str'],
      ['Подразделение', 'str'],
      ['Ид подразделения', 'str'],
      ['Тип|подразделения', 'str'],
      ['Вид|деятельности', 'str'],
      ['Номер', 'num'],
      ['Тип+номер', 'str'],
      ['Название', 'str'],
      ['Подчиняется', 'str'],
      ['Тип подчинения', 'str'],
      ['Начало|действия', 'date'],
      ['Конец|действия', 'date'],
      ['Отвечает за учет|в паспорте', 'str'],
    ]),
    rows: SUBDIVISIONS.map((u) => [
      ROAD,
      ENTERPRISE,
      // У ПЧДЕФ столбец «Подразделение» в выгрузке пуст.
      u.type === 'ПЧДЕФ' ? '' : u.code,
      u.id,
      u.type,
      u.activity,
      f1(u.number),
      u.code,
      u.code,
      // Вышестоящий ПЧУ записан как «предприятие, ПЧУ-01»: номер с ведущим нулём.
      u.parent === ENTERPRISE
        ? ENTERPRISE
        : `${ENTERPRISE}, ${u.parent.replace(/-(\d)$/u, '-0$1')}`,
      u.parentType,
      u.start,
      u.end,
      u.passportOwner ? 'Д' : 'Н',
    ]),
  }
}

function boundaryForm(): WebTable {
  return {
    sheet: 'Список Границы подразделений',
    columns: columns([
      ['Подразделение', 'str'],
      ['Главный|путь', 'str'],
      ['КМ н.', 'num'],
      ['М н.', 'num'],
      ['КМ к.', 'num'],
      ['М к.', 'num'],
      ['Длина|участка, м', 'num'],
      ['Вид деятельности', 'str'],
      ['Тип', 'str'],
      ['Предприятие', 'str'],
      ['Дата|начала|действия', 'date'],
      ['Дата|конца|действия', 'date'],
      ['Cкорректировал', 'str'],
    ]),
    rows: BOUNDARIES.map((b, i) => [
      b.code,
      b.line.name,
      f1(b.from.km),
      f1(b.from.m),
      f1(b.to.km),
      f1(b.to.m),
      String(distance(b.line, b.from, b.to)),
      'Неотложные работы',
      b.code.startsWith('ЗП') ? 'Цех по содержанию земляного полотна' : 'Линейный участок',
      ENTERPRISE,
      b.start,
      b.end ?? OPEN_END,
      editor(i),
    ]),
  }
}

function stationPdForm(): WebTable {
  const rows = STATIONS.flatMap((s, i) => [
    [ENTERPRISE, s.legacyPd, 'ПД', s.name, '01.08.2017', OPEN_END, editor(i)],
    [ENTERPRISE, s.pd, 'ПД', s.name, '01.04.2026', OPEN_END, editor(i + 1)],
  ])
  return {
    sheet: 'Список Станции обслуживания ПД',
    columns: columns([
      ['Предприятие', 'str'],
      ['Подразделение', 'str'],
      ['Тип|подразделения', 'str'],
      ['Станция', 'str'],
      ['Начало|действия', 'date'],
      ['Конец|действия', 'date'],
      ['Скорректировал', 'str'],
    ]),
    rows,
  }
}

function trackPdForm(): WebTable {
  const rows = STATIONS.filter((s) => s.tracks.length > 0).flatMap((s) =>
    s.tracks.map((t, i) => {
      const main = t.purpose === 'главный'
      const name = main
        ? `ГП ${s.name}, ${s.axes[0]?.line.section ?? ''} 1`
        : `Путь ${t.purpose} № ${t.number} на станции ${s.name}`
      // Часть главного пути станции ПД-3 относится к соседнему ПД — по метрам.
      const partial = s.name === 'КЛЮЧЕВАЯ' && main
      return [
        ENTERPRISE,
        s.pd,
        s.name,
        name,
        partial ? 'Н' : 'Д',
        partial ? '181' : '0',
        partial ? String(t.full) : '0',
        'ПД',
        i === 0 ? '01.04.2026' : '01.08.2017',
        OPEN_END,
      ]
    }),
  )
  return {
    sheet: 'Список Станционные пути обслуживания ПД',
    columns: columns([
      ['Предприятие', 'str'],
      ['Подразделение', 'str'],
      ['Станция', 'str'],
      ['Путь', 'str'],
      ['Признак -|весь путь', 'str'],
      ['Метр начала', 'num'],
      ['Метр конца', 'num'],
      ['Тип|подразделения', 'str'],
      ['Начало|действия', 'date'],
      ['Конец|действия', 'date'],
    ]),
    rows,
  }
}

function axisForm(): WebTable {
  const rows = STATIONS.flatMap((s, si) =>
    s.axes.map((a, ai) => {
      const firstSwitch = s.switches[0]
      const lastSwitch = s.switches[1]
      const sw = (n: string | undefined): string =>
        n ? `Стрелочный перевод № ${n}, на станции ${s.name}` : ''
      const swFrom =
        kmLength(a.line, a.from.km) - a.from.m > 60 ? { km: a.from.km, m: a.from.m + 60 } : a.from
      return [
        s.name,
        a.line.name,
        f1(a.axis.km),
        // В одной строке привязка в метрах не заполнена: «-----».
        si === 1 ? '-----' : String(a.axis.m),
        f1(a.from.km),
        f1(a.from.m),
        f1(a.to.km),
        f1(a.to.m),
        f1(a.axis.km),
        f1(a.axis.m),
        sw(firstSwitch?.number),
        firstSwitch ? f1(swFrom.km) : '',
        firstSwitch ? f1(swFrom.m) : '',
        sw(lastSwitch?.number),
        lastSwitch ? f1(a.to.km) : '',
        lastSwitch ? f1(Math.max(0, a.to.m - 60)) : '',
        a.line.section,
        ai === 0 ? '27.12.2021' : '01.04.2026',
        OPEN_END,
        editor(si),
        'Отсутствует',
        '',
        '',
        '',
        '0',
        '',
        '',
        '',
        '0',
      ]
    }),
  )
  return {
    sheet: 'Список Границы станций',
    columns: columns([
      ['Станция', 'str'],
      ['Путь', 'str'],
      ['Привязка, км', 'num'],
      ['Привязка, м', 'str'],
      ['Граница|начала, км', 'num'],
      ['Граница|начала, м', 'num'],
      ['Граница|конца, км', 'num'],
      ['Граница|конца, м', 'num'],
      ['Ось, км', 'num'],
      ['Ось, м', 'num'],
      ['Стрелка|начала', 'str'],
      ['Стрелка|начала, км', 'num'],
      ['Стрелка|начала, м', 'num'],
      ['Стрелка|конца', 'str'],
      ['Стрелка|конца, км', 'num'],
      ['Стрелка|конца, м', 'num'],
      ['Участок|пути', 'str'],
      ['Начало|действия', 'date'],
      ['Конец|действия', 'date'],
      ['Cкорректировал', 'str'],
      ['Ограничение', 'str'],
      ['Граница|ограничения 1', 'str'],
      ['Тип|ограничения 1', 'str'],
      ['Станция|ограничения 1', 'str'],
      ['Расстояние до|ограничения 1', 'num'],
      ['Граница|ограничения 2', 'str'],
      ['Тип|ограничения 2', 'str'],
      ['Станция|ограничения 2', 'str'],
      ['Расстояние до|ограничения 2', 'num'],
    ]),
    rows,
  }
}

function okatoForm(): WebTable {
  return {
    sheet: 'Список Области, районы, города',
    columns: columns([
      ['Дорога', 'str'],
      ['Предприятие', 'str'],
      ['ОКАТО', 'str'],
      ['Тип', 'str'],
      ['Верхний|ОКАТО', 'str'],
      ['Тип верхнего|ОКАТО', 'str'],
      ['Начало|действия', 'date'],
      ['Конец|действия', 'date'],
    ]),
    rows: TERRITORIES.map((t) => [
      ROAD,
      ENTERPRISE,
      t.name,
      t.type,
      t.parent,
      t.parentType,
      '15.01.2021',
      OPEN_END,
    ]),
  }
}

/** Имя файла — номер, как в выгрузке: он меняется каждый раз, форма узнаётся по шапке. */
export interface WebForm {
  readonly form: string
  readonly file: string
  readonly table: WebTable
}

export function webForms(): WebForm[] {
  return [
    { form: 'subdivisions', file: '90000101.xls', table: subdivisionForm() },
    { form: 'boundaries', file: '90000102.xls', table: boundaryForm() },
    { form: 'station-pd', file: '90000103.xls', table: stationPdForm() },
    { form: 'track-pd', file: '90000104.xls', table: trackPdForm() },
    { form: 'station-axes', file: '90000105.xls', table: axisForm() },
    { form: 'okato', file: '90000106.xls', table: okatoForm() },
    { form: 'class', file: '90000107.xls', table: classForm() },
    { form: 'load', file: '90000108.xls', table: loadForm() },
    { form: 'speeds', file: '90000109.xls', table: speedForm() },
    { form: 'rails', file: '90000110.xls', table: railForm() },
    { form: 'sleepers', file: '90000111.xls', table: sleeperForm() },
    { form: 'ballast', file: '90000112.xls', table: ballastForm() },
  ]
}
