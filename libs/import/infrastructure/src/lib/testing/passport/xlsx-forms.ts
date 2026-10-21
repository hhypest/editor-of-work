import ExcelJS from 'exceljs'
import {
  CROSSINGS,
  crossingTitle,
  ENTERPRISE,
  ROAD_SHORT,
  STATIONS,
  type FixtureStation,
  type FixtureTrack,
} from './model'

type Cell = string | number | Date | null

const date = (d: number, m: number, y: number): Date => new Date(Date.UTC(y, m - 1, d))
const OPEN = date(31, 12, 9999)

/** Свойства книги фиксированы: данные фикстуры не зависят от времени запуска. */
const BUILT = date(1, 1, 2026)

async function bytes(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  wb.creator = 'ЕК АСУИ'
  wb.created = BUILT
  wb.modified = BUILT
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** Плоская книга «Переезды …»: один лист Sheet1, шапка в первой строке. */
async function flatBook(
  headers: readonly string[],
  rows: readonly (readonly Cell[])[],
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow([...headers])
  for (const row of rows) {
    if (row.length !== headers.length)
      throw new Error(`строка из ${row.length} ячеек, а столбцов ${headers.length}`)
    ws.addRow([...row])
  }
  return bytes(wb)
}

const GENERAL = [
  'Переезд',
  'Название',
  'Номер',
  'Наименование полное',
  'Направление',
  'Станция',
  'Вид пользования',
  'Категория переезда',
  'Тип переезда',
  'Область',
  'Район',
  'Город',
  'Владелец автодороги',
  'Значение автодороги',
  'Км автодороги',
  'Название автодороги',
  'Пользователь',
  'Приказ о закрытия',
  'Приказ о создании',
  'Снятие дежурного с переезда',
  'Наличие дежурных',
  'Обслуж. работниками службы движения',
  'Дата создания',
  'Дата закрытия',
  'Дата приказа',
  'Тип владельца автодороги',
  'Признак закрытия в тек. году',
  'Хозяйство',
  'Количество дежурных',
  'Год ввода',
  'Статус',
  'Дорога',
  'Предприятие',
] as const

const TECHNICAL = [
  'Переезд',
  'наличие прож. установок',
  'Вид регулирования',
  'Налич. пешех. дорожек',
  'Оборуд. дорожек сигнализ.',
  'Изготовитель настила',
  'Дата укладки настила',
  'Ширина проезжей части',
  'Электрич. освещенность',
  'Высота подвески контактного провода',
  'Высота подвески других линий',
  'Дорожное покрытие на подходах',
  'Тип одежды пеш. дорожек',
  'Материал настила',
  'Материал столбиков',
  'Вид шлагбаума',
  'Вид сигнализации',
  'Дата утверждения инструкций',
  'Длина проезжей части',
  'Протяженность установки сигн столбиков с левой стороны',
  'Протяженность установки сигн столбиков с правой стороны',
  'Протяженность установки перил',
  'Расстояние от ограждения до проезжей части',
  'Дата утверждения схемпланов',
  'Количество дополнительных шлагбаумов',
  'Тип дополнительного шлагбаума',
  'Количество шлагбаумов',
  'Количество светофоров переездных',
  'Количество светофоров заградительных',
  'Количество УЗП',
  'Признак наличия УЗП',
  'Ширина настила в местах прогона скота',
  'Заград. сигнализация',
  'Гориз-пов. шлагбаумы',
  'Число знаков ж/д переезд без шлагбаума',
  'Число знаков ограничение высоты',
  'Число знаков движение без остановки запрещено',
  'Число знаков приближение к ж/д переезду',
  'Число знаков ж/д переезд со шлагбаумом',
  'Число знаков свисток',
  'Число знаков одно/многопутная ж/д',
  'Дорога',
  'Предприятие',
] as const

const OPERATIONAL = [
  'Переезд',
  'Угол пересечения железной и авто дорог',
  'Расположение в плане',
  'Норм положение шлагбаума',
  'Требует кап. ремонта',
  'Требует замены поста дежурного',
  'Число маршрутов автобусов',
  'Дата посл. кап. ремонта',
  'Расположение на земполотне',
  'Наличие связи',
  'Длина горизонтальной площадки',
  'Продолжительность смены',
  'Год модернизации',
  'Число автомобилей в сутки',
  'Число пересекаемых подъездных путей не на балансе РЖД',
  'Число поездов в сутки',
  'Число пересек. гл. путей',
  'Число пересек. под. путей',
  'Число пересек. станц. путей',
  'Наличие разметки проезжей части',
  'Год реконструкции',
  'Число смен',
  'Макс ск-ть груз четных поездов',
  'Макс ск-ть груз нечетных поездов',
  'Макс ск-ть пасс четных поездов',
  'Макс ск-ть пасс нечетных поездов',
  'Число маршрутов трамваев',
  'Число маршрутов троллейбусов',
  'Продольный профиль автодороги',
  'Продольный профиль ж.д.',
  'Условия видимости машинистом четного поезда',
  'Условия видимости машинистом нечетного поезда',
  'Условия видимости водителем с левой стороны четного пое',
  'Условия видимости водителем с левой стороны неч поезда',
  'Условия видимости водителем с прав стороны четного поез',
  'Условия видимости водителем с прав стороны неч поезда',
  'Дорога',
  'Предприятие',
] as const

export function crossingsGeneral(): Promise<Uint8Array> {
  return flatBook(
    GENERAL,
    CROSSINGS.map((c) => [
      crossingTitle(c),
      c.place,
      c.number,
      c.number === 2 ? `Переезд ${c.place}` : '',
      c.line.direction,
      c.siding ? c.station : '-',
      'Общ',
      String(1 + (c.number % 4)),
      c.siding ? 'на подъездных' : 'на главных',
      'Условная область',
      c.district,
      c.city,
      'ГКУ Условдорзаказчик',
      'межмуницип. (регион)',
      0,
      c.number % 2 === 0 ? '0' : `Озерск-Лесное-${c.number}`,
      'ИЧ-0 Учебная',
      '',
      String(c.number),
      'Не присвоено',
      'Б/деж',
      'Нет',
      date(1, 1, 1960 + c.number * 5),
      OPEN,
      c.number === 3 ? null : date(1, 1, 2000),
      '4720',
      'нет',
      'Нет данных',
      0,
      null,
      'РАБОТАЕТ',
      ROAD_SHORT,
      ENTERPRISE,
    ]),
  )
}

export function crossingsTechnical(): Promise<Uint8Array> {
  return flatBook(
    TECHNICAL,
    CROSSINGS.map((c) => [
      crossingTitle(c),
      'Отсутствие',
      c.number % 3 === 0 ? 'Нерегулируемый' : 'Регулируемый',
      'Отсутствие',
      'Нет',
      '0',
      date(1, 8, 2002 + c.number),
      6,
      '5',
      0,
      0,
      'Асф-т',
      '1',
      'Жб.пл',
      'Пластмасса',
      c.number % 2 === 0 ? 'Автоматический' : 'Без шлагбаума',
      'автом. светоф.',
      null,
      22,
      16,
      16,
      0,
      1,
      null,
      0,
      0,
      c.number % 2 === 0 ? 2 : 0,
      2,
      0,
      0,
      'Отсутствие',
      0,
      'Не присвоено',
      0,
      2,
      0,
      0,
      0,
      0,
      2,
      2,
      ROAD_SHORT,
      ENTERPRISE,
    ]),
  )
}

export function crossingsOperational(): Promise<Uint8Array> {
  return flatBook(
    OPERATIONAL,
    CROSSINGS.map((c) => [
      crossingTitle(c),
      60 + c.number * 5,
      c.number % 2 === 0 ? 'кривая' : 'прямая',
      '1-',
      'Нет',
      'Нет',
      c.number % 3,
      date(1, 7, 1989 + c.number),
      'Насыпь',
      '1',
      22,
      0,
      null,
      c.cars,
      0,
      c.trains,
      1,
      c.siding ? 1 : 0,
      0,
      100,
      null,
      0,
      80,
      80,
      90,
      90,
      0,
      0,
      30,
      0,
      '1000',
      '900',
      '400',
      '400',
      '1000',
      '500',
      ROAD_SHORT,
      ENTERPRISE,
    ]),
  )
}

// --- Отчёты BEx ----------------------------------------------------------------

/**
 * Служебные листы BEx: VARS с параметрами отчёта (на него ссылается формула заголовка),
 * скрытые листы запросов и очень скрытый BExRepositorySheet. Импорт читает только лист отчёта.
 */
function addBexService(wb: ExcelJS.Workbook, title: string): void {
  const vars = wb.addWorksheet('VARS', { state: 'hidden' })
  vars.addRow(['Параметр', 'Значение', 'Текст'])
  vars.addRow(['Дорога', ROAD_SHORT, 'Условная железная дорога'])
  vars.addRow(['Предприятие', ENTERPRISE, ENTERPRISE])
  vars.addRow(['Отчёт', title, title])
  vars.addRow(['Дата', '01.01.2026', '01.01.2026'])
  const load = wb.addWorksheet('Load', { state: 'hidden' })
  load.addRow(['Запрос', 'ZPASP_EXPL', 'Статус', 'OK'])
  const helper = wb.addWorksheet('Длина стан путей', { state: 'hidden' })
  helper.addRow(['Станция', 'Длина'])
  helper.addRow(['ОЗЕРНАЯ', { formula: 'SUM(B3:B4)' }])
  helper.addRow(['', 905])
  helper.addRow(['', 842])
  wb.addWorksheet('BExRepositorySheet', { state: 'veryHidden' })
}

/** Шапка: [ячейка, текст] и объединения, как в отчёте. */
function header(
  ws: ExcelJS.Worksheet,
  cells: readonly (readonly [string, string])[],
  merges: readonly string[],
): void {
  for (const m of merges) ws.mergeCells(m)
  for (const [address, text] of cells) ws.getCell(address).value = text
}

const TRACK_HEADER: readonly (readonly [string, string])[] = [
  ['A3', 'Станция'],
  ['B3', 'Назначение путей по ТРА'],
  ['C3', 'Парк'],
  ['D3', 'Номер'],
  ['E3', 'Граница'],
  ['H3', 'Длина, м'],
  ['L3', 'Полная длина по типам рельсов, м'],
  ['R3', 'Протяжение \nб/с пути, м'],
  ['V3', 'Данные о балласте'],
  ['Y3', 'Шпалы'],
  ['AE3', 'Пропущенный тоннаж'],
  ['AG3', 'Последний ремонт капитального характера'],
  ['AI3', 'Скорость пас/груз'],
  ['AJ3', 'Грузонапряженность'],
  ['AK3', 'Класс, код группы, диапaзон'],
  ['Y5', 'тип'],
  ['Z5', 'эпюра'],
  ['AA5', 'Наличие, шт.'],
  ['AC5', 'Количество негодных, шт.'],
  ['E6', 'От'],
  ['F6', 'Через'],
  ['G6', 'До'],
  ['H6', 'Полн.'],
  ['I6', 'Полезная'],
  ['J6', 'На конс.'],
  ['K6', 'Демонтаж'],
  ['L6', 'Р75'],
  ['M6', 'Р65'],
  ['N6', 'Р50'],
  ['O6', 'P49'],
  ['P6', 'Р43'],
  ['Q6', 'легче Р43'],
  ['R6', 'Всего'],
  ['S6', 'Р75'],
  ['T6', 'Р65'],
  ['U6', 'Р50'],
  ['V6', 'Род\nбалласта'],
  ['W6', 'Толщина, см'],
  ['X6', 'Загрязненность более 30%, м'],
  ['AA6', 'ЖБ'],
  ['AB6', 'ДЕР'],
  ['AC6', 'ЖБ'],
  ['AD6', 'ДЕР'],
  ['AE6', 'до укладки'],
  ['AF6', 'после укладки'],
  ['AG6', 'год'],
  ['AH6', 'вид'],
]

const TRACK_MERGES = [
  'A3:A6',
  'AA5:AB5',
  'AC5:AD5',
  'AE3:AF5',
  'AG3:AH5',
  'AI3:AI6',
  'AJ3:AJ6',
  'AK3:AK6',
  'B3:B6',
  'C3:C6',
  'D3:D6',
  'E1:X1',
  'E3:G5',
  'H3:K5',
  'L3:Q5',
  'R3:U5',
  'V3:X5',
  'Y1:AK1',
  'Y3:AD4',
  'Y5:Y6',
  'Z5:Z6',
]

/** Номера столбцов 1…n в строке под шапкой — признак отчёта BEx. */
function numbering(
  ws: ExcelJS.Worksheet,
  row: number,
  firstColumn: number,
  count: number,
  asText: boolean,
): void {
  for (let i = 0; i < count; i++)
    ws.getCell(row, firstColumn + i).value = asText ? String(i + 1) : i + 1
}

const TITLE_FORMULA = (start: string): ExcelJS.CellFormulaValue => ({
  formula: `"${start}"&CHAR(10)&VARS!C3&CHAR(10)&"на "&VARS!B5`,
  result: `${start}\n${ENTERPRISE}\nна 01.01.2026`,
})

function trackRow(s: FixtureStation, t: FixtureTrack, i: number): (string | number | null)[] {
  const welded = t.purpose === 'главный' ? Math.round(t.full * 0.6) : null
  return [
    s.name,
    t.purpose,
    '-',
    t.number,
    t.from,
    t.via,
    t.to,
    t.full,
    t.useful || null,
    null,
    null,
    null,
    t.full,
    null,
    null,
    null,
    null,
    welded,
    null,
    welded,
    null,
    'щеб',
    t.purpose === 'погр.-выгр.' ? '<25' : '25-34',
    null,
    'ЖБП',
    '1840',
    Math.round(t.full * 1.8),
    i % 2 === 0 ? 0 : 36,
    null,
    null,
    520,
    21.5 + i,
    String(1995 + i * 3),
    i % 2 === 0 ? 'Крс' : 'Крн',
    i === 0 ? '0/60' : '0/40',
    1.3,
    i === 0 ? '3V-' : '5--',
  ]
}

export async function stationTracksReport(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Экспликация стан путей', { views: [{ state: 'frozen', ySplit: 7 }] })
  header(ws, TRACK_HEADER, TRACK_MERGES)
  ws.getCell('E1').value = TITLE_FORMULA('Экспликация станционных путей')
  ws.getCell('Y1').value = TITLE_FORMULA('Экспликация станционных путей')
  numbering(ws, 7, 1, 37, false)
  for (const s of STATIONS.filter((x) => x.tracks.length > 0)) {
    for (const purpose of ['главный', 'приемо-отпр.', 'погр.-выгр.'] as const) {
      const group = s.tracks.filter((t) => t.purpose === purpose)
      group.forEach((t, i) => ws.addRow(trackRow(s, t, i)))
      // Строка итога по назначению — не путь, импорт её пропускает.
      const full = group.reduce((sum, t) => sum + t.full, 0)
      ws.addRow([
        s.name,
        `Итого по типу ${purpose}`,
        '',
        '',
        '',
        null,
        '',
        full,
        null,
        null,
        null,
        null,
        full,
      ])
    }
  }
  addBexService(wb, 'Экспликация станционных путей')
  return bytes(wb)
}

const SWITCH_HEADER: readonly (readonly [string, string])[] = [
  ['B3', 'Станция'],
  ['C3', '№ стр. \nперевода'],
  ['D3', 'Парк'],
  ['E3', 'Назначение \nпо ТРА путей'],
  ['F3', 'Путь'],
  ['G3', 'Направление'],
  ['H3', 'Находится в прямом или кривом участке пути'],
  ['I3', 'Дата укладки стрелочного перевода'],
  ['J3', 'Консервация/Демонтаж'],
  ['K3', 'Пропущенный тоннаж'],
  ['M3', 'Способ управления'],
  ['N3', 'Новый или \nпереложенный'],
  ['O3', 'Тип рельса'],
  ['P3', 'Крестовины'],
  ['U3', 'Скорость пасс.'],
  ['V3', 'Скорость груз.'],
  ['W3', 'Защита от снега '],
  ['X3', 'Род балласта'],
  ['Y3', 'Переводные брусья'],
  ['AC3', 'Шпалы'],
  ['AE3', 'Номер проекта'],
  ['AF3', 'Класс'],
  ['AG3', 'Дефект'],
  ['AH3', 'Грузонапряженность'],
  ['K4', 'до укладки'],
  ['L4', 'после укладки'],
  ['P4', 'марка'],
  ['Q4', 'род'],
  ['R4', 'дата укладки'],
  ['S4', 'Пропущенный тоннаж'],
  ['Y4', 'дата укладки'],
  ['Z4', 'тип'],
  ['AA4', 'количество, \nшт.'],
  ['AB4', 'негодных, \nшт.'],
  ['AC4', 'уложено шпал \nвместо брусьев, шт.'],
  ['AD4', 'негодных, \nшт.'],
  ['S5', 'до укладки'],
  ['T5', 'после укладки'],
]

const SWITCH_MERGES = [
  'AA4:AA5',
  'AB4:AB5',
  'AC3:AD3',
  'AC4:AC5',
  'AD4:AD5',
  'AE3:AE5',
  'AF3:AF5',
  'AG3:AG5',
  'AH3:AH5',
  'B3:B5',
  'C3:C5',
  'D3:D5',
  'E3:E5',
  'F1:L1',
  'F3:F5',
  'G3:G5',
  'H3:H5',
  'I3:I5',
  'J3:J5',
  'K3:L3',
  'K4:K5',
  'L4:L5',
  'M1:W1',
  'M3:M5',
  'N3:N5',
  'O3:O5',
  'P3:T3',
  'P4:P5',
  'Q4:Q5',
  'R4:R5',
  'S4:T4',
  'U3:U5',
  'V3:V5',
  'W3:W5',
  'X1:AH1',
  'X3:X5',
  'Y3:AB3',
  'Y4:Y5',
  'Z4:Z5',
]

export async function switchesReport(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Экспликация СТП', {
    views: [{ state: 'frozen', xSplit: 5, ySplit: 6 }],
  })
  header(ws, SWITCH_HEADER, SWITCH_MERGES)
  for (const address of ['F1', 'M1', 'X1'])
    ws.getCell(address).value = TITLE_FORMULA('Экспликация стрелочных переводов')
  numbering(ws, 6, 2, 33, true)
  for (const s of STATIONS.filter((x) => x.switches.length > 0)) {
    for (const purpose of ['главный', 'приемо-отпр.', 'погр.-выгр.'] as const) {
      const group = s.switches.filter((w) => w.purpose === purpose)
      group.forEach((w, i) => {
        const track =
          purpose === 'главный'
            ? (s.axes[0]?.line.name ?? '')
            : `Путь ${purpose} № ${w.track} на станции ${s.name}`
        const cross = w.side === 'сбп' ? '-' : '1/11'
        ws.addRow([
          null,
          s.name,
          w.number,
          '-',
          purpose,
          track,
          w.side,
          i % 2 === 0 ? 'прямой' : String(600 + i * 70),
          w.laid,
          ' ',
          0,
          24.2 + i,
          'эц',
          i % 2 === 0 ? 'Новые' : 'Переложенные',
          'Р65',
          cross,
          w.side === 'сбп' ? null : 'цельнолитая',
          w.side === 'сбп' ? null : w.laid,
          0,
          24.2 + i,
          purpose === 'главный' ? '90' : '40',
          purpose === 'главный' ? '80' : '40',
          'Электрообогрев',
          'щеб',
          w.laid,
          'БПЖ',
          w.side === 'сбп' ? 16 : 71,
          0,
          0,
          0,
          '2750.00.000',
          purpose === 'главный' ? '3' : '4',
          '-',
          1.3,
        ])
      })
      ws.addRow([
        null,
        null,
        'Итого по типу пути',
        null,
        group.length,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        group.length * 71,
        0,
        0,
        0,
      ])
    }
  }
  wb.addWorksheet('Методология').addRow(['Методика заполнения отчёта — см. регламент ЕК АСУИ'])
  addBexService(wb, 'Экспликация стрелочных переводов')
  return bytes(wb)
}
