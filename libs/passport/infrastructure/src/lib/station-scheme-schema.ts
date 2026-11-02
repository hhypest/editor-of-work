import { z } from 'zod'
import { STATION_LAYOUT_VERSION, checkStationLayout } from '@eow/passport/import-api'

const id = z.string().min(1).max(64)
const cell = z.number().int().nonnegative().max(100_000)
const text = z.string().max(200)
const fileId = z.string().min(1).max(600)

export const stationLayoutSchema = z
  .object({
    version: z.literal(STATION_LAYOUT_VERSION),
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
            number: text.nullable(),
            kind: z.enum(['main', 'station', 'connector', 'siding']),
            state: z.enum(['normal', 'closed', 'conserved']),
            nodes: z.array(id).min(2).max(20_000),
            fullLength: z.number().finite().nonnegative().nullable(),
            capacity: text.nullable(),
          })
          .strict(),
      )
      .max(5_000),
    switches: z
      .array(z.object({ id, number: text.nullable(), node: id, track: id, branch: id }).strict())
      .max(5_000),
    derailers: z.array(z.object({ id, number: text, track: id, col: cell }).strict()).max(5_000),
    bridges: z
      .array(
        z.object({ id, label: text.nullable(), track: id, fromCol: cell, toCol: cell }).strict(),
      )
      .max(1_000),
    crossings: z
      .array(
        z
          .object({
            id,
            label: text,
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
            label: text,
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
    for (const message of checkStationLayout(layout)) ctx.addIssue({ code: 'custom', message })
  })

const remark = z.object({ text: z.string() }).strict()

export const stationSchemeImportSchema = z
  .object({
    expectedEditionToken: z.string().optional(),
    basisToken: z.string().min(1),
    files: z
      .array(
        z
          .object({
            id: fileId,
            name: z.string().min(1).max(260),
            sha256: z.string().regex(/^[0-9a-f]{64}$/u),
            importedAt: z.iso.datetime(),
            warnings: z.array(remark),
          })
          .strict(),
      )
      .min(1)
      .max(1_000),
    layouts: z
      .array(
        z
          .object({
            stationId: z.string().min(1),
            importFileId: fileId,
            layout: stationLayoutSchema,
          })
          .strict(),
      )
      .min(1)
      .max(1_000),
  })
  .strict()
  .superRefine((input, ctx) => {
    const files = new Set(input.files.map((f) => f.id))
    const stations = input.layouts.map((l) => l.stationId)
    if (new Set(stations).size !== stations.length)
      ctx.addIssue({ code: 'custom', message: 'Две схемы относятся к одной станции.' })
    for (const l of input.layouts)
      if (!files.has(l.importFileId))
        ctx.addIssue({ code: 'custom', message: 'Раскладка ссылается на неизвестный файл схемы.' })
  })
