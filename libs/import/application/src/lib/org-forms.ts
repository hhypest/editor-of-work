import type { Result } from '@eow/shared/kernel'
import type { ExportError, ExportLocation, ExportTable } from './export-source'
import { parseRows } from './row-reader'

import type { ExportPoint, Validity } from './row-reader'
export type { ExportPoint, Validity } from './row-reader'

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
    statedLength: r.measurement('Длина участка, м'),
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
