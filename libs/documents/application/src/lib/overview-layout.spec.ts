import { buildOverview } from './overview-layout'
import { type OverviewSource, type SheetPrimitive } from './sheet-model'
import { tableMeasurer } from './testing/table-measurer'
import { wrapText, regular } from './sheet-text'

const source: OverviewSource = {
  edition: { id: 1, date: '2027-01-01', label: 'Учебная редакция' },
  lines: [
    {
      id: 'l',
      name: 'УЧЕБНОЕ',
      extents: [
        { from: { km: 10, m: 0 }, to: { km: 11, m: 0 } },
        { from: { km: 20, m: 0 }, to: { km: 21, m: 0 } },
      ],
      kmLengths: [
        [10, 964],
        [20, 1045],
      ],
    },
  ],
  axes: [{ id: 's', name: 'УЧЕБНАЯ', lineId: 'l', at: { km: 10, m: 500 } }],
  boundaries: [{ code: 'ПД-1', lineId: 'l', from: { km: 10, m: 0 }, to: { km: 11, m: 0 } }],
  warnings: [],
}
const texts = (shapes: readonly SheetPrimitive[]) =>
  shapes.filter((s) => s.kind === 'text').map((s) => s.text)

describe('Общая схема на А3', () => {
  it('нестандартные километры определяют длины в таблице и ширины схемы; разрыв не становится путём', () => {
    const result = buildOverview(source, 50000, tableMeasurer)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.pages).toHaveLength(1)
    const page = result.value.pages[0]!
    expect(page).toMatchObject({
      width: { unit: 'mm', value: 420 },
      height: { unit: 'mm', value: 297 },
    })
    expect(texts(page.primitives)).toContain('2009')
    expect(texts(page.primitives)).toContain('УЧЕБНАЯ (10+500)')
    const mainLines = page.primitives.filter(
      (s) =>
        s.kind === 'line' &&
        s.y1.value === s.y2.value &&
        s.y1.value < 230 &&
        s.x1.value === 35 &&
        s.x2.value !== 35,
    )
    expect(
      mainLines.some(
        (s) => s.kind === 'line' && Math.abs(s.x2.value - s.x1.value - 19.28) < 0.00001,
      ),
    ).toBe(true)
    const marker = page.primitives.find((s) => s.kind === 'circle' && s.y.value < 230)
    expect(marker?.kind === 'circle' ? marker.x.value : null).toBe(45)
  })
  it('фиксирует первый эталон геометрии и подписей по таблицам ширин PT Sans', () => {
    const result = buildOverview(source, 50000, tableMeasurer)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value).toMatchSnapshot()
  })
  it('масштаб меняет геометрию, не меняя длину в сводке', () => {
    const one = buildOverview(source, 25000, tableMeasurer),
      two = buildOverview(source, 50000, tableMeasurer)
    if (!one.ok || !two.ok) throw new Error('Нет схемы')
    const marker = (shapes: readonly SheetPrimitive[]) =>
      shapes.find((s) => s.kind === 'circle' && s.y.value < 230)
    expect(marker(one.value.pages[0]!.primitives)).toMatchObject({ x: { value: 55 } })
    expect(marker(two.value.pages[0]!.primitives)).toMatchObject({ x: { value: 45 } })
    expect(texts(one.value.pages[0]!.primitives)).toContain('2009')
  })
  it('разбивает длинное направление на листы и показывает ось на стыке рядов один раз', () => {
    const big: OverviewSource = {
      ...source,
      lines: [
        {
          ...source.lines[0]!,
          kmLengths: [],
          extents: [{ from: { km: 0, m: 0 }, to: { km: 100, m: 0 } }],
        },
      ],
      boundaries: [],
      axes: [{ id: 's', name: 'СТЫК', lineId: 'l', at: { km: 17, m: 500 } }],
    }
    const result = buildOverview(big, 50000, tableMeasurer)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.pages.length).toBeGreaterThan(1)
    expect(
      result.value.pages.flatMap((p) => texts(p.primitives)).filter((t) => t.startsWith('СТЫК')),
    ).toHaveLength(1)
    for (const page of result.value.pages)
      for (const primitive of page.primitives) {
        for (const value of Object.values(primitive))
          if (
            value &&
            typeof value === 'object' &&
            'unit' in value &&
            value.unit === 'mm' &&
            'value' in value
          ) {
            if (value.value < 0) throw new Error('Отрицательная геометрия')
          }
        if (primitive.kind === 'text' && primitive.y.value >= 287)
          throw new Error('Текст вне рамки')
      }
  })
  it('повторяет заголовки длинной таблицы на каждом листе продолжения', () => {
    const result = buildOverview(
      {
        ...source,
        axes: [],
        boundaries: [],
        lines: Array.from({ length: 50 }, (_, i) => ({
          id: String(i),
          name: `ПУТЬ ${i}`,
          extents: [],
          kmLengths: [],
        })),
      },
      50000,
      tableMeasurer,
    )
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.pages).toHaveLength(3)
    for (const page of result.value.pages) expect(texts(page.primitives)).toContain('Направление')
  })
  it('не показывает ось в разрыве без замечания', () => {
    const result = buildOverview(
      { ...source, axes: [{ ...source.axes[0]!, at: { km: 15, m: 0 } }] },
      50000,
      tableMeasurer,
    )
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.warnings[0]).toContain('вне протяжения')
    expect(texts(result.value.pages[0]!.primitives).some((t) => t.startsWith('УЧЕБНАЯ ('))).toBe(
      false,
    )
  })
  it('отклоняет неверный километраж, перекрытия протяжения и слишком большой документ до построения', () => {
    expect(
      buildOverview(
        { ...source, lines: [{ ...source.lines[0]!, kmLengths: [[10, 900]] }] },
        50000,
        tableMeasurer,
      ),
    ).toMatchObject({ ok: false })
    expect(
      buildOverview(
        {
          ...source,
          lines: [
            {
              ...source.lines[0]!,
              extents: [source.lines[0]!.extents[0]!, source.lines[0]!.extents[0]!],
            },
          ],
        },
        50000,
        tableMeasurer,
      ),
    ).toMatchObject({ ok: false })
    expect(
      buildOverview(
        {
          ...source,
          lines: [
            { ...source.lines[0]!, extents: [{ from: { km: 0, m: 0 }, to: { km: 100001, m: 0 } }] },
          ],
        },
        50000,
        tableMeasurer,
      ),
    ).toMatchObject({ ok: false })
  })
  it('ошибочные пересекающиеся ПД и избыток подписей не скрываются обрезкой', () => {
    expect(
      buildOverview(
        { ...source, boundaries: [...source.boundaries, source.boundaries[0]!] },
        50000,
        tableMeasurer,
      ),
    ).toMatchObject({ ok: false, error: { message: expect.stringContaining('перекрываются') } })
    expect(
      buildOverview(
        {
          ...source,
          axes: Array.from({ length: 5 }, (_, i) => ({
            ...source.axes[0]!,
            id: String(i),
            name: `СТАНЦИЯ ${i}`,
          })),
        },
        50000,
        tableMeasurer,
      ),
    ).toMatchObject({ ok: false, error: { message: expect.stringContaining('подписи осей') } })
  })
  it('переносит длинное слово без потери символов', () => {
    const result = wrapText('Железнодорожная', 8, regular(), tableMeasurer)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.join('')).toBe('Железнодорожная')
    for (const line of result.value)
      expect(tableMeasurer.width(line, regular()).value).toBeLessThanOrEqual(8)
  })
})
