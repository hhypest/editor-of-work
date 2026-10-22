import { mm, type SheetFont, type SheetMm, type TextMeasurer } from '@eow/documents/application'

export class CanvasTextMeasurer implements TextMeasurer {
  private readonly context: CanvasRenderingContext2D
  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не удалось подготовить измерение текста.')
    this.context = context
    this.context.fontKerning = 'none'
  }
  width(text: string, font: SheetFont): SheetMm {
    this.context.font = `${font.weight} ${(font.size.value * 96) / 25.4}px "${font.family}"`
    return mm((this.context.measureText(text).width * 25.4) / 96)
  }
}

/** Ждём именно встроенные шрифты, чтобы геометрия не считалась по временному fallback. */
export async function prepareSheetMeasurer(document: Document): Promise<TextMeasurer> {
  for (const family of ['PT Sans', 'PT Sans Narrow'])
    for (const weight of [400, 700]) {
      const fonts = await document.fonts.load(`${weight} 12px "${family}"`, 'Схема 0123456789')
      if (!fonts.length || fonts.some((font) => font.status !== 'loaded'))
        throw new Error('Встроенные шрифты не загрузились. Перезапустите программу.')
    }
  return new CanvasTextMeasurer(document.createElement('canvas'))
}
