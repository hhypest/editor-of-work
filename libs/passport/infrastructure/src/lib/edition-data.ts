import { createHash } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { EditionData, PlanningEditionData } from '@eow/passport/application'
import { readManualBasis } from './manual-data-storage'
import { readOrgData, type PassportSchema } from './org-import-storage'
import { readSegmentData } from './segment-import-storage'
import { readStationBasis, readStationData } from './station-import-storage'

const current = (
  row: { valid_from: string | null; valid_to: string | null },
  date: string,
): boolean =>
  (row.valid_from === null || row.valid_from <= date) &&
  (row.valid_to === null || row.valid_to >= date)

/**
 * Полный срез данных редакции для просмотра и сравнения.
 * Читается одной транзакцией вызывающего кода; в отличие от среза расчёта
 * ремонтов строки не отбираются по дате — период действия показывается в таблицах.
 */
export async function readEditionData(
  db: Kysely<PassportSchema>,
  editionId: number,
  currentOnly = false,
): Promise<EditionData | undefined> {
  const edition = await db
    .selectFrom('edition')
    .selectAll()
    .where('id', '=', editionId)
    .executeTakeFirst()
  if (!edition) return undefined
  const lines = await db
    .selectFrom('line')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const extents = await db
    .selectFrom('line_extent')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const kilometres = await db
    .selectFrom('line_km')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('km')
    .execute()
  const segments = await readSegmentData(db, editionId)
  const stations = await readStationData(db, editionId)
  const manual = await readManualBasis(db, editionId)
  // Редакция проверена выше: основа ручных данных не может отсутствовать.
  if (!manual) throw new Error('edition data inconsistent')
  const org = await readOrgData(db, editionId)
  return {
    edition: {
      id: edition.id,
      number: edition.number,
      date: edition.date,
      label: edition.label,
      status: edition.status,
    },
    lines: lines
      .filter((l) => !currentOnly || current(l, edition.date))
      .map((l) => ({
        id: l.id,
        name: l.name,
        extents: extents
          .filter((e) => e.line_id === l.id && (!currentOnly || current(e, edition.date)))
          .map((e) => ({
            from: { km: e.start_km, m: e.start_m },
            to: { km: e.end_km, m: e.end_m },
          })),
        kmLengths: kilometres
          .filter((k) => k.line_id === l.id && (!currentOnly || current(k, edition.date)))
          .map((k) => [k.km, k.length_m] as const),
      })),
    segments,
    stations,
    manual: manual.data,
    org,
  }
}

/** Вызывается в одной транзакции. Исключённые станции не возвращаются в план. */
export async function readPlanningData(
  db: Kysely<PassportSchema>,
  editionId: number,
): Promise<PlanningEditionData | undefined> {
  const data = await readEditionData(db, editionId, true)
  if (!data) return undefined
  const basis = await readStationBasis(db, editionId)
  const excluded = new Set(basis?.excludedStations.map((s) => s.name) ?? [])
  const stations = await db
    .selectFrom('station')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const tracks = await db
    .selectFrom('station_track')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const switches = await db
    .selectFrom('station_switch')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const date = data.edition.date
  return {
    edition: data.edition,
    lines: data.lines,
    org: data.org,
    manual: data.manual,
    stations: stations
      .filter((s) => current(s, date) && !excluded.has(s.name))
      .map((s) => ({
        id: s.id,
        name: s.name,
        tracks: tracks
          .filter((t) => t.station_id === s.id && current(t, date))
          .map((t) => t.number),
        switches: switches
          .filter((t) => t.station_id === s.id && current(t, date))
          .map((t) => t.number),
      })),
  }
}

/** Вычисляемый токен предпросмотра, не сохраняется в базе. */
export function editionDataToken(data: EditionData): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

export async function editionTokenMatches(
  db: Kysely<PassportSchema>,
  id: number,
  expected: string | undefined,
): Promise<boolean> {
  if (expected === undefined) return true
  const data = await readEditionData(db, id)
  return data !== undefined && editionDataToken(data) === expected
}
