import type { Result } from '@eow/shared/kernel'

/**
 * Модель книги xlsx (#32, ADR-0052): то, что выгрузка знает о книге без ExcelJS. Слой
 * приложения считает значения и формулы, адаптер в main только записывает их.
 */
export interface CellStyle {
  readonly bold?: boolean | undefined
  /** Кегль, пт. */
  readonly size?: number | undefined
  /** Цвет текста и заливки — `#rrggbb`. */
  readonly color?: string | undefined
  readonly fill?: string | undefined
  readonly border?: boolean | undefined
  readonly wrap?: boolean | undefined
  readonly align?: 'left' | 'center' | 'right' | undefined
  /** Формат числа Excel: «0.000», «#,##0». */
  readonly format?: string | undefined
}

/** Значение ячейки или формула с результатом, посчитанным в приложении. */
export type WorkbookCell =
  | { readonly value: string | number; readonly style?: CellStyle | undefined }
  | {
      readonly formula: string
      readonly result: string | number
      readonly style?: CellStyle | undefined
    }
  | { readonly style: CellStyle }

export interface WorkbookSheet {
  readonly name: string
  /** Ширины столбцов в знаках Excel, слева направо. */
  readonly columns: readonly number[]
  /** Строки сверху вниз; null — пустая ячейка. */
  readonly rows: readonly (readonly (WorkbookCell | null)[])[]
  /** Высота строки по её номеру с 1, пт. */
  readonly heights?: Readonly<Record<number, number>> | undefined
  /** Объединения в адресах A1: «B6:B7». */
  readonly merges?: readonly string[] | undefined
  /** Закреплённые строки сверху и столбцы слева. */
  readonly freeze?: { readonly rows: number; readonly columns: number } | undefined
  readonly print: {
    readonly orientation: 'portrait' | 'landscape'
    /** Вписать в один лист по ширине; по высоте — тоже, если onePage. */
    readonly onePage: boolean
  }
}

export interface Workbook {
  readonly sheets: readonly WorkbookSheet[]
}

/** Порт сохранения книги: путь выбирает и пишет main. */
export interface SpreadsheetClient {
  save(
    fileName: string,
    workbook: Workbook,
  ): Promise<Result<'saved' | 'cancelled', { readonly message: string }>>
}

/** Буква столбца по номеру с 1: 1 → A, 27 → AA. */
export function columnName(index: number): string {
  let name = ''
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

/** Ссылка на лист в формуле: «'Границы ПД'!», «Станции!». */
export function sheetRef(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? `${name}!` : `'${name.replaceAll("'", "''")}'!`
}

/** Строка в формуле: кавычки удваиваются. */
export const formulaText = (value: string): string => `"${value.replaceAll('"', '""')}"`

/**
 * Функции, которые разрешено писать в формулах книги: все есть в Excel 2007, кроме того
 * адаптер отвергает ссылки на другие книги.
 */
export const WORKBOOK_FUNCTIONS = [
  'SUM',
  'SUMIFS',
  'COUNTIFS',
  'COUNTIF',
  'INDEX',
  'MATCH',
  'CHAR',
  'T',
] as const
