import {
  chainage,
  compareChainage,
  describeChainageError,
  distance,
  formatPlus,
  KmLengths,
  err,
  ok,
  type Result,
} from '@eow/shared/kernel'
import type {
  SegmentBasis,
  SegmentImportFile,
  SegmentPreview,
  SegmentRow,
  OrgImportError,
  OrgImportRemark,
} from '@eow/passport/import-api'
import type { ParsedSegment, SegmentBase } from './segment-forms'
import { checkKmLengths } from './km-length-check'
import type { ExportLocation } from './export-source'
import { validOn } from './org-structure'

const invalid = (message: string): Result<never, OrgImportError> =>
  err({ kind: 'invalid-import', message })
const key = (form: string, file: string): string => JSON.stringify([form, file])

/** Сверка по текущим длинам км. Это только замечания, они не изменяют километраж. */
export function segmentLengthRemarks(
  row: Pick<ParsedSegment, 'from' | 'to' | 'statedLength'> & { readonly at?: ExportLocation },
  lengths: KmLengths,
): OrgImportRemark[] {
  const remarks: OrgImportRemark[] = []
  const location = `${formatPlus(row.from)} – ${formatPlus(row.to)}`
  for (const p of [row.from, row.to]) {
    const checked = chainage(p.km, p.m, lengths)
    if (!checked.ok)
      remarks.push({
        text: `${location}: ${describeChainageError(checked.error)}. Проверьте длину этого километра; автоматически она не меняется.`,
        ...(row.at ? { at: row.at } : {}),
      })
  }
  const calculated = distance(row.from, row.to, lengths)
  if (row.statedLength !== null && calculated > 0 && row.statedLength !== calculated) {
    const lastKm = row.to.m === 0 && row.to.km > row.from.km ? row.to.km - 1 : row.to.km
    remarks.push({
      text: `${location}: в выгрузке ${row.statedLength} м, по длинам километров ${calculated} м, разница ${row.statedLength - calculated} м. Проверьте км ${row.from.km}–${lastKm}: возможен нестандартный километр или ошибка исходной длины. Автоматического изменения нет.`,
      ...(row.at ? { at: row.at } : {}),
    })
  }
  return remarks
}

/** Поля «ПД», «Предприятие (2)» и «Скорректировал» не входят в ParsedSegment. */
export function prepareSegmentImport(
  parsed: readonly ParsedSegment[],
  files: readonly Omit<SegmentImportFile, 'id' | 'warnings'>[],
  basis: SegmentBasis,
): Result<SegmentPreview, OrgImportError> {
  if (!files.length || new Set(files.map((f) => key(f.form, f.name))).size !== files.length)
    return invalid('Передайте формы характеристик со всеми частями, без повторов файлов.')
  const sourceKeys = new Set(files.map((f) => key(f.form, f.name)))
  const remarks: OrgImportRemark[] = []
  const checkRows: SegmentBase[] = []
  const known = new Map<string, KmLengths>()
  for (const line of basis.lines) {
    const lengths = KmLengths.of(line.kmLengths)
    if (!lengths.ok) return invalid(describeChainageError(lengths.error))
    known.set(line.name, lengths.value)
  }
  for (const b of basis.boundaries) {
    const line = basis.lines.find((l) => l.id === b.lineId)
    if (!line) return invalid('Направление границы отсутствует в паспорте.')
    const lengths = KmLengths.of(line.kmLengths)
    if (!lengths.ok) return invalid(describeChainageError(lengths.error))
    checkRows.push({ ...b, line: line.name })
    for (const r of segmentLengthRemarks(b, lengths.value))
      remarks.push({ text: `Граница ${b.subdivisionCode} на «${line.name}»: ${r.text}` })
  }
  const rows: SegmentRow[] = []
  const byFormAndLine = new Map<string, ParsedSegment[]>()
  for (const r of parsed) {
    if (!validOn(r.validity, basis.date)) continue
    const { line, at, validity, ...data } = r
    const candidates = basis.lines.filter((l) => l.name === line)
    if (candidates.length > 1)
      return invalid(`Направление «${line}» неоднозначно. Уточните справочник паспорта.`)
    const target = candidates[0]
    if (!target)
      return invalid(
        `Направление «${line}» отсутствует в паспорте. Сначала импортируйте оргструктуру.`,
      )
    if (!sourceKeys.has(key(r.form, at.file)))
      return invalid('Для строки характеристик отсутствуют сведения об исходном файле.')
    if (compareChainage(r.from, r.to) >= 0)
      return invalid(
        `Файл «${at.file}», лист «${at.sheet}», строка ${at.row}: конец отрезка должен быть дальше начала.`,
      )
    const lengths = KmLengths.of(target.kmLengths)
    if (!lengths.ok) return invalid(describeChainageError(lengths.error))
    remarks.push(...segmentLengthRemarks(r, lengths.value))
    checkRows.push(r)
    const group = key(r.form, line)
    const groupRows = byFormAndLine.get(group) ?? []
    groupRows.push(r)
    byFormAndLine.set(group, groupRows)
    rows.push({
      ...data,
      id: JSON.stringify([r.form, at.file, at.sheet, at.row]),
      importFileId: key(r.form, at.file),
      lineId: target.id,
      validFrom: validity.from,
      validTo: validity.to,
    })
  }
  for (const group of byFormAndLine.values()) {
    let previous: ParsedSegment | undefined
    for (const row of group.toSorted((a, b) => compareChainage(a.from, b.from))) {
      if (previous && compareChainage(row.from, previous.to) < 0)
        remarks.push({
          text: `«${row.line}», форма ${row.form}: отрезок ${formatPlus(row.from)} – ${formatPlus(row.to)} перекрывается со строкой ${previous.at.row} файла «${previous.at.file}». Проверьте исходные данные.`,
          at: row.at,
        })
      if (!previous || compareChainage(row.to, previous.to) > 0) previous = row
    }
  }
  for (const candidate of checkKmLengths(checkRows, known).candidates) {
    const text = `«${candidate.line}»: кандидат в нестандартный километр — ${candidate.km} км, ${candidate.length} м. Подтверждающих отрезков: ${candidate.evidence}. Проверьте исходные данные; длина километра автоматически не меняется.`
    const locations = [...new Map(candidate.at.map((at) => [at.file, at])).values()]
    if (locations.length) for (const at of locations) remarks.push({ text, at })
    else remarks.push({ text })
  }
  return ok({
    command: {
      date: basis.date,
      basisToken: basis.token,
      rows,
      files: files.map((f) => ({
        ...f,
        id: key(f.form, f.name),
        warnings: remarks.filter((r) => (r.at ? r.at.file === f.name : f === files[0])),
      })),
    },
    remarks,
  })
}
