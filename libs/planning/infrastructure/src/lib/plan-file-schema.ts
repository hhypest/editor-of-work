import { z } from 'zod'

const id = z.string().min(1)
const coordinate = z
  .object({ km: z.number().int().nonnegative(), m: z.number().int().nonnegative() })
  .strict()
const span = z.object({ line: id, from: coordinate, to: coordinate }).strict()
const item = z.discriminatedUnion('kind', [
  span.extend({ kind: z.literal('span') }),
  z.object({ kind: z.literal('point'), line: id, at: coordinate }).strict(),
])
const stationObject = z.object({ kind: z.enum(['track', 'switch']), number: id }).strict()
const place = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('line'),
      spec: z.object({ line: id, items: z.array(item).min(1) }).strict(),
    })
    .strict(),
  z.object({ kind: z.literal('station'), station: id, object: stationObject.optional() }).strict(),
])
const area = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('district') }).strict(),
  z.object({ kind: z.literal('pd'), pd: id }).strict(),
  z.object({ kind: z.literal('station'), station: id }).strict(),
])
const valueEntries = z.array(z.tuple([id, z.number().nonnegative()]))

const snapshotV1Schema = z
  .object({
    lines: z.array(
      z
        .object({
          id,
          name: z.string(),
          extent: z.array(span),
          kmLengths: z.array(
            z.tuple([z.number().int().nonnegative(), z.number().int().positive()]),
          ),
        })
        .strict(),
    ),
    stations: z.array(
      z
        .object({
          id,
          name: z.string(),
          tracks: z.array(id),
          switches: z.array(id),
          pd: id.nullable(),
        })
        .strict(),
    ),
    pds: z.array(z.object({ id, name: z.string(), pchu: id, segments: z.array(span) }).strict()),
    workKinds: z.array(
      z
        .object({
          code: id,
          name: z.string(),
          unit: id,
          group: z.enum(['current', 'capital', 'other']),
          inPlanTable: z.boolean(),
          includedIn: id.optional(),
        })
        .strict(),
    ),
  })
  .strict()

/** Первая версия формата. Строгая схема не позволяет незаметно потерять неизвестные поля. */
export const planFileV1Schema = z
  .object({
    format: z.object({ version: z.literal(1), appVersion: id }).strict(),
    edition: z
      .object({
        number: id,
        date: z.iso.date(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/),
        snapshot: snapshotV1Schema,
      })
      .strict(),
    plan: z
      .object({
        year: z.number().int(),
        approval: z
          .object({ title: z.string(), name: z.string(), year: z.number().int() })
          .strict(),
        works: z.array(
          z
            .object({
              id,
              kind: id,
              place,
              volume: z.number().nonnegative().nullable(),
              note: z.string(),
              callout: z.boolean(),
            })
            .strict(),
        ),
        manual: z.array(z.object({ area, overrides: valueEntries, needs: valueEntries }).strict()),
      })
      .strict(),
  })
  .strict()

const layoutConnection = z.object({ switchNumber: z.string(), parent: id.nullable() }).strict()
const legacyLayout = z
  .object({
    tracks: z.array(
      z
        .object({
          id,
          number: z.string(),
          purpose: z.string(),
          label: z.string(),
          row: z.number(),
          x1: z.number().nullable(),
          x2: z.number().nullable(),
          fullMeters: z.number().nullable(),
          usefulMeters: z.number().nullable(),
          capacity: z.string(),
          left: layoutConnection,
          right: layoutConnection,
        })
        .strict(),
    ),
    objects: z.array(
      z
        .object({
          id,
          type: z.string(),
          text: z.string(),
          x: z.number(),
          y: z.number().nullable(),
          width: z.number().nullable(),
          height: z.number().nullable(),
        })
        .strict(),
    ),
  })
  .strict()
export const snapshotSchema = snapshotV1Schema
  .extend({
    stations: z.array(
      snapshotV1Schema.shape.stations.element
        .extend({ legacyLayout: legacyLayout.optional() })
        .strict(),
    ),
  })
  .strict()

const linePlaceV2 = z
  .object({
    kind: z.literal('line'),
    spec: z.object({ line: id, items: z.array(item).min(1) }).strict(),
    station: id.optional(),
    object: stationObject.optional(),
  })
  .strict()
  .refine((p) => !p.object || p.station !== undefined, 'Объект станции требует станцию')
const placeV2 = z.union([
  linePlaceV2,
  z.object({ kind: z.literal('station'), station: id, object: stationObject.optional() }).strict(),
])
export const planFileV2Schema = planFileV1Schema
  .extend({
    format: z.object({ version: z.literal(2), appVersion: id }).strict(),
    edition: planFileV1Schema.shape.edition.extend({ snapshot: snapshotSchema }).strict(),
    plan: planFileV1Schema.shape.plan
      .extend({
        works: z.array(planFileV1Schema.shape.plan.shape.works.element.extend({ place: placeV2 })),
        prototype: z
          .object({
            source: z.string().refine((text) => {
              try {
                JSON.parse(text)
                return true
              } catch {
                return false
              }
            }, 'Неверный JSON прототипа'),
            report: z.array(z.object({ path: z.string(), message: z.string() }).strict()),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict()

export const planFileV3Schema = planFileV2Schema
  .extend({
    format: z.object({ version: z.literal(3), appVersion: id }).strict(),
    plan: planFileV2Schema.shape.plan
      .extend({
        indicators: z.array(
          z
            .object({
              area,
              rows: z
                .array(
                  z
                    .object({
                      id,
                      name: z.string(),
                      unit: z.string(),
                      value: z.number(),
                      note: z.string(),
                    })
                    .strict(),
                )
                .max(10000),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()

export const planFileV4Schema = planFileV3Schema
  .extend({
    format: z.object({ version: z.literal(4), appVersion: id }).strict(),
    plan: planFileV3Schema.shape.plan
      .extend({
        pdScales: z.array(
          z
            .object({
              pd: id,
              scale: z.union([z.literal(25000), z.literal(50000), z.literal(100000)]),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()

export const planFileSchema = planFileV4Schema
  .extend({
    format: z.object({ version: z.literal(5), appVersion: id }).strict(),
    plan: planFileV4Schema.shape.plan
      .extend({
        pdHiddenTables: z.array(
          z
            .object({
              pd: id,
              hidden: z
                .array(z.enum(['current', 'capital', 'other', 'summary', 'works', 'indicators']))
                .max(6),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict()
export type PlanFile = z.infer<typeof planFileSchema>
export type BasisSnapshot = z.infer<typeof snapshotSchema>

export const formatHeader = z.object({ format: z.object({ version: z.number().int().positive() }) })
