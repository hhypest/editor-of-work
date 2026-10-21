import { createHash } from 'node:crypto'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import { err, ok, type Result } from '@eow/shared/kernel'
import type {
  SegmentBasis,
  SegmentImport,
  SegmentRow,
  OrgImportError,
} from '@eow/passport/import-api'
import type { PassportSchema } from './org-import-storage'
import { SEGMENT_TABLES, type SegmentStorageRow } from './segment-tables'
import { segmentRowSchema } from './segment-import-schema'

export async function readSegmentBasis(
  db: Kysely<PassportSchema>,
  editionId: number,
): Promise<SegmentBasis | undefined> {
  const edition = await db
    .selectFrom('edition')
    .select('date')
    .where('id', '=', editionId)
    .executeTakeFirst()
  if (!edition) return undefined
  const lines = await db
    .selectFrom('line')
    .select(['id', 'name'])
    .where('edition_id', '=', editionId)
    .orderBy('id')
    .execute()
  const kilometres = await db
    .selectFrom('line_km')
    .select(['line_id', 'km', 'length_m'])
    .where('edition_id', '=', editionId)
    .orderBy('line_id')
    .orderBy('km')
    .execute()
  const boundaries = await db
    .selectFrom('subdivision_segment')
    .innerJoin('subdivision', (join) =>
      join
        .onRef('subdivision.id', '=', 'subdivision_segment.subdivision_id')
        .onRef('subdivision.edition_id', '=', 'subdivision_segment.edition_id'),
    )
    .select([
      'subdivision_segment.id',
      'subdivision_segment.line_id',
      'subdivision.code',
      'subdivision_segment.start_km',
      'subdivision_segment.start_m',
      'subdivision_segment.end_km',
      'subdivision_segment.end_m',
      'subdivision_segment.stated_length_m',
    ])
    .where('subdivision_segment.edition_id', '=', editionId)
    .where('subdivision.active', '=', 1)
    .orderBy('subdivision_segment.id')
    .execute()
  const content = {
    date: edition.date,
    boundaries: boundaries.map((b) => ({
      lineId: b.line_id,
      subdivisionCode: b.code,
      from: { km: b.start_km, m: b.start_m },
      to: { km: b.end_km, m: b.end_m },
      statedLength: b.stated_length_m === -1 ? null : b.stated_length_m,
    })),
    lines: lines.map((l) => ({
      ...l,
      kmLengths: kilometres
        .filter((k) => k.line_id === l.id)
        .map((k): readonly [number, number] => [k.km, k.length_m]),
    })),
  }
  return { ...content, token: createHash('sha256').update(JSON.stringify(content)).digest('hex') }
}

/** Интервалы («35-50») не превращаются в скаляр. Исходный текст остаётся в details. */
function scalar(value: string | null): number | null {
  if (value === null || !/^\d+(?:[.,]\d+)?$/u.test(value)) return null
  const number = Number(value.replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

async function insertSegment(
  db: Kysely<PassportSchema>,
  editionId: number,
  row: SegmentRow,
): Promise<void> {
  const common: SegmentStorageRow = {
    edition_id: editionId,
    id: row.id,
    line_id: row.lineId,
    start_km: row.from.km,
    start_m: row.from.m,
    end_km: row.to.km,
    end_m: row.to.m,
    import_file_id: row.importFileId,
    valid_from: row.validFrom,
    valid_to: row.validTo,
    stated_length_m: row.statedLength,
    details: JSON.stringify(row.values),
  }
  switch (row.form) {
    case 'class': {
      const v = row.values
      await db
        .insertInto('seg_class')
        .values({ ...common, class: v.trackClass, group_name: v.group, category: v.category })
        .execute()
      break
    }
    case 'load': {
      const v = row.values
      await db
        .insertInto('seg_load')
        .values({ ...common, gross_million_ton_km: v.grossMillionTonKm, axle_load: v.axleLoad })
        .execute()
      break
    }
    case 'speeds': {
      const v = row.values
      await db
        .insertInto('seg_speed')
        .values({
          ...common,
          passenger: v.passenger,
          freight: v.freight,
          suburban: v.suburban,
          empty: v.empty,
          express: v.express,
          high_speed: v.highSpeed,
          restriction_reason: v.restrictionReason,
        })
        .execute()
      break
    }
    case 'rails': {
      const v = row.values
      await db
        .insertInto('seg_rail')
        .values({
          ...common,
          type: v.railType,
          laying_sign: v.layingSign,
          laid_date: v.laidDate,
          link_length_m: scalar(v.linkLength),
          continuous_welded:
            v.linkLength !== null && /^б\s*[./]\s*[пс]\.?$/iu.test(v.linkLength)
              ? 1
              : scalar(v.linkLength) !== null
                ? 0
                : null,
          hardening: v.hardening,
          plant: v.plant,
          class: v.railClass,
          group_name: v.railGroup,
          wear_mm: scalar(v.reducedWear),
          tonnage_before: v.tonnageBefore,
          tonnage_after: v.tonnageAfter,
        })
        .execute()
      break
    }
    case 'sleepers': {
      const v = row.values
      await db
        .insertInto('seg_sleeper')
        .values({
          ...common,
          base_type: v.baseType,
          density: v.density,
          fastening_type: v.fasteningType,
          fastening_defective: v.fasteningDefective,
          shock_absorbers: null,
          tonnage: v.tonnage,
        })
        .execute()
      break
    }
    case 'ballast': {
      const v = row.values
      await db
        .insertInto('seg_ballast')
        .values({
          ...common,
          type: v.ballastType,
          thickness_cm: scalar(v.thickness),
          contamination: null,
          separating_layer: v.separatingLayer,
          protective_layer: v.protectiveType,
          prism_shortage_cm: null,
          shoulder_shortage_cm: null,
        })
        .execute()
      break
    }
  }
}

/** Проверки до записи; сбой SQL после начала замены откатывает вызывающая транзакция. */
export async function writeSegmentImport(
  db: Kysely<PassportSchema>,
  editionId: number,
  input: SegmentImport,
): Promise<Result<void, OrgImportError>> {
  const basis = await readSegmentBasis(db, editionId)
  if (!basis) return err({ kind: 'not-found', message: 'Редакция паспорта не найдена.' })
  if (basis.date !== input.date || basis.token !== input.basisToken)
    return err({
      kind: 'invalid-import',
      message:
        'Километраж или справочник направлений изменился. Повторите предпросмотр и сверку длин.',
    })
  const known = new Set(basis.lines.map((l) => l.id))
  if (input.rows.some((r) => !known.has(r.lineId)))
    return err({
      kind: 'invalid-import',
      message: 'Направление строки отсутствует в выбранной редакции.',
    })
  const forms = [...new Set(input.files.map((f) => f.form))]
  const old = await db
    .selectFrom('import_file')
    .select('id')
    .where('edition_id', '=', editionId)
    .where('form', 'in', forms)
    .execute()
  const ids = old.map((f) => f.id)
  if (ids.length) {
    for (const form of forms)
      await db
        .deleteFrom(SEGMENT_TABLES[form])
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
  for (const row of input.rows) await insertSegment(db, editionId, row)
  return ok(undefined)
}

export async function readSegmentData(
  db: Kysely<PassportSchema>,
  editionId: number,
): Promise<readonly SegmentRow[]> {
  const out: SegmentRow[] = []
  for (const [form, table] of Object.entries(SEGMENT_TABLES)) {
    const rows = await db
      .selectFrom(table)
      .select([
        'id',
        'line_id',
        'start_km',
        'start_m',
        'end_km',
        'end_m',
        'stated_length_m',
        'details',
        'import_file_id',
        'valid_from',
        'valid_to',
      ])
      .where('edition_id', '=', editionId)
      .where('details', 'is not', null)
      .orderBy('id')
      .execute()
    for (const r of rows)
      out.push(
        segmentRowSchema.parse({
          form,
          id: r.id,
          lineId: r.line_id,
          from: { km: r.start_km, m: r.start_m },
          to: { km: r.end_km, m: r.end_m },
          statedLength: r.stated_length_m,
          values: JSON.parse(z.string().parse(r.details)),
          importFileId: r.import_file_id,
          validFrom: r.valid_from,
          validTo: r.valid_to,
        }),
      )
  }
  return out
}
