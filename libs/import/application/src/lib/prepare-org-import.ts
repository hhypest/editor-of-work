import {
  type OrgForm,
  type OrgImport,
  type OrgImportFile,
  type OrgImportRow,
  type OrgImportError,
  ORG_FORMS,
} from '@eow/passport/import-api'
import { err, ok, type Result } from '@eow/shared/kernel'
import type { ExportLocation } from './export-source'
import type { Validity } from './org-forms'
import { buildOrgStructure, validOn, type OrgSources } from './org-structure'

export type OrgSourceFile = Omit<OrgImportFile, 'id' | 'warnings'>

const invalid = (message: string): Result<never, OrgImportError> =>
  err({ kind: 'invalid-import', message })
const sourceKey = (form: OrgForm, name: string): string => JSON.stringify([form, name])

const row = (form: OrgForm, at: ExportLocation, validity: Validity): OrgImportRow => ({
  id: JSON.stringify([form, at.file, at.sheet, at.row]),
  importFileId: sourceKey(form, at.file),
  validFrom: validity.from,
  validTo: validity.to,
})

/** Белый список полей: сырые ячейки и «Скорректировал» не выходят из Импорта. */
export function prepareOrgImport(
  sources: OrgSources,
  files: readonly OrgSourceFile[],
  date: string,
  selected: ReadonlySet<string>,
): Result<OrgImport, OrgImportError> {
  const keys = new Set(files.map((f) => sourceKey(f.form, f.name)))
  if (keys.size !== files.length || ORG_FORMS.some((form) => !files.some((f) => f.form === form)))
    return invalid('Передайте все четыре формы оргструктуры со всеми частями, без повторов файлов.')
  const groups = [
    ['subdivisions', sources.subdivisions],
    ['boundaries', sources.boundaries],
    ['station-pd', sources.stationPd],
    ['track-pd', sources.trackPd],
  ] as const
  for (const [form, rows] of groups) {
    if (rows.some((r) => !keys.has(sourceKey(form, r.at.file))))
      return invalid('Для строки оргструктуры отсутствуют сведения об исходном файле.')
  }
  const open = sources.subdivisions.filter((s) => validOn(s.validity, date))
  if (new Set(open.map((s) => s.code)).size !== open.length)
    return invalid(
      'На дату редакции код подразделения встречается несколько раз. Проверьте выгрузку.',
    )
  if ([...selected].some((code) => !open.some((s) => s.code === code)))
    return invalid('Отмеченное подразделение отсутствует на дату редакции. Повторите выбор.')
  const org = buildOrgStructure(sources, date, selected)
  const ids = new Map(open.map((s) => [s.code, s.externalId]))
  const active = new Set([...org.units, ...org.otherUnits].map((s) => s.code))
  const parents = new Map(org.units.map((s) => [s.code, s.parent]))
  const subdivisions = open.map((s) => ({
    ...row('subdivisions', s.at, s.validity),
    id: s.externalId,
    code: s.code,
    type: s.type,
    parentId: ids.get(parents.get(s.code) ?? '') ?? null,
    activity: s.activity,
    active: active.has(s.code),
  }))
  // Неоднозначная станция остаётся в замечаниях; единственная привязка сохраняет период источника.
  const stations = [...org.stations].flatMap(([station, pd]) => {
    const r = sources.stationPd.find(
      (s) => s.station === station && s.subdivision === pd && validOn(s.validity, date),
    )
    const subdivisionId = ids.get(pd)
    return r && subdivisionId
      ? [{ ...row('station-pd', r.at, r.validity), station, subdivisionId }]
      : []
  })
  const boundaries = org.boundaries.map((b) => ({
    ...row('boundaries', b.at, b.validity),
    line: b.line,
    statedLength: b.statedLength,
    subdivisionId: ids.get(b.subdivision) ?? '',
    from: { km: b.from.km, m: b.from.m },
    to: { km: b.to.km, m: b.to.m },
  }))
  const tracks = org.tracks.map((t) => ({
    ...row('track-pd', t.at, t.validity),
    station: t.station,
    track: t.track,
    subdivisionId: ids.get(t.subdivision) ?? '',
    meters: t.meters ? { start: t.meters.start, end: t.meters.end } : null,
  }))
  const first = files.find((f) => f.form === 'subdivisions')
  return ok({
    date,
    files: files.map((f) => ({
      id: sourceKey(f.form, f.name),
      name: f.name,
      form: f.form,
      sha256: f.sha256,
      importedAt: f.importedAt,
      rowCount: f.rowCount,
      warnings: org.remarks.filter((r) => (r.at ? r.at.file === f.name : f === first)),
    })),
    subdivisions,
    boundaries,
    stations,
    tracks,
  })
}
