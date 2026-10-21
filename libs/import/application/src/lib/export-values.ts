import { err, ok, type Result } from '@eow/shared/kernel'
import type {
  CellValue,
  ExportError,
  ExportLocation,
  ExportRow,
  ExportTable,
} from './export-source'
import { normalizeHeader } from './form-recognition'

/**
 * Так выгрузки записывают «значения нет» (раздел 8.3). «-1» сюда не входит: в части
 * столбцов это пустое значение, в части — число; решает разбор конкретной формы.
 */
const NO_DATA = new Set(['', 'нет данных', '-----'])

/** Текст ячейки без пробелов по краям; null — пусто или «Нет данных», «-----». */
export function textOf(v: CellValue): string | null {
  if (v === null) return null
  const t = String(v).replaceAll(/\s+/gu, ' ').trim()
  return NO_DATA.has(t.toLowerCase()) ? null : t
}

/** Число из «37.0», «37,5», « 12 » или числовой ячейки; null — пусто; undefined — не число. */
export function numberOf(v: CellValue): number | null | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const t = textOf(v)
  if (t === null) return null
  if (!/^[-+]?\d+(?:[.,]\d+)?$/u.test(t)) return undefined
  return Number(t.replace(',', '.'))
}

/** «31.12.9999» в выгрузке означает открытый период. */
export const OPEN_END_DATE = '9999-12-31'

/** Дата ГГГГ-ММ-ДД из «дд.мм.гггг» или даты xlsx; null — пусто; undefined — не дата. */
export function dateOf(v: CellValue): string | null | undefined {
  const t = textOf(v)
  if (t === null) return null
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(t)
  const iso = ru ? `${ru[3]}-${ru[2]}-${ru[1]}` : /^\d{4}-\d{2}-\d{2}$/u.test(t) ? t : undefined
  if (!iso) return undefined
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1))
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d
    ? iso
    : undefined
}

/** Индекс столбца по заголовку; второе вхождение того же заголовка называется «… (2)». */
export function columnIndex(table: ExportTable, header: string): number {
  const name = normalizeHeader(header).toLowerCase()
  return table.columns.findIndex((c) => c.name.toLowerCase() === name)
}

export function locate(table: ExportTable, row: ExportRow, index: number): ExportLocation {
  const column = table.columns[index]
  return {
    file: table.file,
    sheet: table.sheet,
    row: row.line,
    ...(column ? { column: column.letter, header: column.name } : {}),
  }
}

function badValue(
  table: ExportTable,
  row: ExportRow,
  index: number,
  value: CellValue,
  expected: string,
): ExportError {
  return { kind: 'bad-value', at: locate(table, row, index), value: String(value), expected }
}

function cellAt(table: ExportTable, row: ExportRow, header: string): [number, CellValue] {
  const index = columnIndex(table, header)
  return [index, index < 0 ? null : (row.cells[index] ?? null)]
}

/** Число из столбца строки; ошибка указывает файл, лист, строку и столбец. */
export function numberAt(
  table: ExportTable,
  row: ExportRow,
  header: string,
): Result<number | null, ExportError> {
  const [index, value] = cellAt(table, row, header)
  const n = numberOf(value)
  return n === undefined ? err(badValue(table, row, index, value, 'число')) : ok(n)
}

/** Дата ГГГГ-ММ-ДД из столбца строки. */
export function dateAt(
  table: ExportTable,
  row: ExportRow,
  header: string,
): Result<string | null, ExportError> {
  const [index, value] = cellAt(table, row, header)
  const d = dateOf(value)
  return d === undefined ? err(badValue(table, row, index, value, 'дата дд.мм.гггг')) : ok(d)
}

export function textAt(table: ExportTable, row: ExportRow, header: string): string | null {
  return textOf(cellAt(table, row, header)[1])
}
