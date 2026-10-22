import { err, ok, type Result } from '@eow/shared/kernel'
import {
  mm,
  type SheetError,
  type SheetFont,
  type SheetPrimitive,
  type TextMeasurer,
} from './sheet-model'

export const regular = (size = 2.8): SheetFont => ({
  family: 'PT Sans',
  size: mm(size),
  weight: 400,
})
export const narrow = (size = 2.8): SheetFont => ({
  family: 'PT Sans Narrow',
  size: mm(size),
  weight: 400,
})
export const bold = (size = 3.8): SheetFont => ({ family: 'PT Sans', size: mm(size), weight: 700 })

/** Перенос без обрезки, включая длинное слово: вся надпись либо помещается, либо даёт ошибку. */
export function wrapText(
  text: string,
  width: number,
  font: SheetFont,
  measurer: TextMeasurer,
): Result<readonly string[], SheetError> {
  const lines: string[] = []
  let line = ''
  const measure = (value: string) => measurer.width(value, font).value
  for (const word of text.trim().split(/\s+/u).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    const measured = measure(candidate)
    if (!Number.isFinite(measured) || measured < 0)
      return err({ message: 'Не удалось измерить текст листа.' })
    if (measured <= width) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = ''
    for (const char of word) {
      const charWidth = measure(char)
      if (!Number.isFinite(charWidth) || charWidth < 0)
        return err({ message: 'Не удалось измерить текст листа.' })
      if (charWidth > width)
        return err({ message: 'Символ не помещается в отведённую ширину листа.' })
      if (measure(line + char) > width) {
        lines.push(line)
        line = ''
      }
      line += char
    }
  }
  if (line) lines.push(line)
  return ok(lines)
}

export function textBlock(
  text: string,
  x: number,
  y: number,
  width: number,
  maxLines: number,
  font: SheetFont,
  measurer: TextMeasurer,
): Result<readonly SheetPrimitive[], SheetError> {
  const wrapped = wrapText(text, width, font, measurer)
  if (!wrapped.ok) return wrapped
  if (wrapped.value.length > maxLines)
    return err({
      message: `Надпись «${text.slice(0, 80)}» не помещается. Выберите более крупный масштаб или сократите название.`,
    })
  return ok(
    wrapped.value.map((value, index) => ({
      kind: 'text',
      text: value,
      x: mm(x),
      y: mm(y + index * font.size.value * 1.4),
      font,
    })),
  )
}
