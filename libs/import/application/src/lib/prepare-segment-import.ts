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
import { lengthCheckProblem } from './length-check-limits'

const invalid = (message: string): Result<never, OrgImportError> =>
  err({ kind: 'invalid-import', message })
const key = (form: string, file: string): string => JSON.stringify([form, file])

/** Сверка по текущим длинам км. Это только замечания, они не изменяют километраж. */
export function segmentLengthRemarks(
  row: Pick<ParsedSegment, 'from' | 'to' | 'statedLength'> & { readonly at?: ExportLocation },
  lengths: KmLengths,
): OrgImportRemark[] {
  const problem = lengthCheckProblem(row)
  if (problem) return [{ text: problem, ...(row.at ? { at: row.at } : {}) }]
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
  if (
    row.statedLength !== null &&
    row.statedLength !== -1 &&
    calculated > 0 &&
    row.statedLength !== calculated
  ) {
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
  const firstFile = files[0]
  if (!firstFile || new Set(files.map((f) => key(f.form, f.name))).size !== files.length)
    return invalid('Передайте формы характеристик со всеми частями, без повторов файлов.')
  const firstSource = key(firstFile.form, firstFile.name)
  const sourceKeys = new Set(files.map((f) => key(f.form, f.name)))
  const remarks: OrgImportRemark[] = []
  const warnings = new Map<string, OrgImportRemark[]>()
  const sourceBySheet = new Map<string, string>()
  const addRemark = (remark: OrgImportRemark, source = firstSource): void => {
    remarks.push(remark)
    const own = warnings.get(source) ?? []
    own.push(remark)
    warnings.set(source, own)
  }
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
    const problem = lengthCheckProblem(b)
    if (problem) return invalid(`Граница ${b.subdivisionCode} на «${line.name}»: ${problem}`)
    // В ранее сохранённых границах -1 мог остаться до нормализации отсутствующей длины.
    const boundary = { ...b, statedLength: b.statedLength === -1 ? null : b.statedLength }
    checkRows.push({ ...boundary, line: line.name })
    for (const r of segmentLengthRemarks(boundary, lengths.value))
      addRemark({ text: `Граница ${b.subdivisionCode} на «${line.name}»: ${r.text}` })
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
    const problem = lengthCheckProblem(r)
    if (problem)
      return invalid(`Файл «${at.file}», лист «${at.sheet}», строка ${at.row}: ${problem}`)
    const source = key(r.form, at.file)
    const sheet = key(at.file, at.sheet)
    if (sourceBySheet.has(sheet) && sourceBySheet.get(sheet) !== source)
      return invalid(`Лист «${at.sheet}» файла «${at.file}» отнесён к нескольким формам.`)
    sourceBySheet.set(sheet, source)
    const lengths = KmLengths.of(target.kmLengths)
    if (!lengths.ok) return invalid(describeChainageError(lengths.error))
    for (const remark of segmentLengthRemarks(r, lengths.value)) addRemark(remark, source)
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
        addRemark(
          {
            text: `«${row.line}», форма ${row.form}: отрезок ${formatPlus(row.from)} – ${formatPlus(row.to)} перекрывается со строкой ${previous.at.row} файла «${previous.at.file}». Проверьте исходные данные.`,
            at: row.at,
          },
          key(row.form, row.at.file),
        )
      if (!previous || compareChainage(row.to, previous.to) > 0) previous = row
    }
  }
  const checked = checkKmLengths(checkRows, known)
  if (!checked.ok) return checked
  for (const candidate of checked.value.candidates) {
    const text = `«${candidate.line}»: кандидат в нестандартный километр — ${candidate.km} км, ${candidate.length} м. Подтверждающих отрезков: ${candidate.evidence}. Проверьте исходные данные; длина километра автоматически не меняется.`
    const locations = new Map<string, ExportLocation>()
    for (const at of candidate.at) {
      const source = sourceBySheet.get(key(at.file, at.sheet))
      if (source && !locations.has(source)) locations.set(source, at)
    }
    if (locations.size) for (const [source, at] of locations) addRemark({ text, at }, source)
    else addRemark({ text })
  }
  return ok({
    command: {
      date: basis.date,
      basisToken: basis.token,
      rows,
      files: files.map((f) => ({
        ...f,
        id: key(f.form, f.name),
        warnings: warnings.get(key(f.form, f.name)) ?? [],
      })),
    },
    remarks,
  })
}
