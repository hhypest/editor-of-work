import { z } from 'zod'
import { defineChannel } from './channel'

const mm = (max: number) =>
  z.object({ unit: z.literal('mm'), value: z.number().min(0).max(max) }).strict()
const x = mm(420),
  y = mm(297)
const primitive = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('line'), x1: x, x2: x, y1: y, y2: y, dashed: z.boolean() }).strict(),
  z
    .object({
      kind: z.literal('rect'),
      x,
      y,
      width: x,
      height: y,
      shade: z.boolean(),
      border: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('circle'), x, y, radius: mm(100) }).strict(),
  z
    .object({
      kind: z.literal('text'),
      x,
      y,
      text: z.string().max(10000),
      font: z
        .object({
          family: z.enum(['PT Sans', 'PT Sans Narrow']),
          weight: z.union([z.literal(400), z.literal(700)]),
          size: mm(30),
        })
        .strict(),
    })
    .strict(),
])
export const pdfSheetSchema = z
  .object({
    width: z.object({ unit: z.literal('mm'), value: z.literal(420) }).strict(),
    height: z.object({ unit: z.literal('mm'), value: z.literal(297) }).strict(),
    number: z.number().int().min(1).max(200),
    primitives: z.array(primitive).max(20000),
  })
  .strict()
  .refine((page) => JSON.stringify(page).length <= 4 * 1024 * 1024, 'Лист превышает 4 МиБ')

/** Предел одного файла PDF: листы печатаются одним вызовом printToPDF (ADR-0039). */
export const MAX_PDF_PAGES = 300
export const MAX_PDF_BYTES = 64 * 1024 * 1024
export const pdfPagesSchema = z
  .array(pdfSheetSchema)
  .min(1)
  .max(MAX_PDF_PAGES)
  .refine(
    (pages) => JSON.stringify(pages).length <= MAX_PDF_BYTES,
    'Листы одного PDF превышают 64 МиБ',
  )

/** Данные выдаются только конкретному скрытому окну; main проверяет отправителя. */
export const printHost = defineChannel(
  'pdf:host',
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('load') }).strict(),
    z.object({ action: z.literal('ready') }).strict(),
    z.object({ action: z.literal('failed') }).strict(),
  ]),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('pages'), pages: pdfPagesSchema }).strict(),
    z.object({ status: z.literal('ok') }).strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
  ]),
)
