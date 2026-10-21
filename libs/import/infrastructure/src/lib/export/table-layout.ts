import {
  normalizeHeader,
  type CellValue,
  type ExportColumn,
  type ExportRow,
} from '@eow/import/application'
import { cell, columnLetter, rowNumbers, type MergeRange, type Sheet } from './sheet'

/** Шапка листа и строки данных под ней. */
export interface TableLayout {
  readonly columns: readonly ExportColumn[]
  /** Номера столбцов листа для каждого столбца шапки. */
  readonly sourceColumns: readonly number[]
  readonly rows: readonly ExportRow[]
}

function columnsOf(sheet: Sheet, row: number): number[] {
  return [...(sheet.cells.get(row)?.keys() ?? [])].toSorted((a, b) => a - b)
}

/**
 * Строка номеров столбцов «1, 2, 3, …» под шапкой — признак отчёта BEx.
 * Номера могут быть числами или текстом и начинаться не с первого столбца.
 */
function numberingRow(sheet: Sheet): number | undefined {
  for (const row of rowNumbers(sheet).slice(0, 30)) {
    const cols = columnsOf(sheet, row)
    if (cols.length < 5) continue
    const ok = cols.every((c, i) => {
      const v = cell(sheet, row, c)
      return Number(v) === i + 1 && c === (cols[0] ?? 0) + i
    })
    if (ok) return row
  }
  return undefined
}

function mergeAt(merges: readonly MergeRange[], row: number, col: number): MergeRange | undefined {
  return merges.find((m) => row >= m.top && row <= m.bottom && col >= m.left && col <= m.right)
}

/** Значение с учётом объединения: внутри объединённой области — значение её левой верхней ячейки. */
function mergedValue(sheet: Sheet, row: number, col: number): CellValue {
  const m = mergeAt(sheet.merges, row, col)
  return m ? cell(sheet, m.top, m.left) : cell(sheet, row, col)
}

/**
 * Строки шапки над строкой номеров: идём вверх, пока строка непуста или покрыта
 * объединением из шапки. Пустая строка вне объединений отделяет шапку от заголовка отчёта.
 */
function headerRows(sheet: Sheet, numbering: number, cols: readonly number[]): number[] {
  const rows: number[] = []
  for (let r = numbering - 1; r >= 1; r--) {
    const filled = cols.some((c) => cell(sheet, r, c) !== null)
    const covered = cols.some((c) => {
      const m = mergeAt(sheet.merges, r, c)
      return m !== undefined && m.bottom > r && m.bottom < numbering
    })
    if (!filled && !covered) break
    rows.unshift(r)
  }
  return rows
}

function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((n) => {
    const k = n.toLowerCase()
    const count = (seen.get(k) ?? 0) + 1
    seen.set(k, count)
    return count === 1 ? n : `${n} (${count})`
  })
}

function dataRows(sheet: Sheet, after: number, cols: readonly number[]): ExportRow[] {
  return rowNumbers(sheet)
    .filter((r) => r > after)
    .map((r) => ({ line: r, cells: cols.map((c) => cell(sheet, r, c)) }))
    .filter((r) => r.cells.some((v) => v !== null))
}

/** Отчёт BEx: многоуровневая шапка собирается в имена «Уровень 1 / Уровень 2». */
function bexLayout(sheet: Sheet, numbering: number): TableLayout {
  const cols = columnsOf(sheet, numbering)
  const levels = headerRows(sheet, numbering, cols)
  const names = cols.map((c) => {
    const path: string[] = []
    for (const r of levels) {
      const v = mergedValue(sheet, r, c)
      const t = v === null ? '' : normalizeHeader(String(v))
      if (t && path.at(-1) !== t) path.push(t)
    }
    return path.join(' / ')
  })
  return {
    columns: uniqueNames(names).map((name, i) => ({ name, letter: columnLetter(cols[i] ?? 1) })),
    sourceColumns: cols,
    rows: dataRows(sheet, numbering, cols),
  }
}

/** Плоская таблица: шапка — первая непустая строка. */
function flatLayout(sheet: Sheet): TableLayout | undefined {
  const head = rowNumbers(sheet)[0]
  if (head === undefined) return undefined
  const cols = columnsOf(sheet, head)
  const last = cols.at(-1) ?? 0
  // Пустые заголовки посередине сохраняются, чтобы номера столбцов совпадали с листом.
  const all = Array.from({ length: last }, (_, i) => i + 1)
  const names = all.map((c) => {
    const v = cell(sheet, head, c)
    return v === null ? '' : normalizeHeader(String(v))
  })
  return {
    columns: uniqueNames(names).map((name, i) => ({ name, letter: columnLetter(all[i] ?? 1) })),
    sourceColumns: all,
    rows: dataRows(sheet, head, all),
  }
}

export function tableLayout(sheet: Sheet): TableLayout | undefined {
  const numbering = numberingRow(sheet)
  return numbering === undefined ? flatLayout(sheet) : bexLayout(sheet, numbering)
}
