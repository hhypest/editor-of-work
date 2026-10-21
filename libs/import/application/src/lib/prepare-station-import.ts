import {
  chainage,
  compareChainage,
  describeChainageError,
  err,
  KmLengths,
  ok,
  type Result,
} from '@eow/shared/kernel'
import {
  STATION_FORMS,
  type StationBasis,
  type StationImportFile,
  type StationPreview,
  type StationRow,
  type OrgImportError,
  type OrgImportRemark,
} from '@eow/passport/import-api'
import type { ImportedStationAxis, ImportedTrack, ImportedSwitch } from './station-forms'
import type { ImportedCrossing } from './crossing-forms'
import { checkStations, checkTerritories, type ImportedTerritory } from './station-check'
import type { ExportLocation } from './export-source'

export interface StationSourcesForImport {
  readonly axes: readonly ImportedStationAxis[]
  readonly tracks: readonly ImportedTrack[]
  readonly switches: readonly ImportedSwitch[]
  readonly crossings: readonly ImportedCrossing[]
  readonly territories: readonly ImportedTerritory[]
  readonly remarks: readonly OrgImportRemark[]
}
export interface StationSourceFile extends Omit<StationImportFile, 'id' | 'warnings'> {
  readonly sheets: readonly string[]
}
const key = (...parts: readonly unknown[]): string => JSON.stringify(parts)
const invalid = (message: string): Result<never, OrgImportError> =>
  err({ kind: 'invalid-import', message })
const sourceText = (at: ExportLocation): string =>
  `Файл «${at.file}», лист «${at.sheet}», строка ${at.row}`

export function prepareStationImport(
  sources: StationSourcesForImport,
  files: readonly StationSourceFile[],
  basis: StationBasis,
): Result<StationPreview, OrgImportError> {
  const first = files[0]
  if (!first || STATION_FORMS.some((form) => !files.some((f) => f.form === form)))
    return invalid('Передайте все части семи станционных форм.')
  if (new Set(files.map((f) => key(f.form, f.name))).size !== files.length)
    return invalid('Повторяются файлы станционного импорта.')
  const bySheet = new Map<string, string>()
  for (const file of files)
    for (const sheet of file.sheets) {
      const sheetKey = key(file.name, sheet),
        id = key(file.form, file.name)
      if (bySheet.has(sheetKey) && bySheet.get(sheetKey) !== id)
        return invalid('Один лист отнесён к нескольким формам.')
      bySheet.set(sheetKey, id)
    }
  for (const [group, form] of [
    [sources.axes, 'station-axes'],
    [sources.tracks, 'station-tracks'],
    [sources.switches, 'switches'],
    [sources.crossings, 'crossings-general'],
    [sources.territories, 'okato'],
  ] as const) {
    for (const row of group)
      if (bySheet.get(key(row.at.file, row.at.sheet)) !== key(form, row.at.file))
        return invalid(`${sourceText(row.at)}: отсутствуют сведения об исходной форме.`)
  }
  for (const remark of sources.remarks)
    if (remark.at && !bySheet.has(key(remark.at.file, remark.at.sheet)))
      return invalid('Для замечания отсутствует исходная форма.')
  const excluded = new Set(basis.excludedStations.map((s) => s.name))
  const checked = checkStations(
    { ...sources, lines: basis.lines.map((l) => l.name) },
    basis.date,
    excluded,
  )
  const territories = checkTerritories(sources.territories, basis.date)
  if (territories.remarks.length)
    return invalid(
      territories.remarks.map((r) => `${r.at ? sourceText(r.at) + ': ' : ''}${r.text}`).join('\n'),
    )
  const remarks: OrgImportRemark[] = [],
    warnings = new Map<string, OrgImportRemark[]>()
  const add = (remark: OrgImportRemark): void => {
    const id = remark.at
      ? bySheet.get(key(remark.at.file, remark.at.sheet))
      : key(first.form, first.name)
    if (!id) return
    remarks.push(remark)
    const own = warnings.get(id) ?? []
    own.push(remark)
    warnings.set(id, own)
  }
  for (const remark of [...sources.remarks, ...checked.remarks]) add(remark)
  const rows: StationRow[] = []
  const provenance = (
    form: StationRow['form'],
    at: ExportLocation,
    from: string | null = null,
    to = '9999-12-31',
  ) => ({
    id: key(form, at.file, at.sheet, at.row),
    importFileId: key(form, at.file),
    validFrom: from,
    validTo: to,
  })
  for (const axis of checked.axes) {
    const matches = basis.lines.filter((l) => l.name === axis.line)
    const line = matches[0]
    if (matches.length !== 1 || !line)
      return invalid(
        `${sourceText(axis.at)}: направление «${axis.line}» не найдено или неоднозначно.`,
      )
    if (axis.from && axis.to && compareChainage(axis.from, axis.to) > 0)
      return invalid(`${sourceText(axis.at)}: конец границы станции раньше начала.`)
    const lengths = KmLengths.of(line.kmLengths)
    if (!lengths.ok) return invalid(describeChainageError(lengths.error))
    for (const p of [axis.axis, axis.from, axis.to])
      if (p) {
        const point = chainage(p.km, p.m, lengths.value)
        if (!point.ok)
          add({
            text: `Станция «${axis.station}»: ${describeChainageError(point.error)}`,
            at: axis.at,
          })
      }
    if (
      (axis.from && compareChainage(axis.axis, axis.from) < 0) ||
      (axis.to && compareChainage(axis.axis, axis.to) > 0)
    )
      add({ text: `Ось станции «${axis.station}» вне её границ`, at: axis.at })
    const { at, validity, ...values } = axis
    rows.push({
      ...provenance('station-axes', at, validity.from, validity.to),
      form: 'station-axes',
      values,
    })
  }
  for (const track of checked.tracks) {
    const { at, ...values } = track
    rows.push({ ...provenance('station-tracks', at), form: 'station-tracks', values })
  }
  for (const sw of checked.switches) {
    const { at, ...values } = sw
    rows.push({ ...provenance('switches', at), form: 'switches', values })
  }
  for (const crossing of checked.crossings) {
    const { at, ...values } = crossing
    rows.push({
      ...provenance('crossings-general', at),
      form: 'crossings-general',
      values: { ...values, lines: checked.crossingLines.get(crossing.title) ?? [] },
    })
  }
  for (const territory of territories.territories) {
    const { at, validity, ...values } = territory
    rows.push({ ...provenance('okato', at, validity.from, validity.to), form: 'okato', values })
  }
  for (const row of rows)
    if (!files.some((f) => key(f.form, f.name) === row.importFileId))
      return invalid('Для строки отсутствует исходный файл.')
  // Две строки одной сущности нельзя молча свести к последней.
  const identities = rows.map((r) =>
    r.form === 'station-axes'
      ? key(r.form, r.values.station, r.values.line)
      : r.form === 'crossings-general'
        ? key(r.form, r.values.title)
        : r.form === 'okato'
          ? key(r.form, r.values.type, r.values.name)
          : key(r.form, r.values.station, r.values.number),
  )
  if (new Set(identities).size !== identities.length)
    return invalid(
      'В действующих строках повторяются станции на направлении, номера путей/стрелок или территории. Уточните исходные данные.',
    )
  return ok({
    command: {
      date: basis.date,
      basisToken: basis.token,
      rows,
      files: files.map(({ sheets: _sheets, ...f }) => ({
        ...f,
        id: key(f.form, f.name),
        warnings: warnings.get(key(f.form, f.name)) ?? [],
      })),
    },
    remarks,
    exclusionCandidates: checked.exclusionCandidates,
  })
}
