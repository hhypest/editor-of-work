import { createHash } from 'node:crypto'
import { err, ok, type IdGenerator, type Result } from '@eow/shared/kernel'
import {
  MANUAL_SHEETS,
  validateManualData,
  type ManualBasis,
  type OrgImportError,
  type PassportManualData,
} from '@eow/passport/import-api'
import {
  addTypicalWorkKinds,
  type ManualDataTemplate,
  type ManualTemplatePreview,
  type TypicalWorkKindCatalog,
  type TypicalWorkKindsSummary,
} from '@eow/import/application'
import { MANUAL_KEYS } from './manual-layout'
/**
 * Выдаёт книгу с текущими данными редакции. С типовым перечнем недостающие виды работ
 * дописываются только в книгу: паспорт меняется лишь после загрузки и подтверждения.
 */
export async function exportManualTemplate(
  store: PassportManualData,
  template: ManualDataTemplate,
  editionId: number,
  typical?: { readonly catalog: TypicalWorkKindCatalog; readonly ids: IdGenerator },
): Promise<
  Result<
    { readonly bytes: Uint8Array; readonly typical: TypicalWorkKindsSummary | null },
    OrgImportError
  >
> {
  const basis = await store.manualBasis(editionId)
  if (!basis.ok) return basis
  let data = basis.value.data,
    summary: TypicalWorkKindsSummary | null = null
  if (typical) {
    const kinds = await typical.catalog.load()
    if (!kinds.ok) return err({ kind: 'invalid-import', message: kinds.error.message })
    const merged = addTypicalWorkKinds(data, kinds.value, typical.ids)
    data = merged.data
    summary = merged.summary
  }
  const bytes = await template.write({ ...basis.value, data })
  return bytes.ok
    ? ok({ bytes: bytes.value, typical: summary })
    : err({ kind: 'invalid-import', message: bytes.error.map((e) => e.message).join('\n') })
}
export async function prepareManualTemplate(
  template: ManualDataTemplate,
  basis: ManualBasis,
  file: { readonly name: string; readonly bytes: Uint8Array },
  importedAt: string,
): Promise<Result<ManualTemplatePreview, OrgImportError>> {
  const read = await template.read(file.bytes)
  if (!read.ok)
    return err({
      kind: 'invalid-import',
      message: read.error
        .map((e) => `Лист «${e.sheet}», строка ${e.row}, «${e.column}»: ${e.message}`)
        .join('\n'),
    })
  if (read.value.date !== basis.date || read.value.basisToken !== basis.token)
    return err({
      kind: 'invalid-import',
      message:
        'Ручные данные или основа паспорта изменились. Выдайте новый шаблон и перенесите изменения.',
    })
  const issues = validateManualData(read.value.data, basis)
  if (issues.length)
    return err({
      kind: 'invalid-import',
      message: issues
        .map((e) => {
          const key = MANUAL_KEYS.find((k) => MANUAL_SHEETS[k] === e.sheet)
          const row = key ? (read.value.sourceRows[key][e.row - 2] ?? e.row) : e.row
          return `Лист «${e.sheet}», строка ${row}, «${e.column}»: ${e.message}`
        })
        .join('\n'),
    })
  const signature = (r: object): string =>
    JSON.stringify(Object.entries(r).toSorted(([a], [b]) => a.localeCompare(b)))
  return ok({
    command: {
      basisToken: basis.token,
      date: basis.date,
      data: read.value.data,
      file: {
        id: JSON.stringify(['manual-data', file.name]),
        form: 'manual-data',
        name: file.name,
        importedAt,
        sha256: createHash('sha256').update(file.bytes).digest('hex'),
        rowCount: MANUAL_KEYS.reduce((n, k) => n + read.value.data[k].length, 0),
        warnings: [],
      },
    },
    changes: MANUAL_KEYS.map((key) => {
      const before = new Map(basis.data[key].map((r) => [r.id, signature(r)])),
        after = new Map(read.value.data[key].map((r) => [r.id, signature(r)]))
      return {
        sheet: MANUAL_SHEETS[key],
        added: [...after.keys()].filter((id) => !before.has(id)).length,
        removed: [...before.keys()].filter((id) => !after.has(id)).length,
        changed: [...after].filter(([id, value]) => before.has(id) && before.get(id) !== value)
          .length,
      }
    }),
  })
}
export async function importManualTemplate(
  store: PassportManualData,
  template: ManualDataTemplate,
  request: {
    readonly editionId: number
    readonly file: { readonly name: string; readonly bytes: Uint8Array }
    readonly importedAt: string
  },
): Promise<Result<ManualTemplatePreview, OrgImportError>> {
  const basis = await store.manualBasis(request.editionId)
  if (!basis.ok) return basis
  const preview = await prepareManualTemplate(
    template,
    basis.value,
    request.file,
    request.importedAt,
  )
  if (!preview.ok) return preview
  const saved = await store.applyManualData(request.editionId, preview.value.command)
  return saved.ok ? preview : saved
}
