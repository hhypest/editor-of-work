import { mm, type SheetPrimitive, type SheetFont } from './sheet-model'
import { regular } from './sheet-text'

export const sheetLine = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  dashed = false,
): SheetPrimitive => ({ kind: 'line', x1: mm(x1), y1: mm(y1), x2: mm(x2), y2: mm(y2), dashed })
export const sheetRect = (
  x: number,
  y: number,
  width: number,
  height: number,
  shade = false,
  border = true,
): SheetPrimitive => ({
  kind: 'rect',
  x: mm(x),
  y: mm(y),
  width: mm(width),
  height: mm(height),
  shade,
  border,
})
export const sheetText = (
  text: string,
  x: number,
  y: number,
  font: SheetFont = regular(),
): SheetPrimitive => ({ kind: 'text', text, x: mm(x), y: mm(y), font })
export function moveShapes(shapes: readonly SheetPrimitive[], dy: number): SheetPrimitive[] {
  return shapes.map((s) =>
    s.kind === 'line'
      ? { ...s, y1: mm(s.y1.value + dy), y2: mm(s.y2.value + dy) }
      : { ...s, y: mm(s.y.value + dy) },
  )
}
