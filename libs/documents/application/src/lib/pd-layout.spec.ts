import type { PlanSheetData } from '@eow/planning/sheet-api'
import { buildPdSheets } from './pd-layout'
import { packCallouts } from './callout-packing'
import { tableMeasurer } from './testing/table-measurer'
import type { SheetPrimitive } from './sheet-model'
const span = (from: number, to: number) => ({
  line: 'l',
  from: { km: from, m: 0 },
  to: { km: to, m: 0 },
})
const source: PlanSheetData = {
  year: 2027,
  edition: { number: '7', date: '2027-01-01' },
  approval: { title: 'Учебная должность', name: 'Учебный составитель', year: 2026 },
  lines: [
    { id: 'l', name: 'УЧЕБНОЕ', extents: [span(10, 25), span(30, 40)], kmLengths: [[20, 964]] },
  ],
  pds: [
    { id: 'before', name: 'ПД-1', pchu: 'ПЧУ-1', segments: [span(10, 18)], works: [], tables: [] },
    {
      id: 'pd',
      name: 'ПД-2',
      pchu: 'ПЧУ-1',
      segments: [span(18, 21), span(30, 31)],
      works: [
        {
          id: 'w',
          name: 'Учебная выправка',
          place: '20+000 – 21+000',
          lineId: 'l',
          items: [{ kind: 'span', ...span(20, 21) }],
          volume: 0.964,
          unit: 'км',
          note: 'Учебная',
          callout: true,
        },
      ],
      tables: [
        {
          title: 'Учебные показатели',
          columns: [
            { title: 'Показатель', width: 280 },
            { title: 'Значение', width: 110 },
          ],
          rows: [['Длина главных путей, м', '3964']],
        },
      ],
    },
    { id: 'after', name: 'ПД-3', pchu: 'ПЧУ-1', segments: [span(21, 25)], works: [], tables: [] },
  ],
}
const texts = (shapes: readonly SheetPrimitive[]) =>
  shapes.filter((s) => s.kind === 'text').map((s) => s.text)
function built(data = source, scale: 25000 | 50000 | 100000 = 50000) {
  const result = buildPdSheets(data, 'pd', scale, tableMeasurer)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe('Листы ПД', () => {
  it('подписывает соседние ПД на неполных рядах, считает нестандартный км и не соединяет разрывы', () => {
    const document = built(),
      page = document.pages[0]!
    expect(texts(page.primitives)).toContain('От ПД-1 · 18+000')
    expect(texts(page.primitives)).toContain('К ПД-3 · 21+000')
    const lines = page.primitives.filter(
      (s) => s.kind === 'line' && s.x1.value === 35 && s.y1.value === s.y2.value,
    )
    expect(
      lines.some((s) => s.kind === 'line' && Math.abs(s.x2.value - s.x1.value - 59.28) < 1e-6),
    ).toBe(true)
    expect(lines).toHaveLength(2)
    expect(document).toMatchSnapshot()
  })
  it('упаковывает плотные выноски в продолжения без пересечения прямоугольников', () => {
    const inputs = Array.from({ length: 60 }, (_, i) => ({
        id: String(i).padStart(3, '0'),
        anchor: i < 30 ? 35 : 385,
        text: `${i + 1}. Учебная выправка · 0,5 км`,
      })),
      result = packCallouts(inputs, tableMeasurer)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.length).toBeGreaterThan(1)
    expect(result.value.flatMap((b) => b.boxes)).toHaveLength(60)
    const overlaps = result.value.flatMap((band) =>
      band.boxes.flatMap((a, i) =>
        band.boxes
          .slice(i + 1)
          .filter(
            (b) =>
              a.x < b.x + b.width &&
              b.x < a.x + a.width &&
              a.y < b.y + b.height &&
              b.y < a.y + a.height,
          ),
      ),
    )
    expect(overlaps).toEqual([])
    const bad = result.value.flatMap((b) => b.boxes).filter((b) => b.x < 15 || b.x + b.width > 405)
    expect(bad).toEqual([])
  })
  it('размещает ручные показатели ПД с единицей, знаком и многострочным примечанием', () => {
    const data = {
      ...source,
      pds: source.pds.map((p) =>
        p.id !== 'pd'
          ? p
          : {
              ...p,
              tables: [
                ...p.tables,
                {
                  title: 'Ручные показатели ПД',
                  columns: [
                    { title: 'Показатель', width: 160 },
                    { title: 'Ед.', width: 30 },
                    { title: 'Значение', width: 60 },
                    { title: 'Примечание', width: 140 },
                  ],
                  rows: [
                    ['Учебный нулевой', 'шт.', '0', ''],
                    ['Учебный подписанный', '', '-1,25', 'Учебное примечание '.repeat(10)],
                  ],
                },
              ],
            },
      ),
    }
    const document = built(data),
      all = document.pages.flatMap((p) => texts(p.primitives))
    expect(all).toContain('Ручные показатели ПД')
    expect(all).toContain('0')
    expect(all).toContain('-1,25')
    expect(all.filter((t) => t.includes('Учебное примечание')).length).toBeGreaterThan(1)
    expect(document).toMatchSnapshot()
  })
  it('переносит большие таблицы, повторяя заголовки и сохраняя каждую ячейку', () => {
    const rows = Array.from({ length: 100 }, (_, i) => [
      `Учебная строка ${i + 1}`,
      'Длинное учебное значение '.repeat(4),
    ])
    const data = {
      ...source,
      pds: source.pds.map((p) =>
        p.id !== 'pd' ? p : { ...p, tables: [{ ...p.tables[0]!, rows }] },
      ),
    }
    const document = built(data),
      all = document.pages.flatMap((p) => texts(p.primitives))
    expect(document.pages.length).toBeGreaterThan(3)
    expect(all.filter((t) => t === 'Учебные показатели')).toHaveLength(document.pages.length)
    expect(all.filter((t) => t.startsWith('Учебная строка'))).toHaveLength(100)
    const outside = document.pages
      .flatMap((p) => p.primitives)
      .filter(
        (s) =>
          s.kind === 'rect' &&
          (s.y.value + s.height.value > 287 || s.x.value + s.width.value > 410),
      )
    expect(outside).toEqual([])
  })
  it('повторяет ряд для избытка выносок и не теряет работу', () => {
    const works = Array.from({ length: 60 }, (_, i) => ({
      ...source.pds[1]!.works[0]!,
      id: `w${i}`,
      name: `Учебная ${i + 1}`,
    }))
    const data = {
      ...source,
      pds: source.pds.map((p) => (p.id !== 'pd' ? p : { ...p, segments: [span(18, 21)], works })),
    }
    const document = built(data),
      all = document.pages.flatMap((p) => texts(p.primitives))
    expect(document.pages.length).toBeGreaterThan(1)
    expect(all.filter((t) => /выноски \(продолжение\)/u.test(t)).length).toBeGreaterThan(0)
    expect(all.filter((t) => /^\d+\. Учебная /u.test(t))).toHaveLength(60)
  })
  it('не рисует точку на правой границе ПД, если работа имеет другую долю в этом ПД', () => {
    const work = {
      ...source.pds[1]!.works[0]!,
      id: 'points',
      items: [
        { kind: 'point' as const, line: 'l', at: { km: 20, m: 0 } },
        { kind: 'point' as const, line: 'l', at: { km: 21, m: 0 } },
      ],
    }
    const data = {
      ...source,
      pds: source.pds.map((p) => (p.id !== 'pd' ? p : { ...p, works: [work] })),
    }
    const marks = built(data)
      .pages.flatMap((p) => p.primitives)
      .filter(
        (s) => s.kind === 'line' && s.x1.value === s.x2.value && s.y2.value - s.y1.value === 5,
      )
    expect(marks).toHaveLength(1)
  })
  it('отклоняет перекрытия, чужое протяжение и строку выше листа вместо обрезки', () => {
    const overlap = {
      ...source,
      pds: source.pds.map((p) => (p.id === 'after' ? { ...p, segments: [span(20, 25)] } : p)),
    }
    expect(buildPdSheets(overlap, 'pd', 50000, tableMeasurer)).toMatchObject({ ok: false })
    const gap = {
      ...source,
      pds: source.pds.map((p) => (p.id === 'pd' ? { ...p, segments: [span(18, 31)] } : p)),
    }
    expect(buildPdSheets(gap, 'pd', 50000, tableMeasurer)).toMatchObject({ ok: false })
    const tall = {
      ...source,
      pds: source.pds.map((p) =>
        p.id === 'pd'
          ? {
              ...p,
              tables: [{ ...p.tables[0]!, rows: [['Слишком длинная строка '.repeat(1000), '1']] }],
            }
          : p,
      ),
    }
    expect(buildPdSheets(tall, 'pd', 50000, tableMeasurer)).toMatchObject({ ok: false })
  })
})
