import { err, ok, type Result } from '@eow/shared/kernel'
import { type SheetError, type TextMeasurer, type SheetPrimitive } from './sheet-model'
import { narrow, wrapText } from './sheet-text'
import { sheetRect, sheetText, sheetLine } from './sheet-drawing'

export interface CalloutInput {
  readonly id: string
  readonly anchor: number
  readonly text: string
}
export interface PackedCallout {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly anchor: number
  readonly lines: readonly string[]
}
export interface CalloutBand {
  readonly boxes: readonly PackedCallout[]
  readonly height: number
}

/** До четырёх полос на повтор ряда. Выноски сохраняются целиком, избыток идёт в продолжение. */
export function packCallouts(
  inputs: readonly CalloutInput[],
  measurer: TextMeasurer,
): Result<readonly CalloutBand[], SheetError> {
  const bands: CalloutBand[] = []
  let lanes: { right: number; height: number; boxes: Omit<PackedCallout, 'y'>[] }[] = []
  const flush = (): void => {
    let y = 0
    const boxes: PackedCallout[] = []
    for (const lane of lanes) {
      boxes.push(...lane.boxes.map((b) => ({ ...b, y })))
      y += lane.height + 3
    }
    bands.push({ boxes, height: y ? y - 3 : 0 })
    lanes = []
  }
  for (const input of inputs.toSorted((a, b) => a.anchor - b.anchor || a.id.localeCompare(b.id))) {
    if (!Number.isFinite(input.anchor) || input.anchor < 35 || input.anchor > 385)
      return err({ message: 'Выноска вне ряда направления.' })
    const lines = wrapText(input.text, 64, narrow(2.5), measurer)
    if (!lines.ok) return lines
    if (lines.value.length > 6)
      return err({
        message: 'Текст выноски превышает шесть строк. Сократите название работы или место.',
      })
    const width = 68,
      height = Math.max(9, lines.value.length * 3.5 + 4)
    let lane = lanes.find(
      (l) =>
        Math.max(15, Math.min(input.anchor - width / 2, 405 - width), l.right + 3) + width <= 405,
    )
    if (!lane && lanes.length === 4) flush()
    if (!lane) {
      lane = { right: 12, height: 0, boxes: [] }
      lanes.push(lane)
    }
    const x = Math.max(15, Math.min(input.anchor - width / 2, 405 - width), lane.right + 3)
    lane.boxes.push({ ...input, x, width, height, lines: lines.value })
    lane.height = Math.max(lane.height, height)
    lane.right = x + width
  }
  if (lanes.length || !bands.length) flush()
  return ok(bands)
}

export function drawCallouts(
  band: CalloutBand,
  top: number,
  baseline: number,
): readonly SheetPrimitive[] {
  return [
    ...band.boxes.flatMap((b) => [sheetLine(b.anchor, baseline, b.x + b.width / 2, top + b.y)]),
    ...band.boxes.flatMap((b) => [
      sheetRect(b.x, top + b.y, b.width, b.height),
      ...b.lines.map((s, i) => sheetText(s, b.x + 2, top + b.y + 4 + i * 3.5, narrow(2.5))),
    ]),
  ]
}
