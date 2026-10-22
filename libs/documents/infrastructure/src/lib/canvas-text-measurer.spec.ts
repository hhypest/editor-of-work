import { mm } from '@eow/documents/application'
import { CanvasTextMeasurer, prepareSheetMeasurer } from './canvas-text-measurer'

describe('Измерение встроенных шрифтов', () => {
  it('переводит миллиметры в CSS px и возвращает ширину в мм без кернинга', () => {
    const context = {
      font: '',
      fontKerning: '',
      measureText: vi.fn<() => { width: number }>(() => ({ width: 96 })),
    }
    const canvas = { getContext: () => context } as unknown as HTMLCanvasElement
    const measured = new CanvasTextMeasurer(canvas).width('Учебная', {
      family: 'PT Sans Narrow',
      size: mm(25.4),
      weight: 700,
    })
    expect(measured.value).toBeCloseTo(25.4)
    expect(context.font).toMatch(/^700 [\d.]+px "PT Sans Narrow"$/u)
    expect(Number.parseFloat(context.font.split(' ')[1]!)).toBeCloseTo(96)
    expect(context.fontKerning).toBe('none')
  })
  it('не принимает fallback вместо отсутствующего встроенного шрифта', async () => {
    const load = vi.fn<() => Promise<FontFace[]>>(async () => [])
    const document = { fonts: { load } } as unknown as Document
    await expect(prepareSheetMeasurer(document)).rejects.toThrow('Встроенные шрифты')
  })
})
