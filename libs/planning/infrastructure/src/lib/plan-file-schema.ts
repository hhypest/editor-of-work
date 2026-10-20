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

export const snapshotSchema = z
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
export const planFileSchema = z
  .object({
    format: z.object({ version: z.literal(1), appVersion: id }).strict(),
    edition: z
      .object({
        number: id,
        date: z.iso.date(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/),
        snapshot: snapshotSchema,
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

export type PlanFile = z.infer<typeof planFileSchema>
export type BasisSnapshot = z.infer<typeof snapshotSchema>

export const formatHeader = z.object({ format: z.object({ version: z.number().int().positive() }) })
