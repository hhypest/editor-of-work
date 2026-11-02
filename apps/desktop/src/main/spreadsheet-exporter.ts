import ExcelJS from 'exceljs'
import type { CellStyle, Workbook } from '@eow/documents/application'

const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`
const thin = { style: 'thin', color: { argb: 'FF808080' } } as const

/**
 * SpreadsheetExporter (ADR-0052): модель книги → xlsx ExcelJS. Формулы пишутся вместе с
 * результатами, посчитанными приложением; Excel пересчитывает книгу при открытии.
 */
export async function workbookToXlsx(model: Workbook): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook()
  book.creator = 'editor-of-work'
  book.calcProperties.fullCalcOnLoad = true
  for (const sheet of model.sheets) {
    const ws = book.addWorksheet(sheet.name, {
      views: sheet.freeze
        ? [{ state: 'frozen', xSplit: sheet.freeze.columns, ySplit: sheet.freeze.rows }]
        : [],
      pageSetup: {
        paperSize: 9,
        orientation: sheet.print.orientation,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: sheet.print.onePage ? 1 : 0,
        horizontalCentered: true,
        margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
      },
    })
    ws.columns = sheet.columns.map((width) => ({ width }))
    for (const [r, row] of sheet.rows.entries())
      for (const [c, cell] of row.entries()) {
        if (!cell) continue
        const target = ws.getCell(r + 1, c + 1)
        if ('formula' in cell)
          target.value = { formula: cell.formula.slice(1), result: cell.result }
        else if ('value' in cell) target.value = cell.value
        if (cell.style) apply(target, cell.style)
      }
    for (const [row, height] of Object.entries(sheet.heights ?? {}))
      ws.getRow(Number(row)).height = height
    for (const range of sheet.merges ?? []) ws.mergeCells(range)
  }
  return new Uint8Array(await book.xlsx.writeBuffer())
}

function apply(cell: ExcelJS.Cell, style: CellStyle): void {
  cell.font = {
    name: 'Arial',
    size: style.size ?? 10,
    ...(style.bold ? { bold: true } : {}),
    ...(style.color ? { color: { argb: argb(style.color) } } : {}),
  }
  if (style.fill)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(style.fill) } }
  if (style.border) cell.border = { top: thin, left: thin, bottom: thin, right: thin }
  cell.alignment = {
    vertical: 'middle',
    ...(style.wrap ? { wrapText: true } : {}),
    ...(style.align ? { horizontal: style.align } : {}),
  }
  if (style.format) cell.numFmt = style.format
}
