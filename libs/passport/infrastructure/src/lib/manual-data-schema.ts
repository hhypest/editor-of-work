import { z } from 'zod'
import { orgFileSchema } from './org-import-schema'
const text = z.string().min(1)
const optionalText = text.nullable()
const period = z.object({
  id: text,
  validFrom: z.iso.date().nullable(),
  validTo: z.iso.date().nullable(),
})
const point = z.object({ km: z.number().int().nonnegative(), m: z.number().int().nonnegative() })
const number = z.number().finite()
export const manualDataSchema = z.object({
  workKinds: z.array(
    period.extend({
      code: text,
      name: text,
      unit: text,
      group: text,
      symbol: optionalText,
      includedIn: optionalText,
    }),
  ),
  repairNorms: z.array(
    period.extend({
      workCode: text,
      trackClass: optionalText,
      trackGroup: optionalText,
      trackCategory: optionalText,
      railType: optionalText,
      sleeperType: optionalText,
      years: number.nullable(),
      millionTons: number.nullable(),
    }),
  ),
  tolerances: z.array(
    period.extend({ code: text, name: text, value: number, unit: text, conditions: optionalText }),
  ),
  trainPairs: z.array(
    period.extend({
      line: text,
      from: point,
      to: point,
      freight: number.nullable(),
      passenger: number.nullable(),
      suburban: number.nullable(),
    }),
  ),
  kilometres: z.array(
    period.extend({ line: text, km: z.number().int().nonnegative(), length: z.number().int() }),
  ),
})
export const manualFileSchema = orgFileSchema.extend({ form: z.literal('manual-data') })
export const manualImportSchema = z.object({
  date: z.iso.date(),
  basisToken: z.string().regex(/^[a-f0-9]{64}$/u),
  data: manualDataSchema,
  file: manualFileSchema,
})
