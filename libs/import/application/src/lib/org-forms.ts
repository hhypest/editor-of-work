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

export interface ImportedSubdivision {
  readonly code: string
  /** «Ид подразделения» ЕК АСУИ. */
  readonly externalId: string
  readonly type: string
  readonly activity: string | null
  /** Номер из столбца «Номер»: по типу и номеру находится вышестоящее подразделение. */
  readonly number: number | null
  /**
   * Вышестоящее подразделение по типу и номеру. В выгрузке оно записано как
   * «<предприятие>, ПЧУ-01»: номер с ведущим нулём, а код самого ПЧУ — «ПЧУ-1».
   * null — подчиняется предприятию (дистанции).
   */
  readonly parent: { readonly type: string; readonly number: number; readonly text: string } | null
  readonly validity: Validity
  readonly at: ExportLocation
}

export interface ImportedBoundary {
  readonly subdivision: string
  readonly line: string
  readonly from: ExportPoint
  readonly to: ExportPoint
  /**
   * «Длина участка, м» из выгрузки. Сверить её с координатами можно только по длинам
   * километров направления — это делает сверка длин вместе с характеристиками (#17).
   */
  readonly statedLength: number | null
  readonly validity: Validity
  readonly at: ExportLocation
}

export interface ImportedStationPd {
  readonly subdivision: string
  readonly station: string
  readonly validity: Validity
  readonly at: ExportLocation
}

export interface ImportedTrackPd {
  readonly subdivision: string
  readonly station: string
  readonly track: string
  /** null — весь путь; иначе метры пути от его начала. */
  readonly meters: { readonly start: number; readonly end: number } | null
  readonly validity: Validity
  readonly at: ExportLocation
}

/** Разбор строк формы: ошибки копятся, чтобы показать их все сразу. */
class RowReader {
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

  private bad(header: string, expected: string): void {
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

function parseRows<T>(
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
/** «ИЧ-0 УЧЕБНАЯ П, ПЧУ-01» → ПЧУ № 1; без подразделения после запятой — предприятие. */
export function parseParent(text: string | null): ImportedSubdivision['parent'] {
  if (!text?.includes(',')) return null
  const last = text.split(',').at(-1)?.trim() ?? ''
  const m = /^([А-ЯЁA-Z]+)-0*(\d+)$/u.exec(last)
  if (!m?.[1] || !m[2]) return null
  return { type: m[1], number: Number(m[2]), text: last }
}

export function parseSubdivisions(
  table: ExportTable,
): Result<ImportedSubdivision[], readonly ExportError[]> {
  return parseRows(table, 'subdivisions', (r) => ({
    // У части подразделений (ПЧДЕФ) столбец «Подразделение» пуст — код берётся из «Тип+номер».
    code: r.text('Подразделение') ?? r.required('Тип+номер'),
    externalId: r.required('Ид подразделения'),
    type: r.required('Тип подразделения'),
    activity: r.text('Вид деятельности'),
    number: r.text('Номер') === null ? null : r.integer('Номер'),
    parent: parseParent(r.text('Подчиняется')),
    validity: r.validity('Начало действия', 'Конец действия'),
    at: r.location(),
  }))
}

/** Форма «Границы подразделений»: отрезки главных путей. */
export function parseBoundaries(
  table: ExportTable,
): Result<ImportedBoundary[], readonly ExportError[]> {
  return parseRows(table, 'boundaries', (r) => ({
    subdivision: r.required('Подразделение'),
    line: r.required('Главный путь'),
    from: r.point('КМ н.', 'М н.'),
    to: r.point('КМ к.', 'М к.'),
    statedLength: r.number('Длина участка, м'),
    validity: r.validity('Дата начала действия', 'Дата конца действия'),
    at: r.location(),
  }))
}

/** Форма «Станции → ПД». */
export function parseStationPd(
  table: ExportTable,
): Result<ImportedStationPd[], readonly ExportError[]> {
  return parseRows(table, 'station-pd', (r) => ({
    subdivision: r.required('Подразделение'),
    station: r.required('Станция'),
    validity: r.validity('Начало действия', 'Конец действия'),
    at: r.location(),
  }))
}

/** Форма «Станционные пути → ПД»: весь путь или метры от его начала. */
export function parseTrackPd(
  table: ExportTable,
): Result<ImportedTrackPd[], readonly ExportError[]> {
  return parseRows(table, 'track-pd', (r) => {
    // Только «Д» или «Н»: пустой или иной признак не должен молча отдать ПД весь путь.
    const whole = r.oneOf('Признак - весь путь', ['Д', 'Н']) === 'Д'
    return {
      subdivision: r.required('Подразделение'),
      station: r.required('Станция'),
      track: r.required('Путь'),
      meters: whole ? null : { start: r.integer('Метр начала'), end: r.integer('Метр конца') },
      validity: r.validity('Начало действия', 'Конец действия'),
      at: r.location(),
    }
  })
}
