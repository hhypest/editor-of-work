import type { Result } from '@eow/shared/kernel'

/**
 * Формы паспорта ЕК АСУИ (docs/architecture.md, раздел 8.3). Форма узнаётся по набору
 * заголовков, а не по имени файла: номер файла меняется при каждой выгрузке.
 */
export const PASSPORT_FORMS = [
  'subdivisions',
  'boundaries',
  'station-pd',
  'track-pd',
  'station-axes',
  'okato',
  'class',
  'load',
  'speeds',
  'rails',
  'sleepers',
  'ballast',
  'crossings-general',
  'crossings-technical',
  'crossings-operational',
  'station-tracks',
  'switches',
] as const

export type PassportForm = (typeof PASSPORT_FORMS)[number]

/** Значение ячейки после чтения: текст, число или дата ГГГГ-ММ-ДД; null — пусто. */
export type CellValue = string | number | null

/** Где в файле лежит значение: для текста ошибки «файл, лист, строка, столбец». */
export interface ExportLocation {
  readonly file: string
  readonly sheet: string
  /** Номер строки на листе, с 1. */
  readonly row?: number
  /** Буква столбца, как в Excel: «A», «AK». */
  readonly column?: string
  /** Заголовок столбца, если он известен. */
  readonly header?: string
}

export interface ExportColumn {
  /** Нормализованный заголовок: переносы и лишние пробелы убраны, уровни шапки BEx — через « / ». */
  readonly name: string
  /** Буква столбца на листе. */
  readonly letter: string
}

export interface ExportRow {
  /** Номер строки на листе, с 1. */
  readonly line: number
  /** Значения по столбцам шапки, в том же порядке. */
  readonly cells: readonly CellValue[]
}

/** Таблица выгрузки: шапка и строки данных одного листа. */
export interface ExportTable {
  readonly file: string
  readonly sheet: string
  readonly form: PassportForm
  readonly columns: readonly ExportColumn[]
  readonly rows: readonly ExportRow[]
}

export type ExportFileKind = 'xlsx' | 'web-xls' | 'frameset' | 'binary-xls' | 'unknown'

export type ExportError =
  | { readonly kind: 'binary-xls'; readonly file: string }
  | { readonly kind: 'unknown-file'; readonly file: string }
  | { readonly kind: 'missing-part'; readonly file: string; readonly part: string }
  | { readonly kind: 'broken-file'; readonly file: string; readonly detail: string }
  | { readonly kind: 'no-table'; readonly file: string }
  /** Таблица оборвана: нет конца таблицы. rows — сколько строк данных прочитано целиком. */
  | {
      readonly kind: 'truncated'
      readonly file: string
      readonly rows: number
      readonly length: number
    }
  | {
      readonly kind: 'unknown-form'
      readonly at: ExportLocation
      readonly headers: readonly string[]
    }
  | {
      readonly kind: 'ambiguous-form'
      readonly at: ExportLocation
      readonly forms: readonly PassportForm[]
    }
  | {
      readonly kind: 'bad-value'
      readonly at: ExportLocation
      readonly value: string
      readonly expected: string
    }

export const FORM_TITLES: Readonly<Record<PassportForm, string>> = {
  subdivisions: 'Подразделения',
  boundaries: 'Границы подразделений',
  'station-pd': 'Станции → ПД',
  'track-pd': 'Станционные пути → ПД',
  'station-axes': 'Оси станций',
  okato: 'ОКАТО',
  class: 'Класс пути',
  load: 'Грузонапряжённость',
  speeds: 'Скорости',
  rails: 'Рельсы',
  sleepers: 'Шпалы и скрепления',
  ballast: 'Балласт',
  'crossings-general': 'Переезды: общие данные',
  'crossings-technical': 'Переезды: технические данные',
  'crossings-operational': 'Переезды: эксплуатационные характеристики',
  'station-tracks': 'Экспликация станционных путей',
  switches: 'Экспликация стрелочных переводов',
}

/** «файл «X», лист «Y», строка 5, столбец D («Номер»)». */
export function describeLocation(at: ExportLocation): string {
  const parts = [`файл «${at.file}»`, `лист «${at.sheet}»`]
  if (at.row !== undefined) parts.push(`строка ${at.row}`)
  if (at.column !== undefined)
    parts.push(at.header ? `столбец ${at.column} («${at.header}»)` : `столбец ${at.column}`)
  return parts.join(', ')
}

/** «1048576» → «1 048 576» без зависимости от локали. */
function groupDigits(n: number): string {
  return String(n).replaceAll(/\B(?=(\d{3})+$)/gu, ' ')
}

export function describeExportError(e: ExportError): string {
  switch (e.kind) {
    case 'binary-xls':
      return `Файл «${e.file}» сохранён в старом двоичном формате Excel 97–2003. Откройте его в Excel и пересохраните в xlsx («Книга Excel»), затем загрузите снова`
    case 'unknown-file':
      return `Файл «${e.file}» не похож на выгрузку ЕК АСУИ: ожидается xlsx или «веб-страничный» xls`
    case 'missing-part':
      return `Для файла «${e.file}» не найден «${e.part}»: выберите вместе с файлом его папку «.files»`
    case 'broken-file':
      return `Файл «${e.file}» повреждён: ${e.detail}`
    case 'truncated':
      return `Файл «${e.file}» обрезан: таблица оборвана после ${e.rows} строк данных (${groupDigits(e.length)} символов). ЕК АСУИ обрезает слишком длинную выгрузку. Выгрузите форму частями, например по направлениям, и загрузите все части`
    case 'no-table':
      return `В файле «${e.file}» нет таблицы с данными`
    case 'unknown-form':
      return `Не удалось определить форму: ${describeLocation(e.at)}. Заголовки: ${e.headers.slice(0, 8).join('; ')}`
    case 'ambiguous-form':
      return `Заголовки подходят сразу к нескольким формам (${e.forms.map((f) => FORM_TITLES[f]).join(', ')}): ${describeLocation(e.at)}`
    case 'bad-value':
      return `Ожидается ${e.expected}, а записано «${e.value}»: ${describeLocation(e.at)}`
  }
}

/** Файл, выбранный пользователем; для frameset нужен доступ к соседней папке «.files». */
export interface ExportFile {
  readonly name: string
  readonly bytes: Uint8Array
  /** Прочитать файл по пути относительно этого файла; undefined — файла нет. */
  readonly sibling?: (relativePath: string) => Promise<Uint8Array | undefined>
}

/**
 * Чтение выгрузок в сырые таблицы с распознанной формой. Реализация — в инфраструктуре
 * импорта (main-процесс): xlsx, «веб-страничный» xls и frameset; двоичный xls — ошибка.
 */
export interface ExportSource {
  read(file: ExportFile): Promise<Result<readonly ExportTable[], ExportError>>
}
