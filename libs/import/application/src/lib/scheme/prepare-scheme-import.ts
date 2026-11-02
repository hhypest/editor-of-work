import { err, ok, type Result } from '@eow/shared/kernel'
import {
  checkStationLayout,
  type OrgImportError,
  type OrgImportRemark,
  type StationLayout,
  type StationSchemeBasis,
  type StationSchemeFile,
  type StationSchemeImport,
  type StationSchemePreview,
} from '@eow/passport/import-api'
import type { SchemeDrawing } from './scheme-drawing'
import { recognizeScheme, type RecognizedScheme } from './recognize-scheme'
import { schemeToLayout } from './scheme-layout'

/** Прочитанный PDF схемы или причина, по которой его не удалось прочитать. */
export interface SchemeSourceFile {
  readonly name: string
  readonly sha256: string
  readonly drawing: SchemeDrawing | { readonly error: string }
}

const invalid = (message: string): Result<never, OrgImportError> =>
  err({ kind: 'invalid-import', message })

/** «ст. Озёрная», «ОЗЕРНАЯ» → «озерная»: названия сравниваются без регистра, «ё» и пробелов. */
export const stationKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^ст\.\s*/u, '')
    .replaceAll('ё', 'е')
    .replace(/[\s"«»]+/gu, '')

/** «IIСев», «8СО», «3 ав» — номер без регистра и пробелов; кириллическая «І» как латинская. */
export const numberKey = (value: string): string =>
  value.toUpperCase().replaceAll('І', 'I').replaceAll('Ё', 'Е').replace(/\s+/gu, '')

export function prepareSchemeImport(
  files: readonly SchemeSourceFile[],
  basis: StationSchemeBasis,
  importedAt: string,
): Result<StationSchemePreview, OrgImportError> {
  if (!files.length) return invalid('Выберите PDF схем станций.')
  if (new Set(files.map((f) => f.name)).size !== files.length)
    return invalid('Имена выбранных файлов повторяются.')
  const remarks: OrgImportRemark[] = []
  const records: StationSchemeFile[] = []
  const layouts: StationSchemeImport['layouts'][number][] = []
  const seen = new Map<string, string>()
  for (const file of files) {
    const at = (text: string): OrgImportRemark => ({ text: `«${file.name}»: ${text}` })
    if ('error' in file.drawing) return invalid(`«${file.name}»: ${file.drawing.error}`)
    const recognized = recognizeScheme(file.drawing)
    if (!recognized.ok) return invalid(`«${file.name}»: ${recognized.error.message}`)
    const scheme = recognized.value
    const own = scheme.remarks.map(at)
    const station = scheme.station
      ? basis.stations.filter((s) => stationKey(s.name) === stationKey(scheme.station ?? ''))
      : []
    const target = station.length === 1 ? station[0] : undefined
    if (!target) {
      remarks.push(
        at(
          station.length > 1
            ? `станция «${scheme.station}» в паспорте не единственная; схема не будет записана.`
            : `станции «${scheme.station ?? '?'}» нет в паспорте; схема не будет записана.`,
        ),
        ...own,
      )
      continue
    }
    const earlier = seen.get(target.id)
    if (earlier) return invalid(`Схемы «${earlier}» и «${file.name}» относятся к одной станции.`)
    seen.set(target.id, file.name)
    const layout = schemeToLayout(scheme)
    const errors = checkStationLayout(layout)
    if (errors.length) {
      remarks.push(...errors.map((e) => at(`${e} Схема не будет записана.`)), ...own)
      continue
    }
    own.push(...compareWithPassport(scheme, layout, target.id, basis).map(at))
    if (basis.layouts.includes(target.id))
      own.push(at(`раскладка станции «${target.name}» будет заменена.`))
    // Время импорта в ключе: повторная загрузка того же файла получает новую запись.
    const id = JSON.stringify(['station-scheme', file.name, importedAt])
    records.push({ id, name: file.name, sha256: file.sha256, importedAt, warnings: own })
    layouts.push({ stationId: target.id, importFileId: id, layout })
    remarks.push(...own)
  }
  if (!layouts.length) return invalid('Ни одна схема не сопоставлена со станцией паспорта.')
  const replaced = layouts.filter((l) => basis.layouts.includes(l.stationId)).length
  return ok({ command: { basisToken: basis.token, files: records, layouts }, remarks, replaced })
}

function compareWithPassport(
  scheme: RecognizedScheme,
  layout: StationLayout,
  stationId: string,
  basis: StationSchemeBasis,
): string[] {
  const out: string[] = []
  const passportTracks = basis.tracks.filter((t) => t.stationId === stationId)
  const passportSwitches = new Set(
    basis.switches.filter((s) => s.stationId === stationId).map((s) => numberKey(s.number)),
  )
  const drawn = layout.tracks.filter((t) => t.number !== null)
  for (const t of drawn) {
    const match = passportTracks.find((p) => numberKey(p.number) === numberKey(t.number ?? ''))
    if (!match) {
      out.push(`путь ${t.number} есть на схеме, но не в экспликации.`)
      continue
    }
    if (
      t.fullLength !== null &&
      match.fullLength !== null &&
      Math.abs(t.fullLength - match.fullLength) > 1
    )
      out.push(`путь ${t.number}: на схеме ${t.fullLength} м, в экспликации ${match.fullLength} м.`)
  }
  const drawnNumbers = new Set(drawn.map((t) => numberKey(t.number ?? '')))
  for (const p of passportTracks)
    if (!drawnNumbers.has(numberKey(p.number)))
      out.push(`путь ${p.number} есть в экспликации, но не найден на схеме.`)
  const labels = layout.switches.flatMap((s) => (s.number === null ? [] : [s.number]))
  const counted = new Map<string, number>()
  for (const n of labels) counted.set(numberKey(n), (counted.get(numberKey(n)) ?? 0) + 1)
  for (const [n, count] of counted)
    if (count > 1) out.push(`стрелка ${n} подписана на схеме ${count} раза.`)
  for (const n of new Set(labels))
    if (!passportSwitches.has(numberKey(n)))
      out.push(`стрелка ${n} есть на схеме, но не в экспликации.`)
  const derailers = new Set(scheme.derailers.map((d) => numberKey(d.number)))
  const drawnSwitches = new Set(labels.map(numberKey))
  for (const s of basis.switches.filter((x) => x.stationId === stationId))
    if (!drawnSwitches.has(numberKey(s.number)) && !derailers.has(numberKey(s.number)))
      out.push(`стрелка ${s.number} есть в экспликации, но не найдена на схеме.`)
  return out
}
