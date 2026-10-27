import { err, ok, type Result } from '@eow/shared/kernel'
import type { PlanSheetData } from '@eow/planning/sheet-api'
import type { SheetPrimitive, SheetError, TextMeasurer } from './sheet-model'
import { bold, regular, wrapText } from './sheet-text'
import { sheetLine, sheetRect, sheetText } from './sheet-drawing'

export type SheetTable = PlanSheetData['pds'][number]['tables'][number]
export interface MeasuredTableRow {
  readonly height: number
  readonly primitives: readonly SheetPrimitive[]
}
export interface MeasuredTable {
  readonly title: string
  readonly header: MeasuredTableRow
  readonly rows: readonly MeasuredTableRow[]
  /**
   * Вариант строки без повторной подписи группы: есть только у строки, продолжающей группу
   * предыдущей. В начале страницы печатается полная строка из rows.
   */
  readonly continued: readonly (MeasuredTableRow | undefined)[]
}
/** Все строки измерены до пагинации; размер шрифта не уменьшается ниже 2,5 мм. */
export function measureTable(
  table: SheetTable,
  measurer: TextMeasurer,
): Result<MeasuredTable, SheetError> {
  if (
    !table.columns.length ||
    table.columns.some((c) => !Number.isFinite(c.width) || c.width < 8) ||
    Math.abs(table.columns.reduce((s, c) => s + c.width, 0) - 390) > 0.001
  )
    return err({ message: 'Ширина столбцов таблицы должна составлять 390 мм.' })
  const group = table.groupColumn
  if (
    group !== undefined &&
    (!Number.isInteger(group) || group < 0 || group >= table.columns.length)
  )
    return err({ message: 'Столбец группы отсутствует в таблице.' })
  const row = (cells: readonly string[], header: boolean): Result<MeasuredTableRow, SheetError> => {
    if (cells.length !== table.columns.length)
      return err({ message: 'Число ячеек не совпадает с заголовком таблицы.' })
    const wrapped: (readonly string[])[] = []
    const font = header ? bold(2.5) : regular(2.5)
    for (const [i, cell] of cells.entries()) {
      const column = table.columns[i]
      if (!column) return err({ message: 'Столбец таблицы отсутствует.' })
      const lines = wrapText(cell, column.width - 4, font, measurer)
      if (!lines.ok) return lines
      wrapped.push(lines.value)
    }
    const height = Math.max(9, ...wrapped.map((s) => s.length * 3.5 + 4))
    if (height > 160)
      return err({
        message: `Строка таблицы «${table.title}» выше области листа. Сократите текст.`,
      })
    const primitives: SheetPrimitive[] = [sheetRect(15, 0, 390, height, header)]
    let x = 15
    for (const [i, column] of table.columns.entries()) {
      primitives.push(
        sheetLine(x, 0, x, height),
        ...(wrapped[i] ?? []).map((s, n) => sheetText(s, x + 2, 4 + n * 3.5, font)),
      )
      x += column.width
    }
    return ok({ height, primitives })
  }
  const header = row(
    table.columns.map((c) => c.title),
    true,
  )
  if (!header.ok) return header
  const rows: MeasuredTableRow[] = [],
    continued: (MeasuredTableRow | undefined)[] = []
  for (const [index, cells] of table.rows.entries()) {
    const r = row(cells, false)
    if (!r.ok) return r
    rows.push(r.value)
    if (group === undefined || !cells[group] || table.rows[index - 1]?.[group] !== cells[group]) {
      continued.push(undefined)
      continue
    }
    const blank = row(cells.with(group, ''), false)
    if (!blank.ok) return blank
    continued.push(blank.value)
  }
  return ok({ title: table.title, header: header.value, rows, continued })
}
