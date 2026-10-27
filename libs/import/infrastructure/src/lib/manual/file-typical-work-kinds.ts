import { readFile, stat } from 'node:fs/promises'
import { z } from 'zod'
import { err, ok, type Result } from '@eow/shared/kernel'
import { validateManualData } from '@eow/passport/import-api'
import type { TypicalWorkKind, TypicalWorkKindCatalog } from '@eow/import/application'

/** Имя файла каталога рядом с main (копируется при сборке, ADR-0032). */
export const TYPICAL_WORK_KINDS_FILE = 'typical-work-kinds.json'
export const MAX_TYPICAL_CATALOG_BYTES = 1024 * 1024
const text = z.string().trim().min(1).max(500)
const catalogSchema = z
  .object({
    format: z.literal(1),
    title: text,
    source: text,
    kinds: z
      .array(
        z
          .object({
            code: z.string().trim().min(1).max(64),
            name: text,
            unit: z.string().trim().min(1).max(64),
            group: z.enum(['current', 'capital', 'other']),
            includedIn: z.string().trim().min(1).max(64).nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict()

/** Проверяет каталог так же, как лист «Виды работ» шаблона: коды, единицы «входит в», циклы. */
export function parseTypicalWorkKinds(
  json: string,
): Result<readonly TypicalWorkKind[], { readonly message: string }> {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return err({ message: 'Типовой перечень видов работ повреждён: файл не является JSON.' })
  }
  const parsed = catalogSchema.safeParse(raw)
  if (!parsed.success)
    return err({ message: 'Типовой перечень видов работ повреждён: неверная структура файла.' })
  const issues = validateManualData(
    {
      workKinds: parsed.data.kinds.map((k, i) => ({
        ...k,
        id: String(i),
        validFrom: null,
        validTo: null,
        symbol: null,
      })),
      repairNorms: [],
      tolerances: [],
      trainPairs: [],
      kilometres: [],
    },
    { lines: [], trackClasses: [] },
  )
  const first = issues[0]
  if (first)
    return err({
      message: `Типовой перечень видов работ повреждён: строка ${first.row - 1}, «${first.column}»: ${first.message}.`,
    })
  return ok(parsed.data.kinds)
}

export class FileTypicalWorkKindCatalog implements TypicalWorkKindCatalog {
  constructor(private readonly path: string) {}
  async load(): Promise<Result<readonly TypicalWorkKind[], { readonly message: string }>> {
    try {
      if ((await stat(this.path)).size > MAX_TYPICAL_CATALOG_BYTES)
        return err({ message: 'Типовой перечень видов работ слишком велик.' })
      return parseTypicalWorkKinds(await readFile(this.path, 'utf8'))
    } catch {
      return err({
        message: 'Типовой перечень видов работ не найден рядом с программой. Переустановите её.',
      })
    }
  }
}
