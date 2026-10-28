import { createHash } from 'node:crypto'
import { sql, type Kysely } from 'kysely'
import { err, ok, chainage, KmLengths, type Result } from '@eow/shared/kernel'
import {
  MANUAL_SHEETS,
  validateManualData,
  type ManualBasis,
  type ManualData,
  type ManualImport,
  type OrgImportError,
} from '@eow/passport/import-api'
import type { PassportSchema } from './org-import-storage'
import { readStationBasis } from './station-import-storage'
import { SEGMENT_TABLES } from './segment-tables'
import { manualDataSchema } from './manual-data-schema'

const tables = ['repair_norm', 'work_kind', 'tolerance', 'seg_train_pairs', 'line_km'] as const
const invalid = (message: string): Result<never, OrgImportError> =>
  err({ kind: 'invalid-import', message })
const period = (r: { id: string; valid_from: string | null; valid_to: string | null }) => ({
  id: r.id,
  validFrom: r.valid_from,
  validTo: r.valid_to,
})
export async function readManualBasis(
  db: Kysely<PassportSchema>,
  editionId: number,
): Promise<ManualBasis | undefined> {
  const geometry = await readStationBasis(db, editionId)
  if (!geometry) return undefined
  const kinds = await db
    .selectFrom('work_kind')
    .selectAll()
    .where('edition_id', '=', editionId)
    // Порядок листа «Виды работ»; строки до миграции 007 — по идентификатору, как раньше.
    .orderBy(sql`sort_order IS NULL`)
    .orderBy('sort_order')
    .orderBy('id')
    .execute()
  const codes = new Map(kinds.map((r) => [r.id, r.code]))
  const norms = await db
    .selectFrom('repair_norm')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const tolerances = await db
    .selectFrom('tolerance')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const pairs = await db
    .selectFrom('seg_train_pairs')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const kms = await db
    .selectFrom('line_km')
    .selectAll()
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const classes = await db
    .selectFrom('seg_class')
    .select('class')
    .where('edition_id', '=', editionId)
    .execute()
  const lineName = (id: string): string => {
    const found = geometry.lines.find((l) => l.id === id)
    if (!found) throw new Error('missing line')
    return found.name
  }
  const workCode = (id: string): string => {
    const code = codes.get(id)
    if (!code) throw new Error('missing work kind')
    return code
  }
  const data = manualDataSchema.parse({
    workKinds: kinds.map((r) => ({
      ...period(r),
      code: r.code,
      name: r.name,
      unit: r.unit,
      group: r.group_name,
      symbol: r.symbol,
      includedIn: r.included_in_id === null ? null : workCode(r.included_in_id),
    })),
    repairNorms: norms.map((r) => ({
      ...period(r),
      workCode: workCode(r.work_kind_id),
      trackClass: r.track_class,
      trackGroup: r.track_group,
      trackCategory: r.track_category,
      railType: r.rail_type,
      sleeperType: r.sleeper_type,
      years: r.years,
      millionTons: r.million_tons,
    })),
    tolerances: tolerances.map((r) => ({
      ...period(r),
      code: r.code,
      name: r.name,
      value: r.value,
      unit: r.unit,
      conditions: r.conditions,
    })),
    trainPairs: pairs.map((r) => ({
      ...period(r),
      line: lineName(r.line_id),
      from: { km: r.start_km, m: r.start_m },
      to: { km: r.end_km, m: r.end_m },
      freight: r.freight,
      passenger: r.passenger,
      suburban: r.suburban,
    })),
    kilometres: kms.map((r) => ({
      ...period(r),
      line: lineName(r.line_id),
      km: r.km,
      length: r.length_m,
    })),
  })
  const content = {
    date: geometry.date,
    lines: geometry.lines,
    trackClasses: [...new Set(classes.map((r) => r.class).filter((r) => r !== null))].toSorted(),
    data,
  }
  return { ...content, token: createHash('sha256').update(JSON.stringify(content)).digest('hex') }
}
/** Порядок значим только у видов работ: в нём строки выводятся в таблицах плана. */
function canonical(data: ManualData): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(data).map(([key, rows]) => [
        key,
        key === 'workKinds'
          ? rows
          : rows.toSorted((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id)),
      ]),
    ),
  )
}
/** Не допускаем, чтобы новая длина км сделала ранее принятые координаты недопустимыми. */
async function geometryError(
  db: Kysely<PassportSchema>,
  editionId: number,
  data: ManualData,
  basis: ManualBasis,
): Promise<string | undefined> {
  for (const line of basis.lines) {
    const lengths = KmLengths.of(
      data.kilometres.filter((k) => k.line === line.name).map((k) => [k.km, k.length] as const),
    )
    if (!lengths.ok) return 'Неверные длины километров'
    const points = line.extents.flatMap((e) => [e.from, e.to])
    for (const table of [
      ...Object.values(SEGMENT_TABLES),
      'subdivision_segment',
      'seg_train_pairs',
    ] as const) {
      if (table === 'seg_train_pairs') continue // Проверяется новый полный пакет, а не заменяемые участки.
      const rows = await db
        .selectFrom(table)
        .select(['start_km', 'start_m', 'end_km', 'end_m'])
        .where('edition_id', '=', editionId)
        .where('line_id', '=', line.id)
        .execute()
      points.push(
        ...rows.flatMap((r) => [
          { km: r.start_km, m: r.start_m },
          { km: r.end_km, m: r.end_m },
        ]),
      )
    }
    const axes = await db
      .selectFrom('station_axis')
      .selectAll()
      .where('edition_id', '=', editionId)
      .where('line_id', '=', line.id)
      .execute()
    for (const a of axes) {
      points.push({ km: a.axis_km, m: a.axis_m })
      if (a.start_km !== null && a.start_m !== null) points.push({ km: a.start_km, m: a.start_m })
      if (a.end_km !== null && a.end_m !== null) points.push({ km: a.end_km, m: a.end_m })
    }
    const crossings = await db
      .selectFrom('crossing')
      .select(['km', 'm'])
      .where('edition_id', '=', editionId)
      .where('line_id', '=', line.id)
      .execute()
    for (const c of crossings) if (c.km !== null && c.m !== null) points.push({ km: c.km, m: c.m })
    const bad = points.find((p) => !chainage(p.km, p.m, lengths.value).ok)
    if (bad)
      // Обычно это нестандартный километр, которого нет в книге: длина по умолчанию короче
      // координаты из выгрузки. Сообщение называет лист и минимальную длину (импорт сам не правит).
      return (
        `Направление «${line.name}»: в паспорте есть координата ${bad.km} км ${bad.m} м, ` +
        `а длина ${bad.km} км по книге — ${lengths.value.lengthOf(bad.km)} м. ` +
        `Укажите на листе «${MANUAL_SHEETS.kilometres}» длину ${bad.km} км больше ${bad.m} м ` +
        'или исправьте выгрузку, из которой пришла координата.'
      )
  }
  return undefined
}
export async function writeManualData(
  db: Kysely<PassportSchema>,
  editionId: number,
  input: ManualImport,
): Promise<Result<void, OrgImportError>> {
  const basis = await readManualBasis(db, editionId)
  if (!basis) return err({ kind: 'not-found', message: 'Редакция паспорта не найдена.' })
  if (basis.date !== input.date || basis.token !== input.basisToken)
    return invalid('Ручные данные или основа паспорта изменились. Выдайте новый шаблон.')
  const errors = validateManualData(input.data, basis)
  if (errors.length)
    return invalid(
      errors
        .map((e) => `Лист «${e.sheet}», строка ${e.row}, «${e.column}»: ${e.message}`)
        .join('\n'),
    )
  if (canonical(input.data) === canonical(basis.data)) return ok(undefined)
  const geometry = await geometryError(db, editionId, input.data, basis)
  if (geometry) return invalid(geometry)
  const lineId = (name: string): string => {
    const line = basis.lines.find((l) => l.name === name)
    if (!line) throw new Error('validated line missing')
    return line.id
  }
  const kindIds = new Map(input.data.workKinds.map((k) => [k.code, k.id]))
  const kindId = (code: string): string => {
    const id = kindIds.get(code)
    if (!id) throw new Error('validated kind missing')
    return id
  }
  for (const table of tables)
    await db.deleteFrom(table).where('edition_id', '=', editionId).execute()
  await db
    .deleteFrom('import_file')
    .where('edition_id', '=', editionId)
    .where('form', '=', 'manual-data')
    .execute()
  const f = input.file
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
  const provenance = (r: { id: string; validFrom: string | null; validTo: string | null }) => ({
    edition_id: editionId,
    id: r.id,
    import_file_id: f.id,
    valid_from: r.validFrom,
    valid_to: r.validTo,
  })
  for (const [index, r] of input.data.workKinds.entries())
    await db
      .insertInto('work_kind')
      .values({
        ...provenance(r),
        sort_order: index,
        code: r.code,
        name: r.name,
        unit: r.unit,
        group_name: r.group,
        symbol: r.symbol,
        included_in_id: r.includedIn === null ? null : kindId(r.includedIn),
      })
      .execute()
  for (const r of input.data.repairNorms)
    await db
      .insertInto('repair_norm')
      .values({
        ...provenance(r),
        work_kind_id: kindId(r.workCode),
        track_class: r.trackClass,
        track_group: r.trackGroup,
        track_category: r.trackCategory,
        rail_type: r.railType,
        sleeper_type: r.sleeperType,
        years: r.years,
        million_tons: r.millionTons,
      })
      .execute()
  for (const r of input.data.tolerances)
    await db
      .insertInto('tolerance')
      .values({
        ...provenance(r),
        code: r.code,
        name: r.name,
        value: r.value,
        unit: r.unit,
        conditions: r.conditions,
      })
      .execute()
  for (const r of input.data.trainPairs)
    await db
      .insertInto('seg_train_pairs')
      .values({
        ...provenance(r),
        line_id: lineId(r.line),
        start_km: r.from.km,
        start_m: r.from.m,
        end_km: r.to.km,
        end_m: r.to.m,
        freight: r.freight,
        passenger: r.passenger,
        suburban: r.suburban,
      })
      .execute()
  for (const r of input.data.kilometres)
    await db
      .insertInto('line_km')
      .values({ ...provenance(r), line_id: lineId(r.line), km: r.km, length_m: r.length })
      .execute()
  return ok(undefined)
}
