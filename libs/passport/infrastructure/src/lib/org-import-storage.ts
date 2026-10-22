import type { Generated, Kysely } from 'kysely'
import type { PassportEdition } from '@eow/passport/application'
import type { OrgData, OrgImport, OrgImportError, OrgImportRow } from '@eow/passport/import-api'
import { orgDataSchema } from './org-import-schema'
import { err, ok, type Result } from '@eow/shared/kernel'
import type { SegmentTables } from './segment-tables'
import type { ManualTables } from './manual-tables'
import type { StationTables } from './station-tables'

interface Provenance {
  edition_id: number
  id: string
  import_file_id: string | null
  valid_from: string | null
  valid_to: string | null
}
export interface PassportSchema extends SegmentTables, StationTables, ManualTables {
  line_extent: Provenance & {
    line_id: string
    start_km: number
    start_m: number
    end_km: number
    end_m: number
  }
  line_km: Provenance & { line_id: string; km: number; length_m: number }
  edition: {
    id: Generated<number>
    number: number
    date: string
    label: string
    status: PassportEdition['status']
  }
  import_file: {
    edition_id: number
    id: string
    name: string
    form: string
    imported_at: string
    sha256: string
    row_count: number
    warnings: string
  }
  subdivision: Provenance & {
    name: string
    code: string
    type: string
    parent_id: string | null
    activity: string | null
    active: number
  }
  subdivision_segment: Provenance & {
    stated_length_m: number | null
    line_id: string
    subdivision_id: string
    start_km: number
    start_m: number
    end_km: number
    end_m: number
  }
  line: Provenance & { name: string; code: string }
  station: Provenance & { name: string; code: string; type: string }
  station_pd: Provenance & { station_id: string; subdivision_id: string }
  station_track_pd: Provenance & {
    station_id: string
    track_id: string
    subdivision_id: string
    whole_track: number
    start_m: number | null
    end_m: number | null
  }
}

/** Устойчивые ключи справочников; номер строки выгрузки не меняет идентичность станции. */
export function referenceId(kind: string, ...parts: string[]): string {
  return JSON.stringify([kind, ...parts])
}

/** Проверяем весь пакет до удаления строк и создания справочников в той же транзакции. */
async function validateReferences(
  db: Kysely<PassportSchema>,
  editionId: number,
  input: OrgImport,
): Promise<Result<void, OrgImportError>> {
  const groups = [
    ['line', input.boundaries.map((b) => b.line)],
    ['station', [...input.stations, ...input.tracks].map((s) => s.station)],
  ] as const
  for (const [table, names] of groups) {
    for (const name of new Set(names)) {
      const rows = await db
        .selectFrom(table)
        .select('id')
        .where('edition_id', '=', editionId)
        .where('name', '=', name)
        .limit(2)
        .execute()
      if (rows.length > 1)
        return err({
          kind: 'invalid-import',
          message: `${table === 'line' ? 'Направление' : 'Станция'} «${name}»: найдено несколько записей в черновике паспорта. Уточните названия и повторите импорт.`,
        })
    }
  }
  return ok(undefined)
}

async function lineId(
  db: Kysely<PassportSchema>,
  editionId: number,
  name: string,
): Promise<string> {
  const existing = await db
    .selectFrom('line')
    .select('id')
    .where('edition_id', '=', editionId)
    .where('name', '=', name)
    .executeTakeFirst()
  if (existing) return existing.id
  const id = referenceId('line', name)
  await db
    .insertInto('line')
    .values({
      edition_id: editionId,
      id,
      name,
      code: name,
      import_file_id: null,
      valid_from: null,
      valid_to: null,
    })
    .execute()
  return id
}

export async function stationId(
  db: Kysely<PassportSchema>,
  editionId: number,
  name: string,
): Promise<string> {
  const existing = await db
    .selectFrom('station')
    .select('id')
    .where('edition_id', '=', editionId)
    .where('name', '=', name)
    .executeTakeFirst()
  if (existing) return existing.id
  const id = referenceId('station', name)
  // Имя известно, код и тип ещё придут из осей/экспликации (#18); не придумываем их.
  await db
    .insertInto('station')
    .values({
      edition_id: editionId,
      id,
      name,
      code: '',
      type: '',
      import_file_id: null,
      valid_from: null,
      valid_to: null,
    })
    .execute()
  return id
}

export async function trackId(
  db: Kysely<PassportSchema>,
  editionId: number,
  station: string,
  number: string,
): Promise<string> {
  const existing = await db
    .selectFrom('station_track')
    .select('id')
    .where('edition_id', '=', editionId)
    .where('station_id', '=', station)
    .where('number', '=', number)
    .executeTakeFirst()
  if (existing) return existing.id
  const id = referenceId('track', station, number)
  await db
    .insertInto('station_track')
    .values({
      edition_id: editionId,
      id,
      station_id: station,
      number,
      import_file_id: null,
      valid_from: null,
      valid_to: null,
    })
    .execute()
  return id
}

/** Вызывается только внутри транзакции. Удаляются строки прежнего пакета, не чужие разделы. */
export async function writeOrgImport(
  db: Kysely<PassportSchema>,
  editionId: number,
  input: OrgImport,
): Promise<Result<void, OrgImportError>> {
  const references = await validateReferences(db, editionId, input)
  if (!references.ok) return references
  const old = await db
    .selectFrom('import_file')
    .select('id')
    .where('edition_id', '=', editionId)
    .where('form', 'in', ['subdivisions', 'boundaries', 'station-pd', 'track-pd'])
    .execute()
  const ids = old.map((f) => f.id)
  if (ids.length) {
    for (const table of [
      'station_track_pd',
      'station_pd',
      'subdivision_segment',
      'subdivision',
    ] as const)
      await db
        .deleteFrom(table)
        .where('edition_id', '=', editionId)
        .where('import_file_id', 'in', ids)
        .execute()
    await db
      .deleteFrom('import_file')
      .where('edition_id', '=', editionId)
      .where('id', 'in', ids)
      .execute()
  }
  for (const f of input.files) {
    await db
      .insertInto('import_file')
      .values({
        edition_id: editionId,
        id: f.id,
        name: f.name,
        form: f.form,
        imported_at: f.importedAt,
        sha256: f.sha256,
        row_count: f.rowCount,
        warnings: JSON.stringify(f.warnings),
      })
      .execute()
  }
  const provenance = (r: OrgImportRow): Provenance => ({
    edition_id: editionId,
    id: r.id,
    import_file_id: r.importFileId,
    valid_from: r.validFrom,
    valid_to: r.validTo,
  })
  for (const s of input.subdivisions) {
    await db
      .insertInto('subdivision')
      .values({
        ...provenance(s),
        name: s.code,
        code: s.code,
        type: s.type,
        parent_id: s.parentId,
        activity: s.activity,
        active: Number(s.active),
      })
      .execute()
  }
  for (const b of input.boundaries) {
    await db
      .insertInto('subdivision_segment')
      .values({
        ...provenance(b),
        stated_length_m: b.statedLength === -1 ? null : b.statedLength,
        line_id: await lineId(db, editionId, b.line),
        subdivision_id: b.subdivisionId,
        start_km: b.from.km,
        start_m: b.from.m,
        end_km: b.to.km,
        end_m: b.to.m,
      })
      .execute()
  }
  for (const s of input.stations) {
    await db
      .insertInto('station_pd')
      .values({
        ...provenance(s),
        station_id: await stationId(db, editionId, s.station),
        subdivision_id: s.subdivisionId,
      })
      .execute()
  }
  for (const t of input.tracks) {
    const station = await stationId(db, editionId, t.station)
    await db
      .insertInto('station_track_pd')
      .values({
        ...provenance(t),
        station_id: station,
        track_id: await trackId(db, editionId, station, t.track),
        subdivision_id: t.subdivisionId,
        whole_track: Number(t.meters === null),
        start_m: t.meters?.start ?? null,
        end_m: t.meters?.end ?? null,
      })
      .execute()
  }
  return ok(undefined)
}

/** Провенанс строки чтения: ручные записи без файла импорта помечаются 'manual'. */
const period = (r: {
  id: string
  import_file_id: string | null
  valid_from: string | null
  valid_to: string | null
}) => ({
  id: r.id,
  importFileId: r.import_file_id ?? 'manual',
  validFrom: r.valid_from,
  validTo: r.valid_to ?? '9999-12-31',
})

/** Чтение оргструктуры редакции для просмотра и сравнения; названия вместо внутренних ссылок. */
export async function readOrgData(db: Kysely<PassportSchema>, editionId: number): Promise<OrgData> {
  const lines = await db
    .selectFrom('line')
    .select(['id', 'name'])
    .where('edition_id', '=', editionId)
    .execute()
  const lineName = new Map(lines.map((l) => [l.id, l.name]))
  const stations = await db
    .selectFrom('station')
    .select(['id', 'name'])
    .where('edition_id', '=', editionId)
    .execute()
  const stationName = new Map(stations.map((s) => [s.id, s.name]))
  const tracks = await db
    .selectFrom('station_track')
    .select(['id', 'station_id', 'number'])
    .where('edition_id', '=', editionId)
    .execute()
  const trackNumber = new Map(tracks.map((t) => [t.id, t.number]))
  const subdivisions = await db
    .selectFrom('subdivision')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const boundaries = await db
    .selectFrom('subdivision_segment')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const stationPds = await db
    .selectFrom('station_pd')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const trackPds = await db
    .selectFrom('station_track_pd')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  return orgDataSchema.parse({
    subdivisions: subdivisions.map((s) => ({
      ...period(s),
      code: s.code,
      type: s.type,
      parentId: s.parent_id,
      activity: s.activity,
      active: s.active === 1,
    })),
    boundaries: boundaries.map((b) => ({
      ...period(b),
      line: lineName.get(b.line_id) ?? b.line_id,
      statedLength: b.stated_length_m,
      subdivisionId: b.subdivision_id,
      from: { km: b.start_km, m: b.start_m },
      to: { km: b.end_km, m: b.end_m },
    })),
    stations: stationPds.map((s) => ({
      ...period(s),
      station: stationName.get(s.station_id) ?? s.station_id,
      subdivisionId: s.subdivision_id,
    })),
    tracks: trackPds.map((t) => ({
      ...period(t),
      station: stationName.get(t.station_id) ?? t.station_id,
      track: trackNumber.get(t.track_id) ?? t.track_id,
      subdivisionId: t.subdivision_id,
      meters: t.start_m === null || t.end_m === null ? null : { start: t.start_m, end: t.end_m },
    })),
  })
}
