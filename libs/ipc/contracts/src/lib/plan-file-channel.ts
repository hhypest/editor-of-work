import { z } from 'zod'
import { defineChannel } from './channel'

export const planDocumentSchema = z
  .string()
  .min(1)
  .max(20 * 1024 * 1024)
export const planFile = defineChannel(
  'plan:file',
  z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('importPrototype'),
        edition: z.object({ number: z.string().min(1), date: z.iso.date() }).strict(),
        catalog: z.array(z.json()).optional(),
      })
      .strict(),
    z.object({ action: z.literal('open') }).strict(),
    z
      .object({ action: z.literal('save'), document: planDocumentSchema, saveAs: z.boolean() })
      .strict(),
    z.object({ action: z.literal('update'), document: planDocumentSchema }).strict(),
    z.object({ action: z.literal('state') }).strict(),
    z.object({ action: z.literal('recover'), accept: z.boolean() }).strict(),
  ]),
  z.discriminatedUnion('status', [
    z
      .object({
        status: z.literal('ok'),
        document: planDocumentSchema.nullable(),
        recovery: planDocumentSchema.nullable(),
        autosaveError: z.string().nullable(),
      })
      .strict(),
    z.object({ status: z.literal('cancelled') }).strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
  ]),
)
