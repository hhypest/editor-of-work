import { z } from 'zod'
import { defineChannel } from './channel'
import { pdfPagesSchema } from './pdf-sheet-schema'

/**
 * Готовые листы паспортных схем (общая схема, схема дистанции) в один PDF А3.
 * Renderer передаёт модели листов и имя по умолчанию; путь выбирает и пишет main.
 */
export const sheetPdf = defineChannel(
  'documents:pdf',
  z
    .object({
      fileName: z.string().min(1).max(120),
      pages: pdfPagesSchema,
    })
    .strict(),
  z.discriminatedUnion('status', [
    z.object({ status: z.enum(['saved', 'cancelled']) }).strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
  ]),
)
