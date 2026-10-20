import { z } from 'zod'

const id = z.string().min(1)
const text = z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string())
const numeric = z.preprocess(
  (v) =>
    typeof v === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(v)
      ? Number(v.trim().replace(',', '.'))
      : v,
  z.number(),
)
const optionalNumber = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  numeric.nullable(),
)
const bounds = z.object({ from: numeric, to: numeric }).passthrough()
const connection = z
  .object({ sw: text.optional().default(''), to: z.string().nullable().optional().default(null) })
  .passthrough()

export const prototypeSchema = z
  .object({
    v: z.literal(1).optional().default(1),
    meta: z
      .object({
        year: numeric,
        approveTitle: z.string().optional().default(''),
        approveName: z.string().optional().default(''),
        approveDateYear: numeric.optional(),
      })
      .passthrough(),
    catalog: z
      .array(
        z
          .object({
            id,
            code: z.string().optional(),
            name: z.string().optional(),
            group: z.enum(['cur', 'cap', 'other']),
            unit: id,
            inTable: z.boolean().optional().default(false),
            alsoIn: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .min(1),
    lines: z.array(
      bounds.extend({ id, name: z.string(), gaps: z.array(bounds).optional().default([]) }),
    ),
    pd: z
      .array(
        z
          .object({
            id,
            pchu: z.string().optional().default(''),
            segs: z
              .array(bounds.extend({ line: id }))
              .optional()
              .default([]),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    stations: z
      .array(
        z
          .object({
            id,
            name: z.string(),
            pd: z.string().nullable().optional(),
            pos: z
              .array(z.object({ line: id, axis: optionalNumber }).passthrough())
              .optional()
              .default([]),
            layout: z
              .object({
                tracks: z
                  .array(
                    z
                      .object({
                        id,
                        num: text.optional().default(''),
                        kind: z.string().optional(),
                        label: z.string().optional().default(''),
                        row: optionalNumber,
                        x1: optionalNumber,
                        x2: optionalNumber,
                        full: optionalNumber,
                        use: optionalNumber,
                        cap: text.optional().default(''),
                        L: connection.optional(),
                        R: connection.optional(),
                      })
                      .passthrough(),
                  )
                  .optional()
                  .default([]),
                objects: z
                  .array(
                    z
                      .object({
                        id,
                        type: z.string(),
                        text: z.string().optional().default(''),
                        x: numeric,
                        y: optionalNumber,
                        w: optionalNumber,
                        h: optionalNumber,
                      })
                      .passthrough(),
                  )
                  .optional()
                  .default([]),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    works: z
      .array(
        z
          .object({
            id: id.optional(),
            kind: id,
            line: z.string().nullable().optional(),
            station: z.string().nullable().optional(),
            rangesText: z.string().optional().default(''),
            qty: optionalNumber,
            note: z.string().optional().default(''),
            callout: z.boolean().optional().default(true),
            target: z
              .object({ type: z.enum(['track', 'switch']), id })
              .strict()
              .nullable()
              .optional(),
          })
          .passthrough(),
      )
      .optional()
      .default([]),
    tables: z
      .record(
        z.string(),
        z
          .object({
            override: z.record(z.string(), optionalNumber).optional().default({}),
            need: z.record(z.string(), optionalNumber).optional().default({}),
          })
          .passthrough(),
      )
      .optional()
      .default({}),
  })
  .passthrough()

export type Prototype = z.infer<typeof prototypeSchema>
