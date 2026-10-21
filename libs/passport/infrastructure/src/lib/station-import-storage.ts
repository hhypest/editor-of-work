import { createHash } from 'node:crypto'
import type { Kysely } from 'kysely'
import { err, ok, picketBounds, type Result } from '@eow/shared/kernel'
import {
  STATION_FORMS,
  type StationBasis,
  type StationImport,
  type StationRow,
  type StationExclusion,
  type OrgImportError,
} from '@eow/passport/import-api'
import { referenceId, stationId, trackId, type PassportSchema } from './org-import-storage'
import { readSegmentBasis } from './segment-import-storage'
import { stationRowSchema } from './station-import-schema'

const invalid = (message: string): Result<never, OrgImportError> =>
  err({ kind: 'invalid-import', message })
const key = (...parts: readonly unknown[]): string => JSON.stringify(parts)
export async function readStationBasis(
  db: Kysely<PassportSchema>,
  editionId: number,
): Promise<StationBasis | undefined> {
  const geometry = await readSegmentBasis(db, editionId)
  if (!geometry) return undefined
  const stations = await db
    .selectFrom('station')
    .select(['id', 'name'])
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const tracks = await db
    .selectFrom('station_track')
    .select(['id', 'station_id as stationId', 'number'])
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const excludedStations = await db
    .selectFrom('excluded_object')
    .innerJoin('station', (j) =>
      j
        .onRef('station.id', '=', 'excluded_object.object_id')
        .onRef('station.edition_id', '=', 'excluded_object.edition_id'),
    )
    .select(['station.name', 'excluded_object.reason'])
    .where('excluded_object.edition_id', '=', editionId)
    .where('object_type', '=', 'station')
    .where((eb) =>
      eb.or([
        eb('excluded_object.valid_from', 'is', null),
        eb('excluded_object.valid_from', '<=', geometry.date),
      ]),
    )
    .where((eb) =>
      eb.or([
        eb('excluded_object.valid_to', 'is', null),
        eb('excluded_object.valid_to', '>=', geometry.date),
      ]),
    )
    .orderBy('station.id')
    .execute()
  const content = { date: geometry.date, lines: geometry.lines, stations, tracks, excludedStations }
  return { ...content, token: createHash('sha256').update(JSON.stringify(content)).digest('hex') }
}

export async function writeStationExclusions(
  db: Kysely<PassportSchema>,
  editionId: number,
  exclusions: readonly StationExclusion[],
): Promise<Result<void, OrgImportError>> {
  for (const item of exclusions) {
    const matches = await db
      .selectFrom('station')
      .select('id')
      .where('edition_id', '=', editionId)
      .where('name', '=', item.name)
      .limit(2)
      .execute()
    if (matches.length > 1) return invalid(`Станция «${item.name}» неоднозначна.`)
  }
  // Меняется только список исключений станций этой редакции; другие типы сохраняются.
  await db
    .deleteFrom('excluded_object')
    .where('edition_id', '=', editionId)
    .where('object_type', '=', 'station')
    .execute()
  for (const item of exclusions) {
    const station = await stationId(db, editionId, item.name)
    await db
      .insertInto('excluded_object')
      .values({
        edition_id: editionId,
        id: referenceId('excluded-station', station),
        object_type: 'station',
        object_id: station,
        reason: item.reason,
        import_file_id: null,
        valid_from: null,
        valid_to: null,
      })
      .execute()
  }
  return ok(undefined)
}

async function validate(
  db: Kysely<PassportSchema>,
  editionId: number,
  input: StationImport,
  basis: StationBasis,
): Promise<Result<void, OrgImportError>> {
  if (basis.date !== input.date || basis.token !== input.basisToken)
    return invalid(
      'Направления, станции или исключения изменились. Повторите предпросмотр станционного импорта.',
    )
  const excluded = new Set(basis.excludedStations.map((e) => e.name))
  const seen = new Set<string>()
  for (const row of input.rows) {
    const v = row.values
    const identity =
      row.form === 'station-axes'
        ? key(row.form, row.values.station, row.values.line)
        : row.form === 'crossings-general'
          ? key(row.form, row.values.title)
          : row.form === 'okato'
            ? key(row.form, row.values.type, row.values.name)
            : key(row.form, row.values.station, row.values.number)
    if (seen.has(identity)) return invalid('Повторяются станционные объекты в пакете.')
    seen.add(identity)
    if ('station' in v) {
      if (excluded.has(v.station)) return invalid(`Станция «${v.station}» исключена из редакции.`)
      if (basis.stations.filter((s) => s.name === v.station).length > 1)
        return invalid(`Станция «${v.station}» неоднозначна.`)
    }
    const lines =
      row.form === 'station-axes'
        ? [row.values.line]
        : row.form === 'crossings-general'
          ? row.values.lines
          : []
    for (const line of lines)
      if (basis.lines.filter((l) => l.name === line).length !== 1)
        return invalid(`Направление «${line}» не найдено или неоднозначно.`)
    if (
      row.form === 'crossings-general' &&
      row.values.stationColumn !== null &&
      basis.stations.filter((s) => s.name === row.values.stationColumn).length > 1
    )
      return invalid(`Станция «${row.values.stationColumn}» неоднозначна.`)
  }
  const territories = input.rows.filter((r) => r.form === 'okato')
  const byTerritory = new Map(territories.map((r) => [key(r.values.type, r.values.name), r.values]))
  for (const row of territories) {
    const matches = await db
      .selectFrom('territory')
      .select('id')
      .where('edition_id', '=', editionId)
      .where('name', '=', row.values.name)
      .where('type', '=', row.values.type)
      .limit(2)
      .execute()
    if (matches.length > 1) return invalid(`Территория «${row.values.name}» неоднозначна.`)
    const seenParents = new Set<string>()
    let current: typeof row.values | undefined = row.values
    while (current?.parent !== null && current !== undefined) {
      const parentKey = key(current.parentType, current.parent)
      if (seenParents.has(parentKey)) return invalid('В ОКАТО обнаружен цикл родителей.')
      seenParents.add(parentKey)
      current = byTerritory.get(parentKey)
      if (!current) return invalid(`У территории «${row.values.name}» нет родителя в пакете ОКАТО.`)
    }
  }
  return ok(undefined)
}

export async function writeStationImport(
  db: Kysely<PassportSchema>,
  editionId: number,
  input: StationImport,
): Promise<Result<void, OrgImportError>> {
  const basis = await readStationBasis(db, editionId)
  if (!basis) return err({ kind: 'not-found', message: 'Редакция паспорта не найдена.' })
  const checked = await validate(db, editionId, input, basis)
  if (!checked.ok) return checked
  const old = await db
    .selectFrom('import_file')
    .select('id')
    .where('edition_id', '=', editionId)
    .where('form', 'in', STATION_FORMS)
    .execute()
  const ids = old.map((f) => f.id)
  if (ids.length) {
    for (const table of ['crossing_line', 'crossing', 'station_axis'] as const)
      await db
        .deleteFrom(table)
        .where('edition_id', '=', editionId)
        .where('import_file_id', 'in', ids)
        .execute()
    // Пути и территории служат ссылками для ручных данных и оргструктуры. Их ключи сохраняются.
    await db
      .updateTable('station_track')
      .set({
        purpose: null,
        full_length_m: null,
        usable_length_m: null,
        rail_type: null,
        sleeper_type: null,
        ballast_type: null,
        last_repair_year: null,
        details: null,
        import_file_id: null,
        valid_from: null,
        valid_to: null,
      })
      .where('edition_id', '=', editionId)
      .where('import_file_id', 'in', ids)
      .execute()
    await db
      .updateTable('station_switch')
      .set({
        type: null,
        rail_type: null,
        frog: null,
        drive: null,
        sleeper_type: null,
        laid_year: null,
        details: null,
        import_file_id: null,
        valid_from: null,
        valid_to: null,
      })
      .where('edition_id', '=', editionId)
      .where('import_file_id', 'in', ids)
      .execute()
    await db
      .updateTable('territory')
      .set({
        parent_id: null,
        details: null,
        import_file_id: null,
        valid_from: null,
        valid_to: null,
      })
      .where('edition_id', '=', editionId)
      .where('import_file_id', 'in', ids)
      .execute()
    await db
      .deleteFrom('import_file')
      .where('edition_id', '=', editionId)
      .where('id', 'in', ids)
      .execute()
  }
  for (const f of input.files)
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
  const provenance = (r: StationRow) => ({
    edition_id: editionId,
    import_file_id: r.importFileId,
    valid_from: r.validFrom,
    valid_to: r.validTo,
    details: JSON.stringify(r),
  })
  const lineId = (name: string): string => {
    const line = basis.lines.find((l) => l.name === name)
    if (!line) throw new Error('validated line missing')
    return line.id
  }
  const territoryIds = new Map<string, string>()
  for (const row of input.rows)
    if (row.form === 'okato') {
      const v = row.values
      const existing = await db
        .selectFrom('territory')
        .select('id')
        .where('edition_id', '=', editionId)
        .where('name', '=', v.name)
        .where('type', '=', v.type)
        .executeTakeFirst()
      const id = existing?.id ?? referenceId('territory', v.type, v.name)
      territoryIds.set(key(v.type, v.name), id)
      if (!existing)
        await db
          .insertInto('territory')
          .values({
            edition_id: editionId,
            id,
            name: v.name,
            okato: '',
            type: v.type,
            import_file_id: null,
            valid_from: null,
            valid_to: null,
          })
          .execute()
    }
  for (const row of input.rows) {
    switch (row.form) {
      case 'station-axes': {
        const v = row.values,
          station = await stationId(db, editionId, v.station)
        await db
          .insertInto('station_axis')
          .values({
            ...provenance(row),
            id: referenceId('station-axis', station, v.line),
            station_id: station,
            line_id: lineId(v.line),
            axis_km: v.axis.km,
            axis_m: v.axis.m,
            start_km: v.from?.km ?? null,
            start_m: v.from?.m ?? null,
            end_km: v.to?.km ?? null,
            end_m: v.to?.m ?? null,
            first_switch: v.firstSwitch,
            last_switch: v.lastSwitch,
            track_section: v.trackSection,
          })
          .execute()
        break
      }
      case 'station-tracks': {
        const v = row.values,
          station = await stationId(db, editionId, v.station),
          track = await trackId(db, editionId, station, v.number)
        await db
          .updateTable('station_track')
          .set({
            ...provenance(row),
            purpose: v.purpose,
            full_length_m: v.fullLength,
            usable_length_m: v.usefulLength,
            rail_type: v.railType,
            sleeper_type: v.sleeperType,
            ballast_type: v.ballastType,
            last_repair_year: v.lastRepairYear,
          })
          .where('edition_id', '=', editionId)
          .where('id', '=', track)
          .execute()
        break
      }
      case 'switches': {
        const v = row.values,
          station = await stationId(db, editionId, v.station)
        const existing = await db
          .selectFrom('station_switch')
          .select('id')
          .where('edition_id', '=', editionId)
          .where('station_id', '=', station)
          .where('number', '=', v.number)
          .executeTakeFirst()
        const id = existing?.id ?? referenceId('switch', station, v.number)
        if (!existing)
          await db
            .insertInto('station_switch')
            .values({
              edition_id: editionId,
              id,
              station_id: station,
              number: v.number,
              import_file_id: null,
              valid_from: null,
              valid_to: null,
            })
            .execute()
        await db
          .updateTable('station_switch')
          .set({
            ...provenance(row),
            type: v.purpose,
            rail_type: v.railType,
            frog: v.frogMark,
            drive: v.control,
            sleeper_type: v.sleeperType,
            laid_year: v.laidDate === null ? null : Number(v.laidDate.slice(0, 4)),
          })
          .where('edition_id', '=', editionId)
          .where('id', '=', id)
          .execute()
        break
      }
      case 'crossings-general': {
        const v = row.values,
          id = referenceId('crossing', v.title)
        const place = v.place === null ? undefined : picketBounds(v.place.km, v.place.pk)
        if (place && !place.ok) throw new Error('validated crossing picket missing')
        const station =
          v.stationColumn === null || basis.excludedStations.some((s) => s.name === v.stationColumn)
            ? null
            : await stationId(db, editionId, v.stationColumn)
        await db
          .insertInto('crossing')
          .values({
            ...provenance(row),
            id,
            line_id: v.lines.length === 1 ? lineId(v.lines[0] ?? '') : null,
            station_id: station,
            number: v.number,
            name: v.title,
            km: place?.ok ? place.value.start.km : null,
            m: place?.ok ? place.value.start.m : null,
            category: v.category,
            type: v.type,
            road: v.road,
            regulated: v.regulated === null ? null : Number(v.regulated),
            signalling: v.signalling,
            surface: v.surface,
            barriers: v.barriers,
            trains_per_day: v.trainsPerDay,
            vehicles_per_day: v.vehiclesPerDay,
            train_speed: v.trainSpeed,
            last_overhaul_date: v.lastOverhaul,
          })
          .execute()
        for (const line of v.lines)
          await db
            .insertInto('crossing_line')
            .values({
              edition_id: editionId,
              id: referenceId('crossing-line', id, line),
              crossing_id: id,
              line_id: lineId(line),
              import_file_id: row.importFileId,
              valid_from: row.validFrom,
              valid_to: row.validTo,
            })
            .execute()
        break
      }
      case 'okato': {
        const v = row.values,
          id = territoryIds.get(key(v.type, v.name))
        if (!id) throw new Error('validated territory missing')
        await db
          .updateTable('territory')
          .set({
            ...provenance(row),
            parent_id:
              v.parent === null ? null : (territoryIds.get(key(v.parentType, v.parent)) ?? null),
          })
          .where('edition_id', '=', editionId)
          .where('id', '=', id)
          .execute()
        break
      }
    }
  }
  return ok(undefined)
}

export async function readStationData(
  db: Kysely<PassportSchema>,
  editionId: number,
): Promise<readonly StationRow[]> {
  const out: StationRow[] = []
  for (const table of [
    'station_axis',
    'station_track',
    'station_switch',
    'crossing',
    'territory',
  ] as const) {
    const rows = await db
      .selectFrom(table)
      .select('details')
      .where('edition_id', '=', editionId)
      .where('details', 'is not', null)
      .orderBy('id')
      .execute()
    for (const row of rows)
      if (row.details !== null) out.push(stationRowSchema.parse(JSON.parse(row.details)))
  }
  const basis = await readStationBasis(db, editionId)
  const excluded = new Set(basis?.excludedStations.map((e) => e.name) ?? [])
  return out
    .filter((r) => !('station' in r.values) || !excluded.has(r.values.station))
    .toSorted((a, b) => a.id.localeCompare(b.id))
}
