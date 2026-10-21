import { z } from 'zod'
import { defineChannel } from './channel'

const point = z
  .object({ km: z.number().int().nonnegative(), m: z.number().int().nonnegative() })
  .strict()
const year = z.number().int().positive().nullable()
const amount = z.number().nonnegative().nullable()
const assessment = z
  .object({
    workCode: z.string().nullable(),
    workName: z.string().nullable(),
    normId: z.string().nullable(),
    status: z.enum(['due', 'planned', 'incomplete', 'no-norm', 'ambiguous-norm']),
    dueYear: year,
    yearIsUpperBound: z.boolean(),
    overdueYears: amount,
    overdueMillionTons: amount,
    reason: z.string().nullable(),
  })
  .strict()
const location = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('line'),
      lineId: z.string(),
      lineName: z.string(),
      from: point,
      to: point,
      lengthM: z.number().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('station'), station: z.string(), track: z.string() }).strict(),
])
export const repairs = defineChannel(
  'passport:repairs',
  z.object({ editionId: z.number().int().positive() }).strict(),
  z.discriminatedUnion('status', [
    z
      .object({
        status: z.literal('ok'),
        report: z
          .object({
            date: z.iso.date(),
            rows: z.array(
              z
                .object({
                  location,
                  lastRepairYear: year,
                  tonnageAfter: amount,
                  assessments: z.array(assessment),
                })
                .strict(),
            ),
          })
          .strict(),
      })
      .strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
  ]),
)
