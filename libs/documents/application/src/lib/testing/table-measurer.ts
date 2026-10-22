import { mm, type TextMeasurer } from '../sheet-model'
import { advances, glyphs } from './font-advances'

/** Независимые от DOM ширины глифов именно поставляемых PT Sans; кернинг отключён. */
export const tableMeasurer: TextMeasurer = {
  width(text, font) {
    const widths =
      font.family === 'PT Sans'
        ? font.weight === 400
          ? advances.sans400
          : advances.sans700
        : font.weight === 400
          ? advances.narrow400
          : advances.narrow700
    let em = 0
    for (const char of text) {
      const index = glyphs.indexOf(char)
      if (index < 0) throw new Error(`Добавьте глиф в тестовую таблицу: ${char}`)
      em += widths[index] ?? 0.6
    }
    return mm(em * font.size.value)
  },
}
