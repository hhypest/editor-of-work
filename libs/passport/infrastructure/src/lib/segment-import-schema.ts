import { z } from 'zod'
import { SEGMENT_FORMS } from '@eow/passport/import-api'
import { orgFileSchema } from './org-import-schema'
export const segmentFileSchema = orgFileSchema.extend({ form: z.enum(SEGMENT_FORMS) })
const text = z.string().nullable()
const measurement = z.number().finite().nonnegative().nullable()
const date = z.iso.date().nullable()
const year = z.number().int().positive().nullable()
const point = z.object({ km: z.number().int().nonnegative(), m: z.number().int().nonnegative() })
const base = z.object({
  id: z.string().min(1),
  importFileId: z.string().min(1),
  lineId: z.string().min(1),
  validFrom: date,
  validTo: z.iso.date(),
  from: point,
  to: point,
  statedLength: measurement,
})
export const segmentRowSchema = z.discriminatedUnion('form', [
  base.extend({
    form: z.literal('class'),
    values: z.object({
      trackClass: text,
      group: text,
      category: text,
    }),
  }),
  base.extend({
    form: z.literal('load'),
    values: z.object({
      grossMillionTonKm: measurement,
      axleLoad: measurement,
    }),
  }),
  base.extend({
    form: z.literal('speeds'),
    values: z.object({
      passenger: measurement,
      freight: measurement,
      suburban: measurement,
      empty: measurement,
      express: measurement,
      highSpeed: measurement,
      restrictionReason: text,
    }),
  }),
  base.extend({
    form: z.literal('rails'),
    values: z.object({
      railType: text,
      layingSign: text,
      linkLength: text,
      hardening: text,
      purpose: text,
      plant: text,
      railClass: text,
      railGroup: text,
      laidDate: date,
      reducedWear: text,
      sideWear: measurement,
      waveWear: text,
      tonnageBefore: measurement,
      tonnageAfter: measurement,
    }),
  }),
  base.extend({
    form: z.literal('sleepers'),
    values: z.object({
      structure: text,
      baseType: text,
      sleeperType: text,
      density: measurement,
      manufactureYear: year,
      fasteningType: text,
      fasteningDefective: measurement,
      laidFlag: text,
      padType: text,
      trackSection: text,
      upperAbsorberDate: date,
      upperRepair: text,
      upperPlant: text,
      upperDefective: measurement,
      lowerAbsorberDate: date,
      lowerRepair: text,
      lowerPlant: text,
      lowerDefective: measurement,
      secondarySleeperType: text,
      tonnageBefore: measurement,
      tonnageAfter: measurement,
      tonnage: measurement,
      sidingFlag: text,
    }),
  }),
  base.extend({
    form: z.literal('ballast'),
    values: z.object({
      ballastType: text,
      thickness: text,
      contamination: text,
      separatingLayer: text,
      geogridType: text,
      geogridHeight: text,
      protectiveThickness: measurement,
      protectiveType: text,
      prismShortageRight: measurement,
      prismShortageLeft: measurement,
      shoulderShortageRight: measurement,
      shoulderShortageLeft: measurement,
      monolithicFlag: text,
      monolithicType: text,
    }),
  }),
])
export const segmentImportSchema = z
  .object({
    date: z.iso.date(),
    expectedEditionToken: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    basisToken: z.string().regex(/^[a-f0-9]{64}$/u),
    files: z.array(segmentFileSchema).min(1),
    rows: z.array(segmentRowSchema),
  })
  .superRefine((input, ctx) => {
    const fail = (message: string): void => ctx.addIssue({ code: 'custom', message })
    const files = new Map(input.files.map((f) => [f.id, f]))
    if (
      files.size !== input.files.length ||
      new Set(input.files.map((f) => JSON.stringify([f.form, f.name]))).size !== input.files.length
    )
      fail('Повторяются файлы характеристик.')
    if (new Set(input.rows.map((r) => r.id)).size !== input.rows.length)
      fail('Повторяются строки характеристик.')
    for (const r of input.rows) {
      if (files.get(r.importFileId)?.form !== r.form) fail('Строка ссылается на файл другой формы.')
      if ((r.validFrom !== null && r.validFrom > input.date) || r.validTo < input.date)
        fail('Период строки не включает дату редакции.')
      if (r.to.km < r.from.km || (r.to.km === r.from.km && r.to.m <= r.from.m))
        fail('Конец отрезка должен быть дальше начала.')
    }
  })
