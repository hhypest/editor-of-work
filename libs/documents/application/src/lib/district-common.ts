import {
  mm,
  type OverviewSource,
  type SheetFont,
  type SheetPrimitive,
  type TextMeasurer,
} from './sheet-model'
import { bold, regular } from './sheet-text'
import { sheetThickLine as thick } from './sheet-drawing'

/** Общее оформление схем дистанции A, B, C (ADR-0050): цвета, поля, шапка. */
export const DISTRICT_RED = '#c8102e'
export const CAPTION = '#555555'
export const WHITE = '#ffffff'
/** Тёмные заливки ПЧУ: белый текст читается на каждой. */
export const PCHU_FILLS = ['#141414', '#4b4b4b', '#2f2f2f', '#626262', '#7a7a7a'] as const
export const LEFT = 15,
  RIGHT = 405

/** Разряды через обычный пробел: в таблице ширин шрифта нет неразрывного пробела. */
export const grouped = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ' ')
/** Метры в километрах с тремя знаками: «1 234,567». */
export const kmText = (meters: number): string => {
  const [whole = '0', fraction = '000'] = (meters / 1000).toFixed(3).split('.')
  return `${grouped(whole)},${fraction}`
}
/** «1 станция», «3 станции», «5 станций». */
export function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100,
    units = count % 10
  const word =
    tens >= 11 && tens <= 14 ? many : units === 1 ? one : units >= 2 && units <= 4 ? few : many
  return `${grouped(String(count))} ${word}`
}

export interface TextOptions {
  readonly color?: string
  readonly rotate?: -90 | -45
  readonly anchor?: 'middle'
}
export const text = (
  value: string,
  x: number,
  y: number,
  font: SheetFont,
  options: TextOptions = {},
): SheetPrimitive => ({
  kind: 'text',
  text: value,
  x: mm(x),
  y: mm(y),
  font,
  ...(options.color ? { color: options.color } : {}),
  ...(options.rotate ? { rotate: options.rotate } : {}),
  ...(options.anchor ? { anchor: options.anchor } : {}),
})
export const fillRect = (x: number, y: number, width: number, height: number, fill: string) =>
  ({
    kind: 'rect',
    x: mm(x),
    y: mm(y),
    width: mm(width),
    height: mm(height),
    shade: false,
    border: false,
    fill,
  }) as const satisfies SheetPrimitive
export const colored = (shape: SheetPrimitive, color: string): SheetPrimitive =>
  shape.kind === 'line' ? { ...shape, color } : shape

/**
 * «Учебная дистанция пути» → «Схема Учебной дистанции пути». Другие формы названия не
 * склоняются: «Схема дистанции: …».
 */
export function genitiveTitle(name: string | undefined): string {
  const trimmed = name?.trim()
  if (!trimmed) return 'Схема дистанции'
  const match = /^(\S+?)ая\s+дистанция(\s.*)?$/iu.exec(trimmed)
  return match ? `Схема ${match[1]}ой дистанции${match[2] ?? ''}` : `Схема дистанции: ${trimmed}`
}

/** Шапка листа схемы дистанции: организация, заголовок, подзаголовок, утверждение, черта. */
export function districtHeader(
  source: OverviewSource,
  subtitle: string,
  measurer: TextMeasurer,
): SheetPrimitive[] {
  const right = (value: string, y: number, font: SheetFont) =>
    text(value, RIGHT - measurer.width(value, font).value, y, font)
  const district = source.district?.trim()
  return [
    text(`ОАО «РЖД»${district ? ` · ${district.toUpperCase()}` : ''}`, LEFT, 12, regular(2.6), {
      color: CAPTION,
    }),
    text(genitiveTitle(district), LEFT, 20.5, bold(6)),
    text(subtitle, LEFT, 26.5, regular(2.8)),
    right('Начальник дистанции __________ / __________ /', 12, regular(2.8)),
    right('«__» __________ 20__ г.', 18, regular(2.8)),
    colored(thick(LEFT, 30, RIGHT, 30, 0.8), DISTRICT_RED),
  ]
}
