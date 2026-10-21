import type { CellValue } from '@eow/import/application'

/** Объединение ячеек: строки и столбцы с 1, включительно. */
export interface MergeRange {
  readonly top: number
  readonly left: number
  readonly bottom: number
  readonly right: number
}

/** Лист как сетка значений: строки и столбцы с 1. Источник — xlsx или HTML-таблица. */
export interface Sheet {
  readonly name: string
  readonly visible: boolean
  readonly cells: ReadonlyMap<number, ReadonlyMap<number, CellValue>>
  readonly merges: readonly MergeRange[]
}

export function cell(sheet: Sheet, row: number, col: number): CellValue {
  return sheet.cells.get(row)?.get(col) ?? null
}

export function rowNumbers(sheet: Sheet): number[] {
  return [...sheet.cells.keys()].toSorted((a, b) => a - b)
}

/** Буква столбца Excel: 1 → A, 27 → AA. */
export function columnLetter(col: number): string {
  let n = col
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCodePoint(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** «AB12» → { row: 12, col: 28 }. */
export function parseAddress(
  ref: string,
): { readonly row: number; readonly col: number } | undefined {
  const m = /^([A-Z]+)(\d+)$/u.exec(ref)
  if (!m?.[1] || !m[2]) return undefined
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.codePointAt(0) ?? 64) - 64
  return { row: Number(m[2]), col }
}

export function parseRange(ref: string): MergeRange | undefined {
  const [a, b = a] = ref.split(':')
  const from = a ? parseAddress(a) : undefined
  const to = b ? parseAddress(b) : undefined
  return from && to ? { top: from.row, left: from.col, bottom: to.row, right: to.col } : undefined
}

export class SheetBuilder {
  private readonly rows = new Map<number, Map<number, CellValue>>()
  readonly merges: MergeRange[] = []

  set(row: number, col: number, value: CellValue): void {
    if (value === null || value === '') return
    let r = this.rows.get(row)
    if (!r) {
      r = new Map()
      this.rows.set(row, r)
    }
    r.set(col, value)
  }

  build(name: string, visible: boolean): Sheet {
    return { name, visible, cells: this.rows, merges: this.merges }
  }
}
