import { z } from 'zod'
// Длины строк совместимы с файлами v1/v2; общий размер проверяет main.
const text = z.string(),
  id = z.string()
const approval = z.object({ title: text, name: text, year: z.number().int() }).strict()
const edition = z.object({ number: id, date: z.iso.date() }).strict()
export const editorDraftSchema = z
  .object({
    kind: id,
    mode: z.enum(['line', 'station']),
    line: id,
    text,
    station: id,
    objectKind: z.enum(['none', 'track', 'switch']),
    objectNumber: id,
    volume: z.string(),
    note: text,
    callout: z.boolean(),
  })
  .strict()
export const editorActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('indicatorRows'),
      rows: z
        .array(
          z.object({ id: id.nullable(), name: text, unit: text, value: text, note: text }).strict(),
        )
        .max(10000),
    })
    .strict(),
  z.object({ kind: z.literal('editions') }).strict(),
  z
    .object({
      kind: z.literal('create'),
      editionId: z.number().int().positive(),
      year: z.number().int().min(2000).max(2100),
    })
    .strict(),
  z
    .object({
      kind: z.literal('manualRows'),
      rows: z.array(z.object({ code: id, plan: z.string(), need: z.string() }).strict()).max(1000),
    })
    .strict(),
  z.object({ kind: z.literal('state') }).strict(),
  z.object({ kind: z.literal('open') }).strict(),
  z.object({ kind: z.literal('import'), edition }).strict(),
  z.object({ kind: z.literal('save'), saveAs: z.boolean() }).strict(),
  z.object({ kind: z.literal('recover'), accept: z.boolean() }).strict(),
  z.object({ kind: z.literal('checkPlace'), line: id, text }).strict(),
  z.object({ kind: z.literal('add'), draft: editorDraftSchema }).strict(),
  z.object({ kind: z.literal('edit'), id, draft: editorDraftSchema }).strict(),
  z.object({ kind: z.literal('remove'), id }).strict(),
  z.object({ kind: z.literal('undo') }).strict(),
  z.object({ kind: z.literal('redo') }).strict(),
  z
    .object({
      kind: z.literal('manual'),
      code: id,
      field: z.enum(['overrides', 'needs']),
      value: z.string(),
    })
    .strict(),
  approval.extend({ kind: z.literal('approval') }).strict(),
])
export const editorIssueSchema = z
  .object({
    field: z.enum(['place', 'volume', 'form']),
    message: text,
    start: z.number().int().nonnegative().nullable(),
    end: z.number().int().nonnegative().nullable(),
  })
  .strict()
const view = z
  .object({
    year: z.number().int(),
    edition,
    approval,
    canUndo: z.boolean(),
    canRedo: z.boolean(),
    area: id,
    indicators: z
      .array(z.object({ id, name: text, unit: text, value: z.number(), note: text }).strict())
      .max(10000),
    lines: z.array(z.object({ id, name: text }).strict()),
    stations: z.array(
      z.object({ id, name: text, tracks: z.array(id), switches: z.array(id) }).strict(),
    ),
    kinds: z.array(z.object({ code: id, name: text, unit: id }).strict()),
    areas: z.array(z.object({ key: id, label: text }).strict()),
    works: z.array(
      z
        .object({
          id,
          name: text,
          place: text,
          volume: z.number().nonnegative(),
          unit: id,
          draft: editorDraftSchema,
        })
        .strict(),
    ),
    tables: z.array(
      z
        .object({
          title: text,
          rows: z.array(
            z
              .object({
                code: id,
                name: text,
                unit: id,
                computed: z.number().nonnegative(),
                value: z.number().nonnegative(),
                manual: z.boolean(),
                need: z.number().nonnegative().nullable(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    importReport: z.array(z.object({ path: text, message: text }).strict()),
  })
  .strict()
export const editorStateSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    dirty: z.boolean(),
    hasFile: z.boolean(),
    hasRecovery: z.boolean(),
    autosaveError: text.nullable(),
    view: view.nullable(),
  })
  .strict()
export const placeHintSchema = z
  .object({
    normalized: text.nullable(),
    meters: z.number().nonnegative().nullable(),
    issues: z.array(editorIssueSchema),
  })
  .strict()

export const planEditionChoiceSchema = z
  .object({
    id: z.number().int().positive(),
    number: z.number().int().positive(),
    date: z.iso.date(),
    label: z.string(),
    status: z.enum(['active', 'archived']),
  })
  .strict()
