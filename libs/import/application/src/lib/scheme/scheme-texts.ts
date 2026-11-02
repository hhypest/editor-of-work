import type { DrawingColor, DrawingText } from './scheme-drawing'
import { add, scale, type Point } from './scheme-geometry'

/** Text run with its box on the sheet, for matching labels to drawn objects. */
export interface PlacedText {
  readonly index: number
  readonly text: string
  readonly center: Point
  /** Unit vector along the line of text. */
  readonly dir: Point
  readonly size: number
  readonly width: number
  readonly color: 'black' | 'red' | 'blue' | 'other'
}

function colorName(c: DrawingColor): PlacedText['color'] {
  const [r, g, b] = c
  if (r < 0.25 && g < 0.25 && b < 0.25) return 'black'
  if (r > 0.7 && g < 0.35 && b < 0.35) return 'red'
  if (b > 0.6 && r < 0.35 && g < 0.35) return 'blue'
  return 'other'
}

export function placeTexts(texts: readonly DrawingText[]): PlacedText[] {
  return texts.map((t, index) => {
    const dir = { x: Math.cos(t.angle), y: Math.sin(t.angle) }
    // Glyph tops are above the baseline: "up" is the text direction turned by −90° (y down).
    const up = { x: dir.y, y: -dir.x }
    const center = add(add(t.origin, scale(dir, t.width / 2)), scale(up, t.size * 0.35))
    return {
      index,
      text: t.text,
      center,
      dir,
      size: t.size,
      width: t.width,
      color: colorName(t.color),
    }
  })
}

/** «ст.Озёрная», «ст. Лесная» — the sheet title. */
export function stationTitle(texts: readonly PlacedText[]): string | undefined {
  const titles = texts.filter((t) => /^ст\.\s*\S/iu.test(t.text)).sort((a, b) => b.size - a.size)
  return titles[0]?.text.replace(/^ст\.\s*/iu, '').trim()
}

/** Track number as written on the line: «I», «12», «1а», «IIСев», «5Юж». */
export const TRACK_NUMBER = /^(?:[IVXІ]+|\d+)[а-яёА-ЯЁa-z]{0,6}(?:-\d+)?$/u
/** Switch number: «6», «13 ав», «15р». */
// The letters are lazy so that «5ав» without a space still leaves «ав» to the suffix.
export const SWITCH_LABEL = /^(\d+[а-яё]{0,2}?)(?:\s*ав)?$/iu
/** Derailer: сбрасывающий остряк «8со ав», «4СО», «3рсо», башмак «49сб ав». */
export const DERAILER_LABEL = /^(\d+\s*р?(?:со|сб))(?:\s*ав)?$/iu
export const LENGTH_LABEL = /^\d{1,5}$/u
export const CAPACITY_LABEL = /^\d{1,4}(?:\/\d{1,4})?$/u

/** «переезд 51км», «ось переезда 376 км 1пк», «ось переезда 374км пк2». */
export function crossingPlace(text: string): { km: number | null; pk: number | null } {
  const km = /(\d+)\s*км/iu.exec(text)
  const pk = /(\d+)\s*пк|пк\s*(\d+)/iu.exec(text)
  return {
    km: km?.[1] ? Number(km[1]) : null,
    pk: pk ? Number(pk[1] ?? pk[2]) : null,
  }
}
