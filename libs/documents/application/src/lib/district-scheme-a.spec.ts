import { buildDistrictSchemeA } from './district-scheme-a'
import type { OverviewSource, SheetPrimitive } from './sheet-model'
import { fictionalDistrict } from './testing/fictional-district'
import { tableMeasurer } from './testing/table-measurer'

const texts = (shapes: readonly SheetPrimitive[]) =>
  shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []))
function built(source: OverviewSource = fictionalDistrict()) {
  const result = buildDistrictSchemeA(source, tableMeasurer)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
const thickLines = (shapes: readonly SheetPrimitive[]) =>
  shapes.filter((s) => s.kind === 'line' && s.weight?.value === 0.8 && s.y1.value < 250)

describe('Схема дистанции, вариант A', () => {
  it('выбирает самый крупный масштаб, при котором самое длинное направление помещается', () => {
    const document = built()
    expect(document.scale).toBe(300_000)
    expect(document.pages).toHaveLength(1)
    // 100–205 км с км 120 длиной 964 м и км 150 длиной 1120 м: 105 084 м в 1:300 000.
    const main = thickLines(document.pages[0]!.primitives)[0]!
    expect(main.kind === 'line' && main.x2.value - main.x1.value).toBeCloseTo(105_084 / 300, 6)
    expect(texts(document.pages[0]!.primitives)).toContain(
      'Редакция от 2027-01-01 · Масштаб 1:300 000 · Лист 1',
    )
  })

  it('рисует разрыв протяжения отрезком без масштаба и не соединяет части линией пути', () => {
    const page = built().pages[0]!
    const parts = thickLines(page.primitives).filter(
      (s) =>
        s.kind === 'line' &&
        Math.abs(s.y1.value - (thickLines(page.primitives)[1]?.y1.value ?? 0)) < 0.01,
    )
    expect(parts).toHaveLength(2)
    const [a, b] = parts
    expect(a?.kind === 'line' && b?.kind === 'line' && b.x1.value - a.x2.value).toBeCloseTo(10, 6)
    expect(texts(page.primitives)).toEqual(expect.arrayContaining(['40+000', '55+000']))
  })

  it('сливает соседние ПД одного ПЧУ и сообщает о ПД без ПЧУ', () => {
    const document = built()
    const words = texts(document.pages[0]!.primitives)
    expect(words.filter((t) => t === 'ПЧУ-1')).toHaveLength(1)
    expect(words.filter((t) => t === 'ПЧУ-2')).toHaveLength(4)
    expect(words).toContain('ПД-6')
    expect(document.warnings).toEqual([
      'У части ПД не найдено ПЧУ в оргструктуре: их участки без полосы ПЧУ.',
    ])
  })

  it('пишет названия станций вертикально и раздвигает тесные столбцы без наложения', () => {
    const source = fictionalDistrict()
    const dense: OverviewSource = {
      ...source,
      axes: Array.from({ length: 40 }, (_, i) => ({
        id: `d${i}`,
        lineId: 'L1',
        name: `Учебная-${i + 1}`,
        at: { km: 101 + Math.floor(i / 2), m: (i % 2) * 500 },
      })),
    }
    const page = built(dense).pages[0]!
    const columns = page.primitives
      .flatMap((s) => (s.kind === 'text' && s.rotate === -90 ? [s.x.value] : []))
      .toSorted((a, b) => a - b)
    expect(columns).toHaveLength(40)
    for (let i = 1; i < columns.length; i++)
      expect(columns[i]! - columns[i - 1]!).toBeGreaterThanOrEqual(3 - 1e-9)
    expect(Math.max(...columns)).toBeLessThanOrEqual(405)
    const words = texts(page.primitives)
    for (let i = 1; i <= 40; i++) expect(words).toContain(`Учебная-${i}`)
    const tooDense: OverviewSource = {
      ...dense,
      axes: Array.from({ length: 140 }, (_, i) => ({
        id: `t${i}`,
        lineId: 'L1',
        name: 'Учебная',
        at: { km: 101 + Math.floor(i / 10), m: (i % 10) * 90 },
      })),
    }
    expect(buildDistrictSchemeA(tooDense, tableMeasurer)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('стоят слишком часто') },
    })
  })

  it('переносит направления на следующий лист и отклоняет перекрытие ПД', () => {
    const source = fictionalDistrict()
    const many: OverviewSource = {
      ...source,
      lines: Array.from({ length: 12 }, (_, i) => ({ ...source.lines[1]!, id: `L${i}` })),
      axes: [],
      boundaries: [],
    }
    expect(built(many).pages.length).toBeGreaterThan(1)
    const overlapped: OverviewSource = {
      ...source,
      boundaries: [
        ...source.boundaries,
        { lineId: 'L1', code: 'ПД-9', from: { km: 130, m: 0 }, to: { km: 140, m: 0 } },
      ],
    }
    expect(buildDistrictSchemeA(overlapped, tableMeasurer)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('границы ПД перекрываются') },
    })
  })

  it('фиксирует геометрию листа', () => {
    expect(built().pages[0]).toMatchSnapshot()
  })
})
