import { createHash } from 'node:crypto'
import {
  describeExportError,
  parseBoundaries,
  parseStationPd,
  parseSubdivisions,
  parseTrackPd,
  prepareOrgImport,
  type ExportFile,
  type OrgSourceFile,
  type OrgSources,
} from '@eow/import/application'
import type { OrgImportFile, OrgImportError, PassportOrgImport } from '@eow/passport/import-api'
import { err, type Result } from '@eow/shared/kernel'
import { PassportExportSource } from './passport-export-source'

const invalid = (message: string): Result<never, OrgImportError> =>
  err({ kind: 'invalid-import', message })

/** Main-процесс: файлы уже выбраны пользователем; UI мастера относится к #21. */
export async function importOrgExports(
  store: PassportOrgImport,
  files: readonly ExportFile[],
  date: string,
  selected: ReadonlySet<string>,
  importedAt: string,
  editionId: number,
): Promise<Result<readonly OrgImportFile[], OrgImportError>> {
  const source = new PassportExportSource()
  const sources: { -readonly [K in keyof OrgSources]: OrgSources[K][number][] } = {
    subdivisions: [],
    boundaries: [],
    stationPd: [],
    trackPd: [],
  }
  const metadata: OrgSourceFile[] = []
  if (new Set(files.map((f) => f.name)).size !== files.length)
    return invalid('Имена выбранных файлов повторяются. Выберите однозначный набор выгрузок.')
  for (const file of files) {
    const read = await source.read(file)
    if (!read.ok) return invalid(describeExportError(read.error))
    const counts = new Map<OrgSourceFile['form'], number>()
    for (const table of read.value) {
      switch (table.form) {
        case 'subdivisions': {
          const parsed = parseSubdivisions(table)
          if (!parsed.ok) return invalid(parsed.error.map(describeExportError).join('\n'))
          sources.subdivisions.push(...parsed.value)
          break
        }
        case 'boundaries': {
          const parsed = parseBoundaries(table)
          if (!parsed.ok) return invalid(parsed.error.map(describeExportError).join('\n'))
          sources.boundaries.push(...parsed.value)
          break
        }
        case 'station-pd': {
          const parsed = parseStationPd(table)
          if (!parsed.ok) return invalid(parsed.error.map(describeExportError).join('\n'))
          sources.stationPd.push(...parsed.value)
          break
        }
        case 'track-pd': {
          const parsed = parseTrackPd(table)
          if (!parsed.ok) return invalid(parsed.error.map(describeExportError).join('\n'))
          sources.trackPd.push(...parsed.value)
          break
        }
        default:
          return invalid(
            'Для оргструктуры выберите только подразделения, границы, станции и пути → ПД.',
          )
      }
      counts.set(table.form, (counts.get(table.form) ?? 0) + table.rows.length)
    }
    for (const [form, rowCount] of counts)
      metadata.push({
        name: file.name,
        form,
        rowCount,
        importedAt,
        sha256: createHash('sha256').update(file.bytes).digest('hex'),
      })
  }
  const prepared = prepareOrgImport(sources, metadata, date, selected)
  if (!prepared.ok) return prepared
  const saved = await store.applyOrgImport(editionId, prepared.value)
  return saved.ok ? { ok: true, value: prepared.value.files } : saved
}
