import type { Result } from '@eow/shared/kernel'
import type { ExportError, ExportLocation, ExportTable, PassportForm } from './export-source'
import { parseRows, type ExportPoint, type RowReader } from './row-reader'

/**
 * Отрезок характеристики главного пути. Столбцы «ПД» (прежние коды) и «Скорректировал»
 * (ФИО) не читаются: ПД определяется по границам (#16), ФИО программе не нужны.
 */
export interface SegmentBase {
  readonly line: string
  readonly from: ExportPoint
  readonly to: ExportPoint
  /** Длина из выгрузки — для сверки с координатами и длинами километров. */
  readonly statedLength: number | null
  readonly at: ExportLocation
}

export interface ClassSegment extends SegmentBase {
  readonly kind: 'class'
  readonly trackClass: string | null
  readonly group: string | null
  readonly category: string | null
}

export interface LoadSegment extends SegmentBase {
  readonly kind: 'load'
  /** Грузонапряжённость, млн т·км брутто на км в год. */
  readonly gross: number | null
  readonly axleLoad: number | null
}

export interface SpeedSegment extends SegmentBase {
  readonly kind: 'speeds'
  readonly passenger: number | null
  readonly freight: number | null
  readonly suburban: number | null
  /** ПРЖ — порожние. */
  readonly empty: number | null
  readonly express: number | null
  readonly highSpeed: number | null
  readonly reason: string | null
}

export interface RailSegment extends SegmentBase {
  readonly kind: 'rails'
  readonly railType: string | null
  /** Признак укладки: П, Н, о — год последнего КР берётся по любому (раздел 6.4). */
  readonly layingSign: string | null
  readonly laidDate: string | null
  /** Длина звена, м; null у бесстыкового пути или если не указана. */
  readonly linkLength: number | null
  readonly continuousWelded: boolean
  readonly hardening: string | null
  readonly plant: string | null
  readonly railClass: string | null
  readonly railGroup: string | null
  readonly sideWear: number | null
  readonly tonnageBefore: number | null
  readonly tonnageAfter: number | null
}

export interface SleeperSegment extends SegmentBase {
  readonly kind: 'sleepers'
  readonly base: string | null
  /** Эпюра шпал, шт/км. */
  readonly density: number | null
  readonly fastening: string | null
  readonly fasteningDefective: number | null
  readonly tonnage: number | null
}

export interface BallastSegment extends SegmentBase {
  readonly kind: 'ballast'
  readonly ballastType: string | null
  /** Толщина как в выгрузке — диапазон «35-50» или «<25». */
  readonly thickness: string | null
  readonly contaminated: boolean | null
  readonly separatingLayer: string | null
  readonly protectiveLayer: string | null
  /** Недостаток ширины призмы и обочины: большее из правой и левой сторон. */
  readonly prismShortage: number | null
  readonly shoulderShortage: number | null
}

export type SegmentRecord =
  ClassSegment | LoadSegment | SpeedSegment | RailSegment | SleeperSegment | BallastSegment

export type SegmentForm = SegmentRecord['kind']

export const SEGMENT_FORMS: readonly SegmentForm[] = [
  'class',
  'load',
  'speeds',
  'rails',
  'sleepers',
  'ballast',
]

export function isSegmentForm(form: PassportForm): form is SegmentForm {
  return (SEGMENT_FORMS as readonly string[]).includes(form)
}

/** Координаты: «Км нач …» в одних формах, «КМ н. …» в других. */
const SHORT = { from: ['Км нач', 'М нач'], to: ['Км кон', 'М кон'] } as const
const DOTTED = { from: ['КМ н.', 'М н.'], to: ['КМ к.', 'М к.'] } as const

interface Layout {
  readonly line: string
  readonly coords: typeof SHORT | typeof DOTTED
  readonly length: string
}

const LAYOUTS: Readonly<Record<SegmentForm, Layout>> = {
  class: { line: 'Главный путь', coords: SHORT, length: 'Длина' },
  load: { line: 'Главный путь', coords: SHORT, length: 'Длина' },
  speeds: { line: 'Главный путь', coords: DOTTED, length: 'Длина, м' },
  rails: { line: 'Главный путь', coords: DOTTED, length: 'Длина, м' },
  sleepers: { line: 'Путь', coords: DOTTED, length: 'Длина' },
  ballast: { line: 'Главный путь', coords: DOTTED, length: 'Длина участка' },
}

function base(r: RowReader, layout: Layout): SegmentBase {
  return {
    line: r.required(layout.line),
    from: r.point(layout.coords.from[0], layout.coords.from[1]),
    to: r.point(layout.coords.to[0], layout.coords.to[1]),
    statedLength: r.number(layout.length),
    at: r.location(),
  }
}

const max = (a: number | null, b: number | null): number | null =>
  a === null ? b : b === null ? a : Math.max(a, b)

function attributes(r: RowReader, form: SegmentForm, b: SegmentBase): SegmentRecord {
  switch (form) {
    case 'class':
      return {
        ...b,
        kind: 'class',
        trackClass: r.text('Класс'),
        group: r.text('Группа'),
        category: r.text('Категория'),
      }
    case 'load':
      return {
        ...b,
        kind: 'load',
        gross: r.number('Грузонапряженность'),
        axleLoad: r.number('Осевая нагрузка'),
      }
    case 'speeds':
      return {
        ...b,
        kind: 'speeds',
        passenger: r.number('ПАСС;'),
        freight: r.number('ГРУЗ;'),
        suburban: r.number('ПРИГ;'),
        empty: r.number('ПРЖ;'),
        express: r.number('СКОР;'),
        highSpeed: r.number('ВСКОР;'),
        reason: r.text('Причина'),
      }
    case 'rails': {
      // Во втором столбце «Длина» — длина звена или «б.п.» (бесстыковой путь); встречается и «б/с».
      const link = r.text('Длина')
      const welded = link !== null && /^б\s*[./]\s*[пс]\.?$/iu.test(link)
      return {
        ...b,
        kind: 'rails',
        railType: r.text('Тип'),
        layingSign: r.text('Признак укладки'),
        laidDate: r.date('Дата укладки'),
        linkLength: welded || link === null ? null : r.number('Длина'),
        continuousWelded: welded,
        hardening: r.text('Закалка'),
        plant: r.text('Завод- изготовитель'),
        railClass: r.text('Класс'),
        railGroup: r.text('Группа'),
        sideWear: r.number('Износ бок.'),
        tonnageBefore: r.number('Тоннаж до переукладки'),
        tonnageAfter: r.number('Тоннаж после укладки'),
      }
    }
    case 'sleepers':
      return {
        ...b,
        kind: 'sleepers',
        base: r.text('Подрельсовое основание'),
        density: r.number('Эпюра шпал'),
        fastening: r.text('Тип скреплений'),
        fasteningDefective: r.number('Негодные скрепления, %'),
        tonnage: r.number('Пропущенный тоннаж'),
      }
    case 'ballast': {
      const contamination = r.text('Наличие загрязненности')
      // «-1» в толщине защитного слоя — «слоя нет», а не число.
      const protective = r.text('Толщина защитного слоя')
      return {
        ...b,
        kind: 'ballast',
        ballastType: r.text('Род балласта'),
        thickness: r.text('Толщина балласта'),
        contaminated: contamination === null ? null : contamination.toUpperCase() === 'Д',
        separatingLayer: r.text('Наличие разделительного слоя'),
        protectiveLayer:
          protective === null || protective === '-1' ? null : r.text('Род защитного слоя'),
        prismShortage: max(
          r.number('Нед.шир. бал.призмы правая'),
          r.number('Нед.шир. бал.призмы левая'),
        ),
        shoulderShortage: max(
          r.number('Нед.шир. обочины правая'),
          r.number('Нед.шир. обочины левая'),
        ),
      }
    }
  }
}

/**
 * Разбор формы характеристик по отрезкам. В форме «Шпалы и скрепления» есть и подъездные
 * пути: строки с признаком подъездного пути не относятся к главным путям и пропускаются.
 */
export function parseSegments(table: ExportTable): Result<SegmentRecord[], readonly ExportError[]> {
  const form = table.form
  if (!isSegmentForm(form)) throw new Error(`форма ${form} — не характеристика по отрезкам`)
  const layout = LAYOUTS[form]
  const parsed = parseRows(table, form, (r) => {
    const siding = form === 'sleepers' && (r.text('Признак подъездной') ?? '').toUpperCase() === 'Д'
    return siding ? null : attributes(r, form, base(r, layout))
  })
  return parsed.ok ? { ok: true, value: parsed.value.filter((x) => x !== null) } : parsed
}
