import { z } from 'zod'
import { defineChannel } from './channel'

const edition = z
  .object({
    id: z.number().int().positive(),
    number: z.number().int().positive(),
    date: z.iso.date(),
    label: z.string().min(1).max(200),
    status: z.enum(['draft', 'active', 'archived']),
  })
  .strict()

export const passport = defineChannel(
  'passport:editions',
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('list') }).strict(),
    z
      .object({
        action: z.literal('createDraft'),
        date: z.iso.date(),
        label: z.string().min(1).max(200),
      })
      .strict(),
    z.object({ action: z.literal('activate'), id: z.number().int().positive() }).strict(),
  ]),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('ok'), editions: z.array(edition) }).strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
  ]),
)
