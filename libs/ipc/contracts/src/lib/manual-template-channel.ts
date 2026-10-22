import { z } from 'zod'
import { defineChannel } from './channel'

const editionId = z.number().int().positive()
const token = z.uuid()
const count = z.number().int().nonnegative()
export const manualTemplate = defineChannel(
  'import:manualTemplate',
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('export'), editionId }).strict(),
    z.object({ action: z.literal('prepare'), editionId }).strict(),
    z.object({ action: z.literal('apply'), editionId, token }).strict(),
    z.object({ action: z.literal('discard'), editionId, token }).strict(),
  ]),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('exported') }).strict(),
    z.object({ status: z.literal('applied') }).strict(),
    z.object({ status: z.literal('cancelled') }).strict(),
    z.object({ status: z.literal('discarded') }).strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
    z
      .object({
        status: z.literal('preview'),
        review: z
          .object({
            token,
            editionId,
            fileName: z.string().min(1),
            changes: z.array(
              z
                .object({ sheet: z.string(), added: count, changed: count, removed: count })
                .strict(),
            ),
          })
          .strict(),
      })
      .strict(),
  ]),
)
