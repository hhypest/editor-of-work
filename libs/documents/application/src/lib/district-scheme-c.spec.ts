import { buildDistrictSchemeC } from './district-scheme-c'
import { DISTRICT_RED } from './district-common'
import type { OverviewSource, SheetPrimitive } from './sheet-model'
import { fictionalDistrict } from './testing/fictional-district'
import { tableMeasurer } from './testing/table-measurer'

const texts = (shapes: readonly SheetPrimitive[]) =>
  shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []))
function built(source: OverviewSource = fictionalDistrict()) {
  const result = buildDistrictSchemeC(source, tableMeasurer)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
const vertical = (shapes: readonly SheetPrimitive[]) =>
  shapes
    .flatMap((s) => (s.kind === 'text' && s.rotate === -90 ? [s] : []))
    .toSorted((a, b) => a.x.value - b.x.value)

describe('Схема дистанции, вариант C — схема-таблица', () => {
  it('столбцы — станции направлений в порядке осей, станция примыкания повторяется со «*»', () => {
    const source = fictionalDistrict()
    const page = built().pages[0]!
    const names = vertical(page.primitives)
      .filter((s) => !/^\d+\+\d{3}$/u.test(s.text))
      .map((s) => s.text)
    const expected = source.axes.filter((a) => a.id.startsWith('a')).map((a) => a.name)
    // На ветви станция примыкания стоит первой: её ось на км 0+300.
    expect(names).toEqual([...expected.slice(0, 21), source.axes[0]!.name, ...expected.slice(21)])
    expect(texts(page.primitives).filter((t) => t === '*')).toHaveLength(3)
    expect(names).not.toContain('Учебный разъезд')
    expect(texts(page.primitives)).toEqual(
      expect.arrayContaining(['Северная — Южная, главный путь 1', 'Подъездная ветвь']),
    )
  })

  it('участки ПД: руководитель, длина по нестандартным км, границы красным', () => {
    const shapes = built().pages[0]!.primitives
    const words = texts(shapes)
    expect(words).toEqual(expect.arrayContaining(['ПД-1', 'Учебный А.А.']))
    // 100–135 км с км 120 длиной 964 м.
    expect(words).toContain('34,964')
    // ПД-5 после разрыва протяжения: 55–82,5 км.
    expect(words).toContain('27,500')
    const red = shapes.flatMap((s) =>
      s.kind === 'text' && s.color === DISTRICT_RED ? [s.text] : [],
    )
    expect(red).toEqual(expect.arrayContaining(['100+000 — 135+000', '55+000 — 82+500']))
  })

  it('ПЧУ: подряд идущие ПД одного ПЧУ — одна ячейка в пределах направления', () => {
    const shapes = built().pages[0]!.primitives
    const pchu = shapes.filter(
      (s) => s.kind === 'text' && s.color === '#ffffff' && s.text.startsWith('ПЧУ-'),
    )
    // ПЧУ-1 — одна ячейка на ПД-1 и ПД-2; ПЧУ-2 — ПД-3, затем ПД-4 и ПД-5, затем ПД-7.
    expect(pchu.map((s) => (s.kind === 'text' ? s.text : ''))).toEqual([
      'ПЧУ-1',
      'ПЧУ-2',
      'ПЧУ-2',
      'ПЧУ-2',
    ])
  })

  it('итоги по ПЧУ и примечания: примыкание, разрыв протяжения, станции без ПД', () => {
    const document = built()
    const words = texts(document.pages[0]!.primitives)
    expect(words).toEqual(
      expect.arrayContaining(['ВСЕГО', '2 ПЧУ · 7 ПД', '180,584', 'Без ПЧУ', '70,084']),
    )
    const notes = words.join(' ')
    expect(notes).toContain('станция примыкания направлений')
    expect(notes).toContain('км 40+000 — 55+000 в границы дистанции не входит.')
    expect(notes).toContain('Не входят в привязку к ПД: Учебный разъезд.')
    expect(document.warnings).toEqual([
      'У части ПД не найдено ПЧУ в оргструктуре: их участки без полосы ПЧУ.',
      'Нет руководителя на листе «Руководители» шаблона ручных данных: ПД-6.',
    ])
  })

  it('ПД без станций на направлении получает пустой столбец, станции вне ПД — замечание', () => {
    const source = fictionalDistrict()
    const document = built({
      ...source,
      axes: [
        ...source.axes.filter((a) => a.lineId !== 'L3'),
        { id: 'x', lineId: 'L3', name: 'Вне участков', at: { km: 17, m: 500 } },
      ],
      boundaries: source.boundaries.map((b) =>
        b.code === 'ПД-7' ? { ...b, to: { km: 17, m: 0 } } : b,
      ),
    })
    expect(texts(document.pages[0]!.primitives)).toEqual(
      expect.arrayContaining(['ПД-6', 'Вне участков']),
    )
    expect(document.warnings).toContain(
      'Станции вне участков ПД (в итоги не входят): Вне участков.',
    )
  })

  it('длинный перечень направлений делится на таблицы и листы; перекрытие ПД отклоняется', () => {
    const source = fictionalDistrict()
    const many: OverviewSource = {
      ...source,
      lines: Array.from({ length: 8 }, (_, i) => ({
        ...source.lines[0]!,
        id: `M${i}`,
        name: `Направление ${i + 1}`,
      })),
      axes: Array.from({ length: 8 }, (_, i) =>
        source.axes
          .filter((a) => a.lineId === 'L1')
          .map((a) => ({ ...a, id: `${a.id}-${i}`, lineId: `M${i}`, name: `${a.name}-${i}` })),
      ).flat(),
      boundaries: [],
      unboundStations: [],
    }
    const document = built(many)
    expect(document.pages.length).toBeGreaterThan(1)
    const rightEdges = document.pages.flatMap((page) =>
      page.primitives.flatMap((s) => (s.kind === 'rect' ? [s.x.value + s.width.value] : [])),
    )
    expect(Math.max(...rightEdges)).toBeLessThanOrEqual(405 + 1e-9)
    const overlapped: OverviewSource = {
      ...source,
      boundaries: [
        ...source.boundaries,
        { lineId: 'L1', code: 'ПД-9', from: { km: 130, m: 0 }, to: { km: 140, m: 0 } },
      ],
    }
    expect(buildDistrictSchemeC(overlapped, tableMeasurer)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('границы ПД перекрываются') },
    })
  })

  it('фиксирует геометрию листа', () => {
    expect(built().pages[0]).toMatchSnapshot()
  })

  it('станция примыкания вне ПД на первом направлении учитывается по второму', () => {
    const source = fictionalDistrict()
    const document = built({
      ...source,
      axes: [
        ...source.axes,
        { id: 'o1', lineId: 'L1', name: 'Общая', at: { km: 100, m: 0 } },
        { id: 'o2', lineId: 'L3', name: 'Общая', at: { km: 17, m: 0 } },
      ],
      boundaries: source.boundaries.map((b) =>
        b.code === 'ПД-1' ? { ...b, from: { km: 100, m: 500 } } : b,
      ),
      stationStats: { ...source.stationStats, Общая: { tracks: 1, meters: 1000, switches: 50 } },
    })
    const words = texts(document.pages[0]!.primitives)
    // Без участка ПД на первом направлении «*» не ставится, итоги ПЧУ-2 включают 50 стрелок.
    expect(words.filter((t) => t === '*')).toHaveLength(3)
    expect(words).toContain('140')
    expect(document.warnings).toContain('Станции вне участков ПД (в итоги не входят): Общая.')
  })

  it('границы ПД из нескольких частей не пропадают в узком столбце', () => {
    const source = fictionalDistrict()
    const document = built({
      ...source,
      lines: [{ ...source.lines[2]!, extents: [{ from: { km: 0, m: 0 }, to: { km: 160, m: 0 } }] }],
      axes: [{ id: 'x', lineId: 'L3', name: 'Учебная', at: { km: 105, m: 0 } }],
      boundaries: [
        {
          lineId: 'L3',
          code: 'ПД-1',
          pchu: 'ПЧУ-1',
          from: { km: 100, m: 0 },
          to: { km: 110, m: 0 },
        },
        {
          lineId: 'L3',
          code: 'ПД-1',
          pchu: 'ПЧУ-1',
          from: { km: 120, m: 0 },
          to: { km: 130, m: 0 },
        },
        {
          lineId: 'L3',
          code: 'ПД-1',
          pchu: 'ПЧУ-1',
          from: { km: 140, m: 0 },
          to: { km: 150, m: 0 },
        },
      ],
      unboundStations: [],
    })
    const red = document.pages[0]!.primitives.flatMap((s) =>
      s.kind === 'text' && s.color === DISTRICT_RED ? [s.text] : [],
    )
    expect(red.join(' ')).toContain('150+000')
    expect(red.length).toBeGreaterThan(3)
  })

  it('итоги длиннее листа переносятся на следующие листы', () => {
    const source = fictionalDistrict()
    const lines = Array.from({ length: 40 }, (_, i) => ({
      ...source.lines[2]!,
      id: `P${i}`,
      name: `Ветвь ${i + 1}`,
    }))
    const document = built({
      ...source,
      lines,
      axes: lines.map((l, i) => ({
        id: `s${i}`,
        lineId: l.id,
        name: `Станция ${i + 1}`,
        at: { km: 5, m: 0 },
      })),
      boundaries: lines.map((l, i) => ({
        lineId: l.id,
        code: `ПД-${i + 1}`,
        pchu: `ПЧУ-${i + 1}`,
        from: { km: 0, m: 0 },
        to: { km: 18, m: 0 },
      })),
      unboundStations: [],
    })
    const ys = document.pages.flatMap((p) =>
      p.primitives.flatMap((s) => (s.kind === 'text' ? [s.y.value] : [])),
    )
    expect(Math.max(...ys)).toBeLessThanOrEqual(297)
    expect(document.pages.flatMap((p) => texts(p.primitives))).toContain('ВСЕГО')
  })
})
