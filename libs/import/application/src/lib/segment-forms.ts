import { err, ok, type Result } from '@eow/shared/kernel'
import type {
  ClassValues,
  SegmentForm,
  LoadValues,
  SpeedsValues,
  RailsValues,
  SleepersValues,
  BallastValues,
} from '@eow/passport/import-api'
import type { ExportError, ExportLocation, ExportTable } from './export-source'
import { columnIndex } from './export-values'
import type { ExportPoint, Validity } from './org-forms'
import { parseRows, type RowReader } from './row-reader'

export interface SourceSegment {
  readonly line: string
  readonly from: ExportPoint
  readonly to: ExportPoint
  readonly statedLength: number | null
  readonly validity: Validity
  readonly at: ExportLocation
}
export type ParsedSegment =
  | (SourceSegment & { readonly form: 'class'; readonly values: ClassValues })
  | (SourceSegment & { readonly form: 'load'; readonly values: LoadValues })
  | (SourceSegment & { readonly form: 'speeds'; readonly values: SpeedsValues })
  | (SourceSegment & { readonly form: 'rails'; readonly values: RailsValues })
  | (SourceSegment & { readonly form: 'sleepers'; readonly values: SleepersValues })
  | (SourceSegment & { readonly form: 'ballast'; readonly values: BallastValues })

/** Геометрия для совместной сверки характеристик и границ подразделений. */
export type SegmentBase = Pick<SourceSegment, 'line' | 'from' | 'to' | 'statedLength'> & {
  readonly at?: ExportLocation
}

export function isSegmentForm(form: ExportTable['form']): form is SegmentForm {
  return ['class', 'load', 'speeds', 'rails', 'sleepers', 'ballast'].includes(form)
}

export function parseSegments(table: ExportTable): Result<ParsedSegment[], readonly ExportError[]> {
  const longCoordinates = columnIndex(table, 'Км нач') >= 0
  const kmStart = longCoordinates ? 'Км нач' : 'КМ н.'
  const mStart = longCoordinates ? 'М нач' : 'М н.'
  const kmEnd = longCoordinates ? 'Км кон' : 'КМ к.'
  const mEnd = longCoordinates ? 'М кон' : 'М к.'
  const length =
    table.form === 'ballast'
      ? 'Длина участка'
      : ['rails', 'speeds'].includes(table.form)
        ? 'Длина, м'
        : 'Длина'
  const common = (r: RowReader): SourceSegment => ({
    line: r.required(table.form === 'sleepers' ? 'Путь' : 'Главный путь'),
    from: r.point(kmStart, mStart),
    to: r.point(kmEnd, mEnd),
    statedLength: r.measurement(length),
    validity: r.validity(
      columnIndex(table, 'Дата начала действия') >= 0 ? 'Дата начала действия' : 'Начало действия',
      columnIndex(table, 'Дата конца действия') >= 0 ? 'Дата конца действия' : 'Конец действия',
    ),
    at: r.location(),
  })
  switch (table.form) {
    case 'class':
      return parseRows(table, 'class', (r): ParsedSegment => ({
        ...common(r),
        form: 'class',
        values: {
          trackClass: r.text('Класс'),
          group: r.text('Группа'),
          category: r.text('Категория'),
        },
      }))
    case 'load':
      return parseRows(table, 'load', (r): ParsedSegment => ({
        ...common(r),
        form: 'load',
        values: {
          grossMillionTonKm: r.measurement('Грузонапряженность'),
          axleLoad: r.measurement('Осевая нагрузка'),
        },
      }))
    case 'speeds':
      return parseRows(table, 'speeds', (r): ParsedSegment => ({
        ...common(r),
        form: 'speeds',
        values: {
          passenger: r.measurement('ПАСС;'),
          freight: r.measurement('ГРУЗ;'),
          suburban: r.measurement('ПРИГ;'),
          empty: r.measurement('ПРЖ;'),
          express: r.measurement('СКОР;'),
          highSpeed: r.measurement('ВСКОР;'),
          restrictionReason: r.text('Причина'),
        },
      }))
    case 'rails':
      return parseRows(table, 'rails', (r): ParsedSegment => ({
        ...common(r),
        form: 'rails',
        values: {
          railType: r.text('Тип'),
          layingSign: r.text('Признак укладки'),
          linkLength: r.text('Длина'),
          hardening: r.text('Закалка'),
          purpose: r.text('Назначение'),
          plant: r.text('Завод- изготовитель'),
          railClass: r.text('Класс'),
          railGroup: r.text('Группа'),
          laidDate: r.date('Дата укладки'),
          reducedWear: r.text('Износ прив.'),
          sideWear: r.measurement('Износ бок.'),
          waveWear: r.text('Износ волн.'),
          tonnageBefore: r.measurement('Тоннаж до переукладки'),
          tonnageAfter: r.measurement('Тоннаж после укладки'),
        },
      }))
    case 'sleepers': {
      const parsed = parseRows(table, 'sleepers', (r): ParsedSegment | null => {
        if ((r.text('Признак подъездной') ?? '').toUpperCase() === 'Д') return null
        return {
          ...common(r),
          form: 'sleepers',
          values: {
            structure: r.text('№ СТП, тип ИССО'),
            baseType: r.text('Подрельсовое основание'),
            sleeperType: r.text('Тип шпал'),
            density: r.measurement('Эпюра шпал'),
            manufactureYear: r.year('Год выпуска'),
            fasteningType: r.text('Тип скреплений'),
            fasteningDefective: r.measurement('Негодные скрепления, %'),
            laidFlag: r.text('Уложены'),
            padType: r.text('Тип прокладок'),
            trackSection: r.text('Участок СТП'),
            upperAbsorberDate: r.date('Нашпальные аморт. дата укладки'),
            upperRepair: r.text('Нашпальные аморт. вид ремонта'),
            upperPlant: r.text('Нашпальные аморт. завод-изготовитель'),
            upperDefective: r.measurement('Нашпальные аморт. % негодных'),
            lowerAbsorberDate: r.date('Подрельсовые аморт. дата укладки'),
            lowerRepair: r.text('Подрельсовые аморт. вид ремонта'),
            lowerPlant: r.text('Подрельсовые аморт. завод-изготовитель'),
            lowerDefective: r.measurement('Подрельсовые аморт. процент негодных'),
            secondarySleeperType: r.text('Тип шпал (2)'),
            tonnageBefore: r.measurement('Тоннаж до переукладки'),
            tonnageAfter: r.measurement('Тоннаж после переукладки'),
            tonnage: r.measurement('Пропущенный тоннаж'),
            sidingFlag: r.text('Признак подъездной'),
          },
        }
      })
      return parsed.ok ? ok(parsed.value.filter((r) => r !== null)) : parsed
    }
    case 'ballast':
      return parseRows(table, 'ballast', (r): ParsedSegment => ({
        ...common(r),
        form: 'ballast',
        values: {
          ballastType: r.text('Род балласта'),
          thickness: r.text('Толщина балласта'),
          contamination: r.text('Наличие загрязненности'),
          separatingLayer: r.text('Наличие разделительного слоя'),
          geogridType: r.text('Вид георешетки'),
          geogridHeight: r.text('Высота георешетки'),
          protectiveThickness: r.measurement('Толщина защитного слоя'),
          protectiveType: r.text('Род защитного слоя'),
          prismShortageRight: r.measurement('Нед.шир. бал.призмы правая'),
          prismShortageLeft: r.measurement('Нед.шир. бал.призмы левая'),
          shoulderShortageRight: r.measurement('Нед.шир. обочины правая'),
          shoulderShortageLeft: r.measurement('Нед.шир. обочины левая'),
          monolithicFlag: r.text('Омоноличивание'),
          monolithicType: r.text('Тип омоноличивания'),
        },
      }))
    default:
      return err([
        {
          kind: 'unknown-form',
          at: { file: table.file, sheet: table.sheet },
          headers: table.columns.map((c) => c.name),
        },
      ])
  }
}
