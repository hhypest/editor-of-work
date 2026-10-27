import { z } from 'zod'
import { pdfSheetSchema } from './pdf-sheet-schema'
import { planSheetDataSchema } from './plan-sheet-schema'
import { defineChannel } from './channel'
import {
  editorActionSchema,
  editorStateSchema,
  editorIssueSchema,
  placeHintSchema,
  planEditionChoiceSchema,
} from './plan-editor-schema'

/** Предел закодированного плана: проверяется в main до смены текущего документа. */
export const planDocumentSchema = z
  .string()
  .min(1)
  .max(20 * 1024 * 1024)
/**
 * Открытый план принадлежит main (ADR-0035): renderer меняет его только командами
 * `editor` с ожидаемой ревизией и не передаёт документ целиком.
 */
export const planFile = defineChannel(
  'plan:file',
  z.discriminatedUnion('action', [
    z
      .object({
        action: z.literal('exportEditorSheet'),
        revision: z.number().int().nonnegative(),
        pd: z.string().min(1).max(1000),
        page: pdfSheetSchema,
      })
      .strict(),
    z.object({ action: z.literal('previewSheets'), open: z.boolean() }).strict(),
    z
      .object({
        action: z.literal('previewEditorSheets'),
        revision: z.number().int().nonnegative(),
        pd: z.string().min(1),
      })
      .strict(),
    z
      .object({
        action: z.literal('editor'),
        command: editorActionSchema,
        revision: z.number().int().nonnegative(),
        area: z.string(),
      })
      .strict(),
  ]),
  z.discriminatedUnion('status', [
    z
      .object({ status: z.literal('editions'), editions: z.array(planEditionChoiceSchema) })
      .strict(),
    z.object({ status: z.literal('sheets'), source: planSheetDataSchema.nullable() }).strict(),
    z
      .object({
        status: z.literal('editorSheets'),
        revision: z.number().int().nonnegative(),
        source: planSheetDataSchema,
      })
      .strict(),
    z.object({ status: z.literal('pdf'), result: z.enum(['saved', 'cancelled']) }).strict(),
    z.object({ status: z.literal('cancelled') }).strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
    z.object({ status: z.literal('editor'), state: editorStateSchema }).strict(),
    z
      .object({
        status: z.literal('place'),
        revision: z.number().int().nonnegative(),
        hint: placeHintSchema,
      })
      .strict(),
    z.object({ status: z.literal('invalid'), issues: z.array(editorIssueSchema) }).strict(),
  ]),
)
