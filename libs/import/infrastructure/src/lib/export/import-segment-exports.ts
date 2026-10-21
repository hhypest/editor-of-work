import {
  describeExportError,
  parseSegments,
  prepareSegmentImport,
  type ExportFile,
  type ParsedSegment,
} from '@eow/import/application'
import type {
  PassportSegmentImport,
  SegmentImportFile,
  SegmentPreview,
  OrgImportError,
} from '@eow/passport/import-api'
import { err, type Result } from '@eow/shared/kernel'
import { PassportExportSource } from './passport-export-source'
import { readExportFile } from './read-export-file'

export async function importSegmentExports(
  store: PassportSegmentImport,
  request: {
    readonly editionId: number
    readonly files: readonly ExportFile[]
    readonly importedAt: string
  },
): Promise<Result<SegmentPreview, OrgImportError>> {
  const basis = await store.segmentBasis(request.editionId)
  if (!basis.ok) return basis
  const source = new PassportExportSource()
  const parsed: ParsedSegment[] = []
  const files: Omit<SegmentImportFile, 'id' | 'warnings'>[] = []
  if (new Set(request.files.map((f) => f.name)).size !== request.files.length)
    return err({ kind: 'invalid-import', message: 'Имена выбранных файлов повторяются.' })
  for (const file of request.files) {
    const read = await readExportFile(source, file)
    if (!read.ok) return err({ kind: 'invalid-import', message: describeExportError(read.error) })
    const counts = new Map<ParsedSegment['form'], number>()
    for (const table of read.value.tables) {
      const values = parseSegments(table)
      if (!values.ok)
        return err({
          kind: 'invalid-import',
          message: values.error.map(describeExportError).join('\n'),
        })
      // Разбор подтверждает тип даже у пустой формы: form уточняем явным списком.
      switch (table.form) {
        case 'class':
        case 'load':
        case 'speeds':
        case 'rails':
        case 'sleepers':
        case 'ballast':
          counts.set(table.form, (counts.get(table.form) ?? 0) + table.rows.length)
          break
        default:
          return err({
            kind: 'invalid-import',
            message: 'Выберите только формы характеристик пути.',
          })
      }
      parsed.push(...values.value)
    }
    for (const [form, rowCount] of counts)
      files.push({
        name: file.name,
        form,
        rowCount,
        importedAt: request.importedAt,
        sha256: read.value.sha256,
      })
  }
  const preview = prepareSegmentImport(parsed, files, basis.value)
  if (!preview.ok) return preview
  const saved = await store.applySegmentImport(request.editionId, preview.value.command)
  return saved.ok ? preview : saved
}
