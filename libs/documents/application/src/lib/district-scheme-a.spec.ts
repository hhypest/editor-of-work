import {
  buildDistrictSchemeA,
  DISTRICT_RED,
  districtKmPerCm,
  genitiveTitle,
  kmText,
  plural,
} from './district-scheme-a'
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
/** Главный путь: чёрные линии толщиной 0,8 мм в поле схемы. */
const mainLines = (shapes: readonly SheetPrimitive[]) =>
  shapes.filter(
    (s) =>
      s.kind === 'line' &&
      s.weight?.value === 0.8 &&
      s.color === undefined &&
      !s.dashed &&
      s.y1.value === s.y2.value &&
      s.y1.value > 35 &&
      s.y1.value < 276,
  )
const redLines = (shapes: readonly SheetPrimitive[]) =>
  shapes.filter((s) => s.kind === 'line' && s.color === DISTRICT_RED && s.y1.value > 35)

describe('Схема дистанции, вариант A', () => {
  it('масштаб по главному пути: км в сантиметре, самое длинное направление помещается', () => {
    expect(districtKmPerCm([{ meters: 105_084 }])).toBe(3)
    expect(districtKmPerCm([{ meters: 138_000 }, { meters: 10_000 }])).toBe(3.9)
    expect(districtKmPerCm([{ meters: 0 }])).toBe(0.1)
    const document = built()
    expect(document.kmPerCm).toBe(3)
    expect(document.pages).toHaveLength(1)
    // 100–205 км с км 120 длиной 964 м и км 150 длиной 1120 м: 105 084 м при 3 км в сантиметре.
    const main = mainLines(document.pages[0]!.primitives)[0]!
    expect(main.kind === 'line' && main.x2.value - main.x1.value).toBeCloseTo(105_084 / 300, 6)
    const words = texts(document.pages[0]!.primitives)
    expect(words).toContain(' · 105,084 км')
    expect(words.some((t) => t.startsWith('Масштаб по главному пути: 1 см = 3 км.'))).toBe(true)
    expect(words).toContain('Редакция от 01.01.2027 · Лист 1')
  })

  it('оформляет шапку по названию дистанции и место для утверждения', () => {
    const words = texts(built().pages[0]!.primitives)
    expect(words).toEqual(
      expect.arrayContaining([
        'ОАО «РЖД» · УЧЕБНАЯ ДИСТАНЦИЯ ИНФРАСТРУКТУРЫ',
        'Схема Учебной дистанции инфраструктуры',
        'Начальник дистанции __________ / __________ /',
        '«__» __________ 20__ г.',
      ]),
    )
    expect(genitiveTitle('Опытная дистанция пути')).toBe('Схема Опытной дистанции пути')
    expect(genitiveTitle('ПЧ-99')).toBe('Схема дистанции: ПЧ-99')
    expect(genitiveTitle('  ')).toBe('Схема дистанции')
    const source = fictionalDistrict()
    const nameless = built({ ...source, district: undefined })
    expect(texts(nameless.pages[0]!.primitives)).toEqual(
      expect.arrayContaining(['ОАО «РЖД»', 'Схема дистанции']),
    )
    expect(nameless.warnings).toContain(
      'Нет названия дистанции: заполните строку «Дистанция» листа «Руководители».',
    )
  })

  it('рисует разрыв протяжения серым пунктиром постоянной длины и пишет его в заголовке', () => {
    const page = built().pages[0]!
    const lines = mainLines(page.primitives)
    const second = lines.filter((s) => s.kind === 'line' && s.y1.value === lines[1]?.y1.value)
    const [a, b] = second
    expect(a?.kind === 'line' && b?.kind === 'line' && b.x1.value - a.x2.value).toBeCloseTo(12, 6)
    expect(
      page.primitives.some((s) => s.kind === 'line' && s.dashed && s.color === '#9a9a9a'),
    ).toBe(true)
    expect(texts(page.primitives)).toContain(
      ' · 57,500 км · км 40+000 — 55+000 не входит в дистанцию',
    )
  })

  it('подписывает ПД и ПЧУ руководителями, ПЧУ — белым по тёмной полосе', () => {
    const document = built()
    const shapes = document.pages[0]!.primitives
    const words = texts(shapes)
    expect(words.filter((t) => t === 'ПЧУ-1 · Тестовый Ж.Ж.')).toHaveLength(1)
    expect(words.filter((t) => t === 'ПЧУ-2 · Макетный З.З.')).toHaveLength(4)
    expect(words).toContain('ПД-1 · Учебный А.А.')
    expect(
      shapes.find((s) => s.kind === 'text' && s.text === 'ПЧУ-1 · Тестовый Ж.Ж.'),
    ).toMatchObject({ color: '#ffffff', anchor: 'middle' })
    expect(document.warnings).toEqual([
      'У части ПД не найдено ПЧУ в оргструктуре: их участки без полосы ПЧУ.',
      'Нет руководителя на листе «Руководители» шаблона ручных данных: ПД-6.',
    ])
    // Без листа руководителей подписи остаются кодами, а замечания о ФИО нет.
    const bare = built({ ...fictionalDistrict(), heads: undefined })
    expect(texts(bare.pages[0]!.primitives)).toContain('ПЧУ-1')
    expect(bare.warnings.some((w) => w.includes('руководителя'))).toBe(false)
  })

  it('границы ПД — красный пунктир, ПЧУ и края участков — сплошные; координаты красным', () => {
    const shapes = built().pages[0]!.primitives
    const red = redLines(shapes).filter((s) => s.kind === 'line' && s.x1.value === s.x2.value)
    // Северная — Южная: края 100 и 205 км и граница ПЧУ на 170 км сплошные, ПД на 135 км — пунктир.
    const first = red.filter((s) => s.kind === 'line' && s.y1.value < 100)
    expect(first.map((s) => s.kind === 'line' && s.dashed)).toEqual([false, true, false, false])
    const coordinates = shapes.flatMap((s) =>
      s.kind === 'text' && s.color === DISTRICT_RED && s.text.startsWith('км ') ? [s.text] : [],
    )
    expect(coordinates).toEqual(
      expect.arrayContaining(['км 100+000', 'км 135+000', 'км 170+000', 'км 205+000']),
    )
    expect(coordinates).toEqual(expect.arrayContaining(['км 40+000', 'км 55+000', 'км 82+500']))
  })

  it('под станцией координата оси и число путей и стрелок; примыкание учтено один раз', () => {
    const source = fictionalDistrict()
    const document = built()
    const shapes = document.pages[0]!.primitives
    const vertical = shapes.flatMap((s) => (s.kind === 'text' && s.rotate === -90 ? [s.text] : []))
    const first = source.axes[0]!.name
    expect(vertical.filter((t) => t === first)).toHaveLength(2)
    expect(vertical).toEqual(
      expect.arrayContaining(['км 102+300', '2 п. · 4 стр.', 'км 0+300', 'учтена выше']),
    )
    // Разъезд без привязки к ПД не рисуется и назван в примечании.
    expect(vertical).not.toContain('Учебный разъезд')
    const words = texts(shapes)
    expect(words.find((t) => t.startsWith('Масштаб'))).toContain(
      `${first} — станция примыкания направлений Северная — Южная, главный путь 1, Подъездная ветвь.`,
    )
    expect(words.find((t) => t.startsWith('Масштаб'))).toContain(
      'Не входят в привязку к ПД: Учебный разъезд.',
    )
    // 24 станции; станционные пути 1500 + 250·i м, стрелки 4 + i mod 5.
    const meters = Array.from({ length: 24 }, (_, i) => 1500 + i * 250).reduce((a, b) => a + b, 0)
    const switches = Array.from({ length: 24 }, (_, i) => 4 + (i % 5)).reduce((a, b) => a + b, 0)
    expect(words).toContain(
      `Всего: главный путь 180,584 км · станционные пути ${kmText(meters)} км · ${plural(switches, '', 'стрелочных перевода', 'стрелочных переводов')} · 24 станции`,
    )
  })

  it('склоняет итоги и группирует разряды', () => {
    expect(plural(1, 'станция', 'станции', 'станций')).toBe('1 станция')
    expect(plural(12, 'станция', 'станции', 'станций')).toBe('12 станций')
    expect(plural(22, 'станция', 'станции', 'станций')).toBe('22 станции')
    expect(plural(1105, 'станция', 'станции', 'станций')).toBe('1 105 станций')
    expect(kmText(1_234_567)).toBe('1 234,567')
    expect(kmText(0)).toBe('0,000')
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
      unboundStations: [],
    }
    const page = built(dense).pages[0]!
    const names = page.primitives.filter(
      (s) => s.kind === 'text' && s.rotate === -90 && s.text.startsWith('Учебная-'),
    )
    const columns = names.map((s) => (s.kind === 'text' ? s.x.value : 0)).toSorted((a, b) => a - b)
    expect(columns).toHaveLength(40)
    for (let i = 1; i < columns.length; i++)
      expect(columns[i]! - columns[i - 1]!).toBeGreaterThanOrEqual(5.6 - 1e-9)
    expect(Math.max(...columns)).toBeLessThanOrEqual(405)
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

  it('ставит короткие направления в ряд, переносит на следующий лист, отклоняет перекрытие ПД', () => {
    const source = fictionalDistrict()
    const page = built().pages[0]!
    const titleY = (name: string) =>
      page.primitives.find((s) => s.kind === 'text' && s.text === name)?.y.value
    // Озёрная — Ключи и подъездная ветвь — в одном ряду, главный ход — в своём.
    expect(titleY('Подъездная ветвь')).toBe(titleY('Озёрная — Ключи, главный путь 1'))
    expect(titleY('Подъездная ветвь')).toBeGreaterThan(titleY('Северная — Южная, главный путь 1')!)
    const many: OverviewSource = {
      ...source,
      lines: Array.from({ length: 12 }, (_, i) => ({ ...source.lines[0]!, id: `L${i}` })),
      axes: [],
      boundaries: [],
    }
    const pages = built(many).pages
    expect(pages.length).toBeGreaterThan(1)
    expect(texts(pages[1]!.primitives)).toContain('Редакция от 01.01.2027 · Лист 2')
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

  it('отклоняет границу ПД в несуществующем метре нестандартного километра', () => {
    const source = fictionalDistrict()
    const broken: OverviewSource = {
      ...source,
      boundaries: [
        { lineId: 'L3', code: 'ПД-6', from: { km: 0, m: 0 }, to: { km: 1, m: 1200 } },
        { lineId: 'L3', code: 'ПД-7', from: { km: 1, m: 1200 }, to: { km: 18, m: 0 } },
      ],
    }
    expect(buildDistrictSchemeA(broken, tableMeasurer)).toMatchObject({
      ok: false,
      error: { message: 'ПД-6: недопустимая граница ПД.' },
    })
  })

  it('масштаб учитывает разрывы протяжения; направление шире листа отклоняется', () => {
    // 100 км в шести частях: пять разрывов по 12 мм уменьшают место под путь.
    expect(districtKmPerCm([{ meters: 100_000, gaps: 5 }])).toBe(3.4)
    const source = fictionalDistrict()
    const parts = Array.from({ length: 6 }, (_, i) => ({
      from: { km: i * 20, m: 0 },
      to: { km: i * 20 + 16, m: 667 },
    }))
    const document = built({
      ...source,
      lines: [{ ...source.lines[2]!, extents: parts }],
      axes: [],
      boundaries: [],
    })
    const xs = document.pages[0]!.primitives.flatMap((s) =>
      s.kind === 'line' ? [s.x1.value, s.x2.value] : [],
    )
    expect(Math.max(...xs)).toBeLessThanOrEqual(405)
  })

  it('станция вне протяжения не рисуется и не входит в итоги', () => {
    const source = fictionalDistrict()
    const outside: OverviewSource = {
      ...source,
      axes: [...source.axes, { id: 'far', lineId: 'L3', name: 'Дальняя', at: { km: 30, m: 0 } }],
      stationStats: { ...source.stationStats, Дальняя: { tracks: 5, meters: 9000, switches: 9 } },
    }
    const document = built(outside)
    const words = texts(document.pages[0]!.primitives)
    expect(words).not.toContain('Дальняя')
    expect(words.find((t) => t.startsWith('Всего:'))).toContain('24 станции')
    expect(document.warnings).toContain(
      'Ось Дальняя 30+000 вне протяжения направления и не показана.',
    )
  })

  it('длинные примечания переносятся по строкам в пределах листа', () => {
    const source = fictionalDistrict()
    const names = Array.from({ length: 30 }, (_, i) => `Учебная станция ${i + 1}`)
    const document = built({
      ...source,
      unboundStations: [...(source.unboundStations ?? []), ...names],
    })
    const notes = document.pages[0]!.primitives.filter(
      (s) => s.kind === 'text' && s.font.size.value === 2.4 && s.y.value > 270 && !s.color,
    )
    expect(notes.length).toBeGreaterThan(1)
    for (const note of notes)
      expect(
        note.kind === 'text' && note.x.value + tableMeasurer.width(note.text, note.font).value,
      ).toBeLessThanOrEqual(405 + 1e-9)
    expect(notes.map((n) => (n.kind === 'text' ? n.text : '')).join(' ')).toContain(
      'Учебная станция 30.',
    )
  })
})
