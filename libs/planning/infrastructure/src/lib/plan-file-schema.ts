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
export const snapshotV2Schema = snapshotV1Schema
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
    edition: planFileV1Schema.shape.edition.extend({ snapshot: snapshotV2Schema }).strict(),
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

export const planFileV5Schema = planFileV4Schema
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

/** v6: ожидаемые показатели дистанции и ПД; в составе таблиц ПД появился ключ «expected». */
export const planFileV6Schema = planFileV5Schema
  .extend({
    format: z.object({ version: z.literal(6), appVersion: id }).strict(),
    plan: planFileV5Schema.shape.plan
      .extend({
        pdHiddenTables: z.array(
          z
            .object({
              pd: id,
              hidden: z
                .array(
                  z.enum([
                    'current',
                    'capital',
                    'other',
                    'summary',
                    'works',
                    'indicators',
                    'expected',
                  ]),
                )
                .max(7),
            })
            .strict(),
        ),
        expectedIndicators: z.array(
          z
            .object({
              area: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('district') }).strict(),
                z.object({ kind: z.literal('pd'), pd: id }).strict(),
              ]),
              rows: z
                .array(
                  z
                    .object({
                      id,
                      group: z.string(),
                      name: z.string(),
                      unit: z.string(),
                      value: z.number().nullable(),
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
/** v7: перечни подрядных работ, ИССО и ЗП дистанции и ПД; ключи их таблиц в составе листов ПД. */
export const planFileV7Schema = planFileV6Schema
  .extend({
    format: z.object({ version: z.literal(7), appVersion: id }).strict(),
    plan: planFileV6Schema.shape.plan
      .extend({
        pdHiddenTables: z.array(
          z
            .object({
              pd: id,
              hidden: z
                .array(
                  z.enum([
                    'current',
                    'capital',
                    'other',
                    'summary',
                    'works',
                    'indicators',
                    'expected',
                    'contract',
                    'isso',
                    'zp',
                  ]),
                )
                .max(10),
            })
            .strict(),
        ),
        itemTables: z.array(
          z
            .object({
              area: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('district') }).strict(),
                z.object({ kind: z.literal('pd'), pd: id }).strict(),
              ]),
              kind: z.enum(['contract', 'isso', 'zp']),
              rows: z
                .array(
                  z
                    .object({
                      id,
                      name: z.string(),
                      unit: z.string(),
                      quantity: z.number(),
                      cost: z.number(),
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
/** v8: таблица «Показатели» на 01.01 двух лет для дистанции и ПД; ключ «dated» в составе листов ПД. */
export const planFileV8Schema = planFileV7Schema
  .extend({
    format: z.object({ version: z.literal(8), appVersion: id }).strict(),
    plan: planFileV7Schema.shape.plan
      .extend({
        pdHiddenTables: z.array(
          z
            .object({
              pd: id,
              hidden: z
                .array(
                  z.enum([
                    'dated',
                    'current',
                    'capital',
                    'other',
                    'summary',
                    'works',
                    'indicators',
                    'expected',
                    'contract',
                    'isso',
                    'zp',
                  ]),
                )
                .max(11),
            })
            .strict(),
        ),
        datedIndicators: z.array(
          z
            .object({
              area: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('district') }).strict(),
                z.object({ kind: z.literal('pd'), pd: id }).strict(),
              ]),
              rows: z
                .array(
                  z
                    .object({
                      id,
                      name: z.string(),
                      previous: z.number().nullable(),
                      current: z.number().nullable(),
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
const cell = z.number().int().nonnegative().max(100_000)
const layoutText = z.string().max(200)
/** Раскладка схемы станции, формат паспорта версии 1 (ADR-0046). */
const stationLayout = z
  .object({
    version: z.literal(1),
    nodes: z
      .array(
        z
          .object({
            id,
            col: cell,
            row: cell,
            kind: z.enum(['switch', 'end', 'bend', 'crossing']),
            end: z.enum(['stop', 'open']).optional(),
          })
          .strict(),
      )
      .max(20_000),
    tracks: z
      .array(
        z
          .object({
            id,
            number: layoutText.nullable(),
            kind: z.enum(['main', 'station', 'connector', 'siding']),
            state: z.enum(['normal', 'closed', 'conserved']),
            nodes: z.array(id).min(2).max(20_000),
            fullLength: z.number().finite().nonnegative().nullable(),
            capacity: layoutText.nullable(),
          })
          .strict(),
      )
      .max(5_000),
    switches: z
      .array(
        z.object({ id, number: layoutText.nullable(), node: id, track: id, branch: id }).strict(),
      )
      .max(5_000),
    derailers: z
      .array(z.object({ id, number: layoutText, track: id, col: cell }).strict())
      .max(5_000),
    bridges: z
      .array(
        z
          .object({ id, label: layoutText.nullable(), track: id, fromCol: cell, toCol: cell })
          .strict(),
      )
      .max(1_000),
    crossings: z
      .array(
        z
          .object({
            id,
            label: layoutText,
            km: z.number().int().nonnegative().nullable(),
            pk: z.number().int().min(1).max(10).nullable(),
            col: cell,
            fromRow: cell,
            toRow: cell,
          })
          .strict(),
      )
      .max(1_000),
    objects: z
      .array(
        z
          .object({
            id: id,
            kind: z.enum(['building', 'platform']),
            label: layoutText,
            col: cell,
            row: cell,
            width: z.number().int().min(1).max(400),
            height: z.number().int().min(1).max(20),
          })
          .strict(),
      )
      .max(1_000)
      .optional(),
  })
  .strict()
  .superRefine((layout, ctx) => {
    const nodes = new Set(layout.nodes.map((n) => n.id))
    const tracks = new Set(layout.tracks.map((t) => t.id))
    if (
      layout.tracks.some((t) => t.nodes.some((n) => !nodes.has(n))) ||
      layout.switches.some(
        (s) => !nodes.has(s.node) || !tracks.has(s.track) || !tracks.has(s.branch),
      ) ||
      [...layout.derailers, ...layout.bridges].some((o) => !tracks.has(o.track))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Раскладка станции ссылается на неизвестные элементы',
      })
  })

/** Срез с v9: раскладка схемы станции из паспорта. */
export const snapshotSchema = snapshotV2Schema
  .extend({
    stations: z.array(
      snapshotV2Schema.shape.stations.element.extend({ layout: stationLayout.optional() }).strict(),
    ),
  })
  .strict()

/** v9: срез паспорта хранит раскладку схемы станции; ключ «stations» скрывает листы станций ПД. */
export const planFileSchema = planFileV8Schema
  .extend({
    format: z.object({ version: z.literal(9), appVersion: id }).strict(),
    edition: planFileV8Schema.shape.edition.extend({ snapshot: snapshotSchema }).strict(),
    plan: planFileV8Schema.shape.plan
      .extend({
        pdHiddenTables: z.array(
          z
            .object({
              pd: id,
              hidden: z
                .array(
                  z.enum([
                    'dated',
                    'current',
                    'capital',
                    'other',
                    'summary',
                    'works',
                    'indicators',
                    'expected',
                    'contract',
                    'isso',
                    'zp',
                    'stations',
                  ]),
                )
                .max(12),
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
