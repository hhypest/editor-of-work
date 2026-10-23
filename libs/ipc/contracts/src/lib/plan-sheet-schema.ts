import { z } from 'zod'

const point = z
  .object({ km: z.number().int().nonnegative(), m: z.number().int().nonnegative() })
  .strict()
const span = z.object({ line: z.string(), from: point, to: point }).strict()
export const planSheetDataSchema = z
  .object({
    year: z.number().int(),
    edition: z.object({ number: z.string(), date: z.iso.date() }).strict(),
    approval: z.object({ title: z.string(), name: z.string(), year: z.number().int() }).strict(),
    lines: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          extents: z.array(z.object({ from: point, to: point }).strict()),
          kmLengths: z.array(z.tuple([z.number().int(), z.number().int()])),
        })
        .strict(),
    ),
    pds: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          pchu: z.string(),
          scale: z.union([z.literal(25000), z.literal(50000), z.literal(100000)]).optional(),
          segments: z.array(span),
          works: z.array(
            z
              .object({
                id: z.string(),
                name: z.string(),
                place: z.string(),
                lineId: z.string().nullable(),
                items: z.array(
                  z.discriminatedUnion('kind', [
                    span.extend({ kind: z.literal('span') }).strict(),
                    z.object({ kind: z.literal('point'), line: z.string(), at: point }).strict(),
                  ]),
                ),
                volume: z.number().nonnegative(),
                unit: z.string(),
                note: z.string(),
                callout: z.boolean(),
              })
              .strict(),
          ),
          tables: z.array(
            z
              .object({
                title: z.string(),
                columns: z.array(
                  z.object({ title: z.string(), width: z.number().positive() }).strict(),
                ),
                rows: z.array(z.array(z.string())),
                workIds: z.array(z.string().min(1)).optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()
