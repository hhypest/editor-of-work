import { createHash } from 'node:crypto'
import type { Kysely } from 'kysely'
import type { EditionData } from '@eow/passport/application'
import { readManualBasis } from './manual-data-storage'
import { readOrgData, type PassportSchema } from './org-import-storage'
import { readSegmentData } from './segment-import-storage'
import { readStationData } from './station-import-storage'

/**
 * Полный срез данных редакции для просмотра и сравнения.
 * Читается одной транзакцией вызывающего кода; в отличие от среза расчёта
 * ремонтов строки не отбираются по дате — период действия показывается в таблицах.
 */
export async function readEditionData(
  db: Kysely<PassportSchema>,
  editionId: number,
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
    lines: lines.map((l) => ({
      id: l.id,
      name: l.name,
      extents: extents
        .filter((e) => e.line_id === l.id)
        .map((e) => ({
          from: { km: e.start_km, m: e.start_m },
          to: { km: e.end_km, m: e.end_m },
        })),
      kmLengths: kilometres
        .filter((k) => k.line_id === l.id)
        .map((k) => [k.km, k.length_m] as const),
    })),
    segments,
    stations,
    manual: manual.data,
    org,
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
