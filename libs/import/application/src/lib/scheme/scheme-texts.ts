import type { DrawingColor, DrawingText } from './scheme-drawing'
import { add, scale, type Point } from './scheme-geometry'
import { IGNORED_SWITCH_SUFFIXES } from '@eow/shared/kernel'

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
/**
 * Подпись стрелки или сбрасывающего остряка у узла: «6», «13 ав», «15р», «8со ав», «3рсо».
 * По правилу составителя значим только суффикс «со» — сбрасывающий остряк, его номер
 * «8со». «ав» (автовозврат), «р», «п» отбрасываются; «сб» — не стрелка и не остряк.
 * Прочие буквы («1а») остаются частью номера стрелки.
 */
export type ObjectLabel =
  | { readonly kind: 'switch'; readonly number: string }
  | { readonly kind: 'derailer'; readonly number: string }
  | { readonly kind: 'ignored' }

export function objectLabel(text: string): ObjectLabel | undefined {
  const match = /^(\d+)([а-яё\s]*)$/iu.exec(text.trim())
  const digits = match?.[1]
  if (!digits) return undefined
  let rest = (match[2] ?? '').toLowerCase().replace(/\s+/gu, '')
  if (/^р?со(?:ав)?$/u.test(rest)) return { kind: 'derailer', number: `${digits}со` }
  if (/^сб(?:ав)?$/u.test(rest)) return { kind: 'ignored' }
  for (let changed = true; changed;) {
    changed = false
    for (const suffix of IGNORED_SWITCH_SUFFIXES)
      if (rest.endsWith(suffix)) {
        rest = rest.slice(0, -suffix.length)
        changed = true
      }
  }
  return /^[а-яё]{0,2}$/u.test(rest) ? { kind: 'switch', number: digits + rest } : undefined
}
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
