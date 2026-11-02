import { createHash } from 'node:crypto'
import type { Kysely } from 'kysely'
import { err, ok, type Result } from '@eow/shared/kernel'
import {
  STATION_SCHEME_FORM,
  type OrgImportError,
  type StationSchemeBasis,
  type StationLayout,
  type StationLayoutEntry,
  type StationSchemeImport,
} from '@eow/passport/import-api'
import { referenceId, type PassportSchema } from './org-import-storage'
import { stationLayoutSchema } from './station-scheme-schema'

/** Станции, экспликации путей и стрелок и уже записанные раскладки редакции. */
export async function readStationSchemeBasis(
  db: Kysely<PassportSchema>,
  editionId: number,
): Promise<StationSchemeBasis> {
  const stations = await db
    .selectFrom('station')
    .select(['id', 'name'])
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const tracks = await db
    .selectFrom('station_track')
    .select(['station_id as stationId', 'number', 'full_length_m as fullLength'])
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const switches = await db
    .selectFrom('station_switch')
    .select(['station_id as stationId', 'number'])
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const layouts = (
    await db
      .selectFrom('station_layout')
      .select('station_id')
      .where('edition_id', '=', editionId)
      .orderBy('station_id')
      .execute()
  ).map((r) => r.station_id)
  const content = { stations, tracks, switches, layouts }
  return { ...content, token: createHash('sha256').update(JSON.stringify(content)).digest('hex') }
}

/**
 * Раскладки выбранных станций заменяются целиком; остальные станции не трогаются.
 * Записи файлов схем, на которые больше не ссылается ни одна раскладка, удаляются.
 */
export async function writeStationSchemeImport(
  db: Kysely<PassportSchema>,
  editionId: number,
  input: StationSchemeImport,
): Promise<Result<void, OrgImportError>> {
  const basis = await readStationSchemeBasis(db, editionId)
  if (basis.token !== input.basisToken)
    return err({
      kind: 'invalid-import',
      message: 'Станции, экспликации или раскладки изменились. Повторите предпросмотр схем.',
    })
  const known = new Set(basis.stations.map((s) => s.id))
  if (input.layouts.some((l) => !known.has(l.stationId)))
    return err({
      kind: 'invalid-import',
      message: 'Схема относится к станции не из этой редакции.',
    })
  for (const f of input.files)
    await db
      .insertInto('import_file')
      .values({
        edition_id: editionId,
        id: f.id,
        name: f.name,
        form: STATION_SCHEME_FORM,
        imported_at: f.importedAt,
        sha256: f.sha256,
        row_count: input.layouts.find((l) => l.importFileId === f.id)?.layout.tracks.length ?? 0,
        warnings: JSON.stringify(f.warnings),
      })
      .execute()
  for (const l of input.layouts) {
    // Здания и платформы ставит составитель: повторный импорт схемы их не стирает.
    const previous = await readStationLayout(db, editionId, l.stationId)
    const parsed = previous ? stationLayoutSchema.safeParse(JSON.parse(previous.json)) : undefined
    const objects = parsed?.success ? parsed.data.objects : undefined
    const layout = objects?.length ? { ...l.layout, objects } : l.layout
    await db
      .deleteFrom('station_layout')
      .where('edition_id', '=', editionId)
      .where('station_id', '=', l.stationId)
      .execute()
    await db
      .insertInto('station_layout')
      .values({
        edition_id: editionId,
        id: referenceId('station-layout', l.stationId),
        station_id: l.stationId,
        layout: JSON.stringify(layout),
        import_file_id: l.importFileId,
        valid_from: null,
        valid_to: null,
      })
      .execute()
  }
  await db
    .deleteFrom('import_file')
    .where('edition_id', '=', editionId)
    .where('form', '=', STATION_SCHEME_FORM)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('station_layout')
            .select('station_layout.id')
            .whereRef('station_layout.edition_id', '=', 'import_file.edition_id')
            .whereRef('station_layout.import_file_id', '=', 'import_file.id'),
        ),
      ),
    )
    .execute()
  return ok(undefined)
}

const layoutVersion = (json: string): string => createHash('sha256').update(json).digest('hex')

export async function readStationLayoutList(
  db: Kysely<PassportSchema>,
  editionId: number,
): Promise<StationLayoutEntry[]> {
  const stations = await db
    .selectFrom('station')
    .select(['id', 'name'])
    .where('edition_id', '=', editionId)
    .orderBy('name')
    .execute()
  const layouts = new Set(
    (
      await db
        .selectFrom('station_layout')
        .select('station_id')
        .where('edition_id', '=', editionId)
        .execute()
    ).map((r) => r.station_id),
  )
  return stations.map((s) => ({ id: s.id, name: s.name, hasLayout: layouts.has(s.id) }))
}

export async function readStationLayout(
  db: Kysely<PassportSchema>,
  editionId: number,
  stationId: string,
): Promise<{ readonly json: string; readonly version: string } | undefined> {
  const row = await db
    .selectFrom('station_layout')
    .select('layout')
    .where('edition_id', '=', editionId)
    .where('station_id', '=', stationId)
    .executeTakeFirst()
  return row ? { json: row.layout, version: layoutVersion(row.layout) } : undefined
}

/** Правка раскладки в черновике; ссылка на файл схемы, из которого она пришла, сохраняется. */
export async function writeStationLayout(
  db: Kysely<PassportSchema>,
  editionId: number,
  stationId: string,
  layout: StationLayout,
  version: string,
): Promise<Result<{ readonly version: string }, OrgImportError>> {
  const current = await readStationLayout(db, editionId, stationId)
  if (!current)
    return err({ kind: 'not-found', message: 'У станции нет раскладки. Загрузите схему станции.' })
  if (current.version !== version)
    return err({
      kind: 'invalid-import',
      message: 'Раскладку изменили после открытия. Откройте станцию заново.',
    })
  const json = JSON.stringify(layout)
  await db
    .updateTable('station_layout')
    .set({ layout: json })
    .where('edition_id', '=', editionId)
    .where('station_id', '=', stationId)
    .execute()
  return ok({ version: layoutVersion(json) })
}
