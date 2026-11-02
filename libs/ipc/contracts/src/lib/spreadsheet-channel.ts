import { z } from 'zod'
import { defineChannel } from './channel'

/** Функции формул книги: только из Excel 2007 (ADR-0052). */
export const SPREADSHEET_FUNCTIONS = new Set([
  'SUM',
  'SUMIFS',
  'COUNTIFS',
  'COUNTIF',
  'INDEX',
  'MATCH',
  'CHAR',
  'T',
])
const LIMITS = { sheets: 20, rows: 50_000, columns: 50, cells: 500_000 } as const

/**
 * Формула без строк и имён листов в кавычках: в остатке ищутся вызовы функций и ссылки на
 * другие книги. Разрешены только функции из списка и ссылки внутри книги.
 */
export function formulaProblem(formula: string): string | undefined {
  if (!formula.startsWith('=')) return 'Формула начинается не с «=».'
  const bare = formula.replace(/"(?:[^"]|"")*"/gu, '""').replace(/'(?:[^']|'')*'!/gu, 'X!')
  if (/["']/u.test(bare.replaceAll('""', ''))) return 'Незакрытая кавычка в формуле.'
  if (/[[\]{}]/u.test(bare)) return 'Формула ссылается на другую книгу или массив.'
  for (const [, name] of bare.matchAll(/([\p{L}_][\p{L}\p{N}_.]*)\s*\(/gu))
    if (!SPREADSHEET_FUNCTIONS.has(name ?? '')) return `Функция ${name} не разрешена.`
  return undefined
}

const color = z
  .string()
  .regex(/^#[0-9a-f]{6}$/u)
  .optional()
const style = z
  .object({
    bold: z.boolean().optional(),
    size: z.number().min(6).max(36).optional(),
    color,
    fill: color,
    border: z.boolean().optional(),
    wrap: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']).optional(),
    format: z.enum(['0', '0.000', '#,##0']).optional(),
  })
  .strict()
const scalar = z.union([z.string().max(32_767), z.number().finite()])
const cell = z.union([
  z.object({ value: scalar, style: style.optional() }).strict(),
  z
    .object({
      formula: z
        .string()
        .max(2000)
        .superRefine((formula, context) => {
          const problem = formulaProblem(formula)
          if (problem) context.addIssue({ code: 'custom', message: problem })
        }),
      result: scalar,
      style: style.optional(),
    })
    .strict(),
  z.object({ style }).strict(),
])
const range = z.string().regex(/^[A-Z]{1,2}[1-9]\d{0,5}:[A-Z]{1,2}[1-9]\d{0,5}$/u)
export const workbookSchema = z
  .object({
    sheets: z
      .array(
        z
          .object({
            name: z
              .string()
              .min(1)
              .max(31)
              .regex(/^[^[\]:*?/\\']+$/u),
            columns: z.array(z.number().min(1).max(100)).max(LIMITS.columns),
            rows: z.array(z.array(cell.nullable()).max(LIMITS.columns)).max(LIMITS.rows),
            heights: z
              .record(z.string().regex(/^[1-9]\d*$/u), z.number().min(5).max(400))
              .optional(),
            merges: z.array(range).max(10_000).optional(),
            freeze: z
              .object({
                rows: z.number().int().min(0).max(100),
                columns: z.number().int().min(0).max(20),
              })
              .strict()
              .optional(),
            print: z
              .object({ orientation: z.enum(['portrait', 'landscape']), onePage: z.boolean() })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(LIMITS.sheets),
  })
  .strict()
  .superRefine((workbook, context) => {
    const names = workbook.sheets.map((s) => s.name.toLocaleLowerCase('ru'))
    if (new Set(names).size !== names.length)
      context.addIssue({ code: 'custom', message: 'Имена листов повторяются.' })
    const cells = workbook.sheets.reduce(
      (n, s) => n + s.rows.reduce((m, row) => m + row.length, 0),
      0,
    )
    if (cells > LIMITS.cells)
      context.addIssue({ code: 'custom', message: 'Слишком много ячеек для одной книги.' })
  })

/**
 * Книга xlsx (административное деление): renderer передаёт модель книги с формулами и
 * посчитанными результатами, main записывает её ExcelJS по выбранному пути.
 */
export const spreadsheet = defineChannel(
  'documents:xlsx',
  z
    .object({
      fileName: z.string().min(1).max(120),
      workbook: workbookSchema,
    })
    .strict(),
  z.discriminatedUnion('status', [
    z.object({ status: z.enum(['saved', 'cancelled']) }).strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
  ]),
)
