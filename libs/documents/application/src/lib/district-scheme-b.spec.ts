import { buildDistrictSchemeB, lineEnds, PCHU_COLORS, toward } from './district-scheme-b'
import type { OverviewSource, SheetPrimitive } from './sheet-model'
import { fictionalDistrict } from './testing/fictional-district'
import { tableMeasurer } from './testing/table-measurer'

const texts = (shapes: readonly SheetPrimitive[]) =>
  shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []))
function built(source: OverviewSource = fictionalDistrict()) {
  const result = buildDistrictSchemeB(source, tableMeasurer)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
/** Два направления сходятся в узле «Узловая» за пределами дистанции. */
function withNode(): OverviewSource {
  const source = fictionalDistrict()
  return {
    ...source,
    lines: source.lines.map((l) =>
      l.id === 'L1'
        ? { ...l, name: 'Северная — Узловая' }
        : l.id === 'L2'
          ? { ...l, name: 'Озёрная — Узловая' }
          : l,
    ),
  }
}

describe('Схема дистанции, вариант B — топологическая', () => {
  it('концы направления берутся из названия, подпись — в винительном падеже', () => {
    expect(lineEnds('Узловая — Ряжск, главный путь 1')).toEqual(['Узловая', 'Ряжск'])
    expect(lineEnds('ВОЛОВО - ДУХОВСКАЯ')).toEqual(['ВОЛОВО', 'ДУХОВСКАЯ'])
    expect(lineEnds('Подъездная ветвь')).toBeUndefined()
    expect(toward('Вязьма')).toBe('на Вязьму')
    expect(toward('Духовская')).toBe('на Духовскую')
    expect(toward('Волово')).toBe('на Волово')
    expect(toward('Ряжск')).toBe('на Ряжск')
    expect(toward('Хвоя')).toBe('на Хвою')
  })

  it('станции — кружки по порядку осей, примыкание один раз чёрным, подписи наискось', () => {
    const source = fictionalDistrict()
    const page = built().pages[0]!
    const circles = page.primitives.filter((s) => s.kind === 'circle')
    // 24 станции и одна станция примыкания, нарисованная один раз; разъезд без ПД не рисуется.
    expect(
      circles.filter((c) => c.kind === 'circle' && c.radius.value < 2 && c.y.value < 270),
    ).toHaveLength(23)
    expect(
      circles.filter((c) => c.kind === 'circle' && c.stroke === '#111111' && c.y.value < 270),
    ).toHaveLength(1)
    const labels = page.primitives.filter((s) => s.kind === 'text' && s.rotate === -45)
    expect(labels).toHaveLength(24)
    expect(texts(labels)).toContain(source.axes[0]!.name)
    expect(texts(page.primitives)).not.toContain('Учебный разъезд')
    expect(texts(page.primitives)).toEqual(expect.arrayContaining(['на Северную', 'на Южную']))
  })

  it('цвет линии — ПЧУ; ПД без ПЧУ серый; подписи ПД с руководителями и засечки с координатами', () => {
    const page = built().pages[0]!
    const colors = new Set(
      page.primitives.flatMap((s) =>
        s.kind === 'line' && s.weight?.value === 1.4 ? [s.color] : [],
      ),
    )
    expect(colors).toEqual(new Set([PCHU_COLORS[0], PCHU_COLORS[1], '#9a9a9a']))
    expect(texts(page.primitives)).toEqual(
      expect.arrayContaining(['ПД-1 · Учебный А.А.', '100+000', '135+000', '40+000', '55+000']),
    )
  })

  it('общий конец двух направлений вне дистанции — узел вместо подписей «на …»', () => {
    const words = texts(built(withNode()).pages[0]!.primitives)
    expect(words).toEqual(expect.arrayContaining(['УЗЛОВАЯ', 'вне границ дистанции']))
    expect(words).not.toContain('на Узловую')
    expect(words).toEqual(expect.arrayContaining(['на Северную', 'на Озёрную']))
    expect(texts(built().pages[0]!.primitives)).not.toContain('вне границ дистанции')
  })

  it('итоги по ПЧУ и по дистанции, примечание о станциях без ПД', () => {
    const document = built()
    const words = texts(document.pages[0]!.primitives)
    expect(words).toEqual(
      expect.arrayContaining(['ПЧУ-1 · Тестовый Ж.Ж. — 70,084 км', 'Без ПЧУ — 1,000 км']),
    )
    expect(words.find((t) => t.startsWith('Всего:'))).toContain('главный путь 180,584 км')
    expect(words.find((t) => t.startsWith('Схема внемасштабная'))).toContain(
      'Не входят в привязку к ПД: Учебный разъезд.',
    )
    expect(document.warnings).toEqual([
      'У части ПД не найдено ПЧУ в оргструктуре: их участки показаны серым.',
      'Нет руководителя на листе «Руководители» шаблона ручных данных: ПД-6.',
    ])
  })

  it('много направлений — несколько листов, линии в пределах поля', () => {
    const source = fictionalDistrict()
    const many: OverviewSource = {
      ...source,
      lines: Array.from({ length: 9 }, (_, i) => ({
        ...source.lines[0]!,
        id: `M${i}`,
        name: `Учебная-${i} — Опытная-${i}`,
      })),
      axes: Array.from({ length: 9 }, (_, i) => ({
        id: `s${i}`,
        lineId: `M${i}`,
        name: `Станция-${i}`,
        at: { km: 150, m: 0 },
      })),
      boundaries: [],
    }
    const document = built(many)
    expect(document.pages.length).toBeGreaterThan(1)
    const xs = document.pages.flatMap((p) =>
      p.primitives.flatMap((s) => (s.kind === 'line' ? [s.x1.value, s.x2.value] : [])),
    )
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(15 - 1e-9)
    expect(Math.max(...xs)).toBeLessThanOrEqual(405 + 1e-9)
  })

  it('фиксирует геометрию листа', () => {
    expect(built(withNode()).pages[0]).toMatchSnapshot()
  })

  it('итоги длиннее места под схемой переносятся на следующий лист', () => {
    const source = fictionalDistrict()
    const boundaries = Array.from({ length: 30 }, (_, i) => ({
      lineId: 'L1',
      code: `ПД-${i + 1}`,
      pchu: 'ПЧУ-1',
      from: { km: 100 + i * 3, m: 0 },
      to: { km: 103 + i * 3, m: 0 },
    }))
    const document = built({ ...source, boundaries, heads: undefined })
    expect(document.pages.length).toBeGreaterThan(1)
    const ys = document.pages.flatMap((p) =>
      p.primitives.flatMap((s) => (s.kind === 'text' ? [s.y.value] : [])),
    )
    expect(Math.max(...ys)).toBeLessThanOrEqual(297)
    const all = document.pages.flatMap((p) => texts(p.primitives))
    expect(all.filter((t) => t.startsWith('ПД-30 — гл. путь'))).toHaveLength(1)
  })

  it('станция примыкания рисуется на каждом листе, где есть её направление', () => {
    const source = fictionalDistrict()
    const lines = Array.from({ length: 5 }, (_, i) => ({
      ...source.lines[2]!,
      id: `J${i}`,
      name: `Ветвь ${i + 1}`,
    }))
    const document = built({
      ...source,
      lines,
      axes: lines.map((l, i) => ({ id: `j${i}`, lineId: l.id, name: 'Узел', at: { km: 9, m: 0 } })),
      boundaries: [],
      unboundStations: [],
    })
    expect(document.pages.length).toBeGreaterThan(1)
    for (const page of document.pages)
      expect(texts(page.primitives).filter((t) => t === 'Узел')).toHaveLength(1)
  })

  it('станции вне участков ПД — замечание: в итоги они не входят', () => {
    const source = fictionalDistrict()
    const document = built({
      ...source,
      axes: [...source.axes, { id: 'x', lineId: 'L2', name: 'Вне ПД', at: { km: 82, m: 500 } }],
      boundaries: source.boundaries.map((b) =>
        b.code === 'ПД-5' ? { ...b, to: { km: 80, m: 0 } } : b,
      ),
    })
    expect(document.warnings).toContain('Станции вне участков ПД (в итоги не входят): Вне ПД.')
  })
})
