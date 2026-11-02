import { createHash } from 'node:crypto'
import { err, type Result } from '@eow/shared/kernel'
import {
  prepareSchemeImport,
  type ExportFile,
  type ExportStep,
  type SchemeSourceFile,
} from '@eow/import/application'
import type {
  OrgImportError,
  PassportStationSchemeImport,
  StationSchemePreview,
} from '@eow/passport/import-api'
import { readSchemeDrawing } from './pdf-drawing'
import { PdfSyntaxError } from './pdf-syntax'

/** Чтение PDF схемы; ошибка формата становится понятным текстом, а не исключением. */
export function readSchemeFile(file: ExportFile): SchemeSourceFile {
  const sha256 = createHash('sha256').update(file.bytes).digest('hex')
  try {
    return { name: file.name, sha256, drawing: readSchemeDrawing(file.bytes) }
  } catch (error) {
    const reason =
      error instanceof PdfSyntaxError ? error.message : 'Файл PDF повреждён или не поддерживается.'
    return { name: file.name, sha256, drawing: { error: reason } }
  }
}

export async function prepareStationSchemes(
  store: PassportStationSchemeImport,
  request: {
    readonly editionId: number
    readonly files: readonly ExportFile[]
    readonly importedAt: string
    readonly step?: ExportStep
  },
): Promise<Result<StationSchemePreview, OrgImportError>> {
  const basis = await store.stationSchemeBasis(request.editionId)
  if (!basis.ok) return basis
  if (!request.files.length) return err({ kind: 'invalid-import', message: 'Выберите PDF схем.' })
  const sources: SchemeSourceFile[] = []
  for (const [index, file] of request.files.entries()) {
    await request.step?.(index, request.files.length, file.name)
    sources.push(readSchemeFile(file))
  }
  await request.step?.(request.files.length, request.files.length, '')
  return prepareSchemeImport(sources, basis.value, request.importedAt)
}
