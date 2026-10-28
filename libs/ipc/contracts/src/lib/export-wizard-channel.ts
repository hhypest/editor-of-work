import { z } from 'zod'
import { defineChannel } from './channel'

const editionId = z.number().int().positive()
const token = z.uuid()
const group = z.enum(['org', 'segments', 'stations'])
const count = z.number().int().nonnegative()
const choice = z
  .object({
    code: z.string(),
    type: z.string(),
    parent: z.string().nullable(),
    validFrom: z.string().nullable(),
    segments: count,
    overlapsWith: z.array(z.string()),
    suggested: z.boolean(),
    note: z.string().nullable(),
  })
  .strict()
export const exportWizard = defineChannel(
  'import:exports',
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('choose'), editionId, group }).strict(),
    z
      .object({
        action: z.literal('review'),
        editionId,
        token,
        selected: z.array(z.string().min(1)).max(10000),
      })
      .strict(),
    z.object({ action: z.literal('apply'), editionId, token }).strict(),
    z.object({ action: z.literal('discard'), editionId, token }).strict(),
    // Ход и остановка текущей операции; обслуживаются, пока она идёт (ADR-0044).
    z.object({ action: z.literal('progress') }).strict(),
    z.object({ action: z.literal('cancel') }).strict(),
  ]),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('cancelled') }).strict(),
    z.object({ status: z.literal('applied') }).strict(),
    z.object({ status: z.literal('discarded') }).strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
    z.object({ status: z.literal('idle') }).strict(),
    z
      .object({
        status: z.literal('progress'),
        progress: z
          .object({
            stage: z.enum(['reading', 'parsing', 'checking', 'saving']),
            done: count,
            total: count,
            file: z.string().nullable(),
            cancellable: z.boolean(),
            cancelling: z.boolean(),
          })
          .strict(),
      })
      .strict(),
    z.object({ status: z.literal('choices'), token, editionId, choices: z.array(choice) }).strict(),
    z
      .object({
        status: z.literal('preview'),
        review: z
          .object({
            token,
            editionId,
            group,
            files: z.array(z.object({ name: z.string(), form: z.string(), rows: count }).strict()),
            previousRows: count,
            incomingRows: count,
            remarks: z.array(z.string()),
            exclusionCandidates: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
  ]),
)
