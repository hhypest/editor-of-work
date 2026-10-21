import type { Kysely } from 'kysely'
import type { RepairSnapshot } from '@eow/passport/application'
import { readManualBasis } from './manual-data-storage'
import { readSegmentData } from './segment-import-storage'
import { readStationData } from './station-import-storage'
import type { PassportSchema } from './org-import-storage'

function current(
  row: { valid_from: string | null; valid_to: string | null },
  date: string,
): boolean {
  return (
    (row.valid_from === null || row.valid_from <= date) &&
    (row.valid_to === null || row.valid_to >= date)
  )
}

export async function readRepairSnapshot(
  db: Kysely<PassportSchema>,
  id: number,
): Promise<RepairSnapshot | undefined> {
  const manual = await readManualBasis(db, id)
  if (!manual) return undefined
  const segments = await readSegmentData(db, id)
  const stations = await readStationData(db, id)
  const lines = await db
    .selectFrom('line')
    .selectAll()
    .where('edition_id', '=', id)
    .orderBy('id')
    .execute()
  const extents = await db
    .selectFrom('line_extent')
    .selectAll()
    .where('edition_id', '=', id)
    .orderBy('id')
    .execute()
  const kilometres = await db
    .selectFrom('line_km')
    .selectAll()
    .where('edition_id', '=', id)
    .orderBy('km')
    .execute()
  const stationNames = new Set(
    (await db.selectFrom('station').selectAll().where('edition_id', '=', id).execute())
      .filter((s) => current(s, manual.date))
      .map((s) => s.name),
  )
  return {
    date: manual.date,
    lines: lines
      .filter((l) => current(l, manual.date))
      .map((l) => ({
        id: l.id,
        name: l.name,
        extents: extents
          .filter((e) => e.line_id === l.id && current(e, manual.date))
          .map((e) => ({
            from: { km: e.start_km, m: e.start_m },
            to: { km: e.end_km, m: e.end_m },
          })),
        kmLengths: kilometres
          .filter((k) => k.line_id === l.id && current(k, manual.date))
          .map((k) => [k.km, k.length_m] as const),
      })),
    segments: segments.filter(
      (s) => s.form === 'class' || s.form === 'rails' || s.form === 'sleepers',
    ),
    tracks: stations
      .filter((s) => s.form === 'station-tracks')
      .filter((s) => stationNames.has(s.values.station))
      .map((s) => ({ ...s.values, validFrom: s.validFrom, validTo: s.validTo })),
    norms: manual.data.repairNorms
      .map((n) => ({
        ...n,
        workName: manual.data.workKinds.find((k) => k.code === n.workCode)?.name ?? n.workCode,
      }))
      .filter((n) => {
        const kind = manual.data.workKinds.find((k) => k.code === n.workCode)
        return (
          kind &&
          (kind.validFrom === null || kind.validFrom <= manual.date) &&
          (kind.validTo === null || kind.validTo >= manual.date)
        )
      }),
  }
}
