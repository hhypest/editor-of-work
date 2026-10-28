import {
  describeExportError,
  parseStationAxes,
  parseStationTracks,
  parseStationSwitches,
  parseCrossings,
  parseOkato,
  prepareStationImport,
  type ExportFile,
  type ExportStep,
  type ExportError,
  type ExportTable,
  type StationSourcesForImport,
  type StationSourceFile,
} from '@eow/import/application'
import {
  STATION_FORMS,
  type PassportStationImport,
  type StationPreview,
  type OrgImportError,
  type StationForm,
} from '@eow/passport/import-api'
import { err, type Result } from '@eow/shared/kernel'
import { PassportExportSource } from './passport-export-source'
import { readExportFile } from './read-export-file'

export async function prepareStationExports(
  store: PassportStationImport,
  request: {
    readonly editionId: number
    readonly files: readonly ExportFile[]
    readonly importedAt: string
    /** Перед каждым файлом: ход операции и точка остановки (ADR-0044). */
    readonly step?: ExportStep
  },
): Promise<Result<StationPreview, OrgImportError>> {
  const basis = await store.stationBasis(request.editionId)
  if (!basis.ok) return basis
  if (new Set(request.files.map((f) => f.name)).size !== request.files.length)
    return err({ kind: 'invalid-import', message: 'Имена выбранных файлов повторяются.' })
  const source = new PassportExportSource(),
    files: StationSourceFile[] = []
  const tables = new Map<StationForm, ExportTable[]>()
  for (const [index, file] of request.files.entries()) {
    await request.step?.(index, request.files.length, file.name)
    const read = await readExportFile(source, file)
    if (!read.ok) return err({ kind: 'invalid-import', message: describeExportError(read.error) })
    const counts = new Map<StationForm, { count: number; sheets: string[] }>()
    for (const table of read.value.tables) {
      const form = STATION_FORMS.find((f) => f === table.form)
      if (!form)
        return err({ kind: 'invalid-import', message: 'Выберите только семь станционных форм.' })
      const own = tables.get(form) ?? []
      own.push(table)
      tables.set(form, own)
      const count = counts.get(form) ?? { count: 0, sheets: [] }
      count.count += table.rows.length
      count.sheets.push(table.sheet)
      counts.set(form, count)
    }
    for (const [form, data] of counts)
      files.push({
        name: file.name,
        form,
        sha256: read.value.sha256,
        importedAt: request.importedAt,
        rowCount: data.count,
        sheets: data.sheets,
      })
  }
  // Все файлы разобраны: дальше сверка с паспортом без чтения файлов.
  await request.step?.(request.files.length, request.files.length, '')

  if (STATION_FORMS.some((f) => !tables.has(f)))
    return err({
      kind: 'invalid-import',
      message: 'Нужны все семь станционных форм, включая три книги переездов.',
    })
  const parse = <T>(
    form: StationForm,
    parser: (t: ExportTable) => Result<T[], readonly ExportError[]>,
  ): Result<T[], OrgImportError> => {
    const rows: T[] = []
    for (const table of tables.get(form) ?? []) {
      const result = parser(table)
      if (!result.ok)
        return err({
          kind: 'invalid-import',
          message: result.error.map(describeExportError).join('\n'),
        })
      rows.push(...result.value)
    }
    return { ok: true, value: rows }
  }
  const axes = parse('station-axes', parseStationAxes),
    tracks = parse('station-tracks', parseStationTracks),
    switches = parse('switches', parseStationSwitches),
    territories = parse('okato', parseOkato)
  if (!axes.ok) return axes
  if (!tracks.ok) return tracks
  if (!switches.ok) return switches
  if (!territories.ok) return territories
  const crossings = parseCrossings(
    tables.get('crossings-general') ?? [],
    tables.get('crossings-technical') ?? [],
    tables.get('crossings-operational') ?? [],
  )
  if (!crossings.ok)
    return err({
      kind: 'invalid-import',
      message: crossings.error.map(describeExportError).join('\n'),
    })
  const sources: StationSourcesForImport = {
    axes: axes.value,
    tracks: tracks.value,
    switches: switches.value,
    territories: territories.value,
    crossings: crossings.value.crossings,
    remarks: crossings.value.remarks,
  }
  const preview = prepareStationImport(sources, files, basis.value)
  if (!preview.ok) return preview
  return preview
}

export async function importStationExports(
  store: PassportStationImport,
  request: {
    readonly editionId: number
    readonly files: readonly ExportFile[]
    readonly importedAt: string
  },
): Promise<Result<StationPreview, OrgImportError>> {
  const preview = await prepareStationExports(store, request)
  if (!preview.ok) return preview
  const saved = await store.applyStationImport(request.editionId, preview.value.command)
  return saved.ok ? preview : saved
}
