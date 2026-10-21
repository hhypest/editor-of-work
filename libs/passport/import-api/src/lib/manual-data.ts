import {
  chainage,
  compareChainage,
  KmLengths,
  type Chainage,
  type Result,
} from '@eow/shared/kernel'
import type { OrgImportError, OrgImportFile } from './org-import'
import type { StationBasis } from './station-import'

export const MANUAL_SHEETS = {
  workKinds: 'Виды работ',
  repairNorms: 'Периодичность ремонтов',
  tolerances: 'Допуски',
  trainPairs: 'Пары поездов',
  kilometres: 'Нестандартные километры',
} as const
interface ManualRow {
  readonly id: string
  readonly validFrom: string | null
  readonly validTo: string | null
}
export interface ManualWorkKind extends ManualRow {
  readonly code: string
  readonly name: string
  readonly unit: string
  readonly group: string
  readonly symbol: string | null
  readonly includedIn: string | null
}
export interface ManualRepairNorm extends ManualRow {
  readonly workCode: string
  readonly trackClass: string | null
  readonly trackGroup: string | null
  readonly trackCategory: string | null
  readonly railType: string | null
  readonly sleeperType: string | null
  readonly years: number | null
  readonly millionTons: number | null
}
export interface ManualTolerance extends ManualRow {
  readonly code: string
  readonly name: string
  readonly value: number
  readonly unit: string
  readonly conditions: string | null
}
export interface ManualTrainPairs extends ManualRow {
  readonly line: string
  readonly from: Chainage
  readonly to: Chainage
  readonly freight: number | null
  readonly passenger: number | null
  readonly suburban: number | null
}
export interface ManualKilometre extends ManualRow {
  readonly line: string
  readonly km: number
  readonly length: number
}
export interface ManualData {
  readonly workKinds: readonly ManualWorkKind[]
  readonly repairNorms: readonly ManualRepairNorm[]
  readonly tolerances: readonly ManualTolerance[]
  readonly trainPairs: readonly ManualTrainPairs[]
  readonly kilometres: readonly ManualKilometre[]
}
export interface ManualBasis {
  readonly token: string
  readonly date: string
  readonly lines: StationBasis['lines']
  readonly trackClasses: readonly string[]
  readonly data: ManualData
}
export interface ManualIssue {
  readonly sheet: string
  readonly row: number
  readonly column: string
  readonly message: string
}
export interface ManualImportFile extends Omit<OrgImportFile, 'form'> {
  readonly form: 'manual-data'
}
export interface ManualImport {
  readonly basisToken: string
  readonly date: string
  readonly data: ManualData
  readonly file: ManualImportFile
}
export interface PassportManualData {
  manualImportReport(
    editionId: number,
  ): Promise<Result<readonly ManualImportFile[], OrgImportError>>
  manualBasis(editionId: number): Promise<Result<ManualBasis, OrgImportError>>
  applyManualData(editionId: number, input: ManualImport): Promise<Result<void, OrgImportError>>
}

/** Проверки опубликованного языка выполняются и перед предпросмотром, и внутри транзакции. */
export function validateManualData(
  data: ManualData,
  basis: Pick<ManualBasis, 'lines' | 'trackClasses'>,
): readonly ManualIssue[] {
  const issues: ManualIssue[] = []
  const add = (sheet: string, index: number, column: string, message: string): void => {
    issues.push({ sheet, row: index + 2, column, message })
  }
  for (const [key, sheet] of Object.entries(MANUAL_SHEETS)) {
    const rows = data[key as keyof ManualData]
    const seen = new Set<string>()
    rows.forEach((r, i) => {
      if (seen.has(r.id)) add(sheet, i, 'Идентификатор', 'Повторяется идентификатор строки')
      seen.add(r.id)
      if (r.validFrom && r.validTo && r.validFrom > r.validTo)
        add(sheet, i, 'Конец действия', 'Конец периода раньше начала')
    })
  }
  const kinds = new Map(data.workKinds.map((k) => [k.code, k]))
  const codes = new Set<string>()
  data.workKinds.forEach((k, i) => {
    const sheet = MANUAL_SHEETS.workKinds
    if (codes.has(k.code)) add(sheet, i, 'Код', 'Код вида работ должен быть уникален')
    codes.add(k.code)
    if (!['current', 'capital', 'other'].includes(k.group))
      add(sheet, i, 'Группа', 'Укажите текущее, капитальное или прочее')
    if (k.includedIn !== null) {
      const parent = kinds.get(k.includedIn)
      if (!parent) add(sheet, i, 'Входит в', 'Нет такого вида работ')
      else if (parent.unit !== k.unit)
        add(sheet, i, 'Входит в', 'Единицы входящих видов работ должны совпадать')
    }
    const seen = new Set<string>()
    let current: ManualWorkKind | undefined = k
    while (current) {
      if (seen.has(current.code)) {
        add(sheet, i, 'Входит в', 'Цикл вхождения видов работ')
        break
      }
      seen.add(current.code)
      current = current.includedIn === null ? undefined : kinds.get(current.includedIn)
    }
  })
  data.repairNorms.forEach((r, i) => {
    const sheet = MANUAL_SHEETS.repairNorms
    if (!kinds.has(r.workCode)) add(sheet, i, 'Вид ремонта', 'Нет такого вида работ')
    if (r.trackClass !== null && !basis.trackClasses.includes(r.trackClass))
      add(sheet, i, 'Класс пути', 'Класс отсутствует в характеристиках паспорта')
    if (r.years === null && r.millionTons === null)
      add(sheet, i, 'Лет', 'Укажите хотя бы один порог: лет или млн т брутто')
    for (const [column, n] of [
      ['Лет', r.years],
      ['Млн т брутто', r.millionTons],
    ] as const)
      if (n !== null && (!Number.isFinite(n) || n <= 0))
        add(sheet, i, column, 'Порог должен быть положительным числом')
    const selector = (n: ManualRepairNorm): string =>
      JSON.stringify([
        n.workCode,
        n.trackClass,
        n.trackGroup,
        n.trackCategory,
        n.railType,
        n.sleeperType,
      ])
    if (
      data.repairNorms
        .slice(0, i)
        .some(
          (p) =>
            selector(p) === selector(r) &&
            (p.validFrom ?? '') <= (r.validTo ?? '9999-12-31') &&
            (r.validFrom ?? '') <= (p.validTo ?? '9999-12-31'),
        )
    )
      add(sheet, i, 'Вид ремонта', 'Повторяются условия нормы в пересекающихся периодах')
  })
  const toleranceCodes = new Set<string>()
  data.tolerances.forEach((r, i) => {
    if (!Number.isFinite(r.value))
      add(MANUAL_SHEETS.tolerances, i, 'Значение', 'Нужно конечное число')
    if (toleranceCodes.has(r.code))
      add(MANUAL_SHEETS.tolerances, i, 'Код', 'Повторяется код допуска')
    toleranceCodes.add(r.code)
  })
  const line = (name: string, sheet: string, i: number) => {
    const found = basis.lines.filter((l) => l.name === name)
    if (found.length !== 1) add(sheet, i, 'Направление', 'Направление отсутствует или неоднозначно')
    return found.length === 1 ? found[0] : undefined
  }
  const kmKeys = new Set<string>()
  data.kilometres.forEach((r, i) => {
    const found = line(r.line, MANUAL_SHEETS.kilometres, i)
    const lengths = KmLengths.of([[r.km, r.length]])
    if (!lengths.ok)
      add(
        MANUAL_SHEETS.kilometres,
        i,
        'Длина, м',
        'Нужны целый неотрицательный км и целая длина больше девяти пикетов',
      )
    if (
      found &&
      !found.extents.some(
        (e) => e.from.km <= r.km && (e.to.km > r.km || (e.to.km === r.km && e.to.m > 0)),
      )
    )
      add(MANUAL_SHEETS.kilometres, i, 'Км', 'Километр вне протяжения направления или в разрыве')
    const key = JSON.stringify([r.line, r.km])
    if (kmKeys.has(key)) add(MANUAL_SHEETS.kilometres, i, 'Км', 'Повторяется длина километра')
    kmKeys.add(key)
  })
  data.trainPairs.forEach((r, i) => {
    const sheet = MANUAL_SHEETS.trainPairs,
      found = line(r.line, sheet, i)
    const lengths = KmLengths.of(
      data.kilometres.filter((k) => k.line === r.line).map((k) => [k.km, k.length] as const),
    )
    if (!lengths.ok) return
    for (const point of [r.from, r.to])
      if (!chainage(point.km, point.m, lengths.value).ok)
        add(sheet, i, 'Координаты', 'Координата вне длины километра')
    if (compareChainage(r.from, r.to) >= 0)
      add(sheet, i, 'Конец, км', 'Нужен участок положительной длины')
    if (
      found &&
      !found.extents.some(
        (e) => compareChainage(e.from, r.from) <= 0 && compareChainage(r.to, e.to) <= 0,
      )
    )
      add(sheet, i, 'Координаты', 'Участок вне протяжения направления или пересекает разрыв')
    for (const n of [r.freight, r.passenger, r.suburban])
      if (n !== null && (!Number.isFinite(n) || n < 0))
        add(sheet, i, 'Пары поездов', 'Число пар не может быть отрицательным')
    if (
      data.trainPairs
        .slice(0, i)
        .some(
          (p) =>
            p.line === r.line &&
            compareChainage(p.from, r.to) < 0 &&
            compareChainage(r.from, p.to) < 0 &&
            (p.validFrom ?? '') <= (r.validTo ?? '9999-12-31') &&
            (r.validFrom ?? '') <= (p.validTo ?? '9999-12-31'),
        )
    )
      add(sheet, i, 'Координаты', 'Участки пар поездов перекрываются в одном периоде')
  })
  return issues
}
