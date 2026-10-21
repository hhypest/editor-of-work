import { err, ok, type Result } from '@eow/shared/kernel'
import type {
  ExportError,
  ExportLocation,
  ExportRow,
  ExportTable,
  PassportForm,
} from './export-source'
import { columnIndex, dateAt, locate, numberAt, OPEN_END_DATE, textAt } from './export-values'

/** Период действия строки выгрузки; «31.12.9999» — открытый конец. */
export interface Validity {
  readonly from: string | null
  readonly to: string
}

export interface ExportPoint {
  readonly km: number
  readonly m: number
}

/** Разбор строк формы: ошибки копятся, чтобы показать их все сразу. */
export class RowReader {
  readonly errors: ExportError[] = []
  constructor(
    readonly table: ExportTable,
    readonly row: ExportRow,
  ) {}

  text(header: string): string | null {
    return textAt(this.table, this.row, header)
  }

  required(header: string): string {
    const t = this.text(header)
    if (t === null) this.missing(header)
    return t ?? ''
  }

  integer(header: string): number {
    const r = numberAt(this.table, this.row, header)
    if (!r.ok) {
      this.errors.push(r.error)
      return 0
    }
    if (r.value === null || !Number.isInteger(r.value) || r.value < 0) {
      this.bad(header, 'целое неотрицательное число')
      return 0
    }
    return r.value
  }

  /** Число или null для пустого значения; не число — ошибка с местом. */
  number(header: string): number | null {
    const r = numberAt(this.table, this.row, header)
    if (r.ok) return r.value
    this.errors.push(r.error)
    return null
  }

  date(header: string): string | null {
    const r = dateAt(this.table, this.row, header)
    if (r.ok) return r.value
    this.errors.push(r.error)
    return null
  }

  /** Период действия; конец раньше начала — ошибка в столбце конца, а не молча пропавшая строка. */
  validity(fromHeader: string, toHeader: string): Validity {
    const from = this.date(fromHeader)
    const to = this.date(toHeader) ?? OPEN_END_DATE
    if (from !== null && to < from) this.bad(toHeader, `дата конца не раньше начала (${from})`)
    return { from, to }
  }

  /** Значение из списка допустимых; иное, в том числе пусто, — ошибка с местом. */
  oneOf<T extends string>(header: string, allowed: readonly [T, ...T[]]): T {
    const t = this.text(header)?.toUpperCase() ?? ''
    const found = allowed.find((a) => a.toUpperCase() === t)
    if (found === undefined) this.bad(header, allowed.map((a) => `«${a}»`).join(' или '))
    return found ?? allowed[0]
  }

  point(kmHeader: string, mHeader: string): ExportPoint {
    return { km: this.integer(kmHeader), m: this.integer(mHeader) }
  }

  location(): ExportLocation {
    return locate(this.table, this.row, -1)
  }

  private missing(header: string): void {
    this.bad(header, 'непустое значение')
  }

  bad(header: string, expected: string): void {
    const index = columnIndex(this.table, header)
    const value = index < 0 ? '' : String(this.row.cells[index] ?? '')
    this.errors.push({
      kind: 'bad-value',
      at: locate(this.table, this.row, index),
      value,
      expected,
    })
  }
}

export function parseRows<T>(
  table: ExportTable,
  form: PassportForm,
  read: (r: RowReader) => T,
): Result<T[], readonly ExportError[]> {
  if (table.form !== form) throw new Error(`ожидалась форма ${form}, получена ${table.form}`)
  const out: T[] = []
  const errors: ExportError[] = []
  for (const row of table.rows) {
    const reader = new RowReader(table, row)
    const value = read(reader)
    if (reader.errors.length > 0) errors.push(...reader.errors)
    else out.push(value)
  }
  return errors.length > 0 ? err(errors) : ok(out)
}

/** Форма «Подразделения» (список эксплуатационных и линейных участков, цехов). */
