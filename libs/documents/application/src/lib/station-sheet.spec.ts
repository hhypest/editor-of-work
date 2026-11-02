import type { PlanSheetData, PlanSheetStation } from '@eow/planning/sheet-api'
import type { StationLayout } from '@eow/shared/kernel'
import { buildPdSheets } from './pd-layout'
import { tableMeasurer } from './testing/table-measurer'
import type { SheetPrimitive } from './sheet-model'

/** Вымышленная станция: главный 1, путь 3 между стрелками 1 и 3, тупик 2 от стрелки 5. */
const layout: StationLayout = {
  version: 1,
  nodes: [
    { id: 'a', col: 0, row: 1, kind: 'end', end: 'open' },
    { id: 's1', col: 4, row: 1, kind: 'switch' },
    { id: 's5', col: 8, row: 1, kind: 'switch' },
    { id: 's3', col: 36, row: 1, kind: 'switch' },
    { id: 'b', col: 44, row: 1, kind: 'end', end: 'open' },
    { id: 'c', col: 6, row: 0, kind: 'bend' },
    { id: 'd', col: 34, row: 0, kind: 'bend' },
    { id: 'e', col: 10, row: 2, kind: 'bend' },
    { id: 'f', col: 30, row: 2, kind: 'end', end: 'stop' },
  ],
  tracks: [
    {
      id: 't1',
      number: '1',
      kind: 'main',
      state: 'normal',
      nodes: ['a', 's1', 's5', 's3', 'b'],
      fullLength: null,
      capacity: null,
    },
    {
      id: 't3',
      number: '3',
      kind: 'station',
      state: 'normal',
      nodes: ['s1', 'c', 'd', 's3'],
      fullLength: 850,
      capacity: '70',
    },
    {
      id: 't2',
      number: '2',
      kind: 'station',
      state: 'closed',
      nodes: ['s5', 'e', 'f'],
      fullLength: 400,
      capacity: null,
    },
  ],
  switches: [
    { id: 'w1', number: '1', node: 's1', track: 't1', branch: 't3' },
    { id: 'w5', number: '5', node: 's5', track: 't1', branch: 't2' },
    { id: 'w3', number: '3', node: 's3', track: 't1', branch: 't3' },
  ],
  derailers: [{ id: 'r1', number: '2со', track: 't2', col: 26 }],
  bridges: [{ id: 'g1', label: null, track: 't1', fromCol: 40, toCol: 42 }],
  crossings: [{ id: 'x1', label: 'переезд 20км', km: 20, pk: 3, col: 2, fromRow: 0, toRow: 2 }],
}
const work = (
  id: string,
  object: PlanSheetStation['works'][number]['object'],
  callout = true,
): PlanSheetStation['works'][number] => ({
  id,
  name: 'Учебный ремонт',
  object,
  volume: 1.5,
  unit: 'компл',
  note: '',
  callout,
})
const station: PlanSheetStation = {
  id: 'S1',
  name: 'Озёрная',
  layout,
  works: [
    work('a', { kind: 'track', number: '3' }),
    work('b', { kind: 'switch', number: '5' }),
    work('c', null),
    work('d', { kind: 'track', number: '2' }, false),
  ],
  tables: [
    {
      title: 'Ведомость работ станции',
      columns: [
        { title: '№', width: 12 },
        { title: 'Работа', width: 378 },
      ],
      rows: [
        ['1', 'Учебный ремонт'],
        ['2', 'Учебный ремонт'],
        ['3', 'Учебный ремонт'],
        ['4', 'Учебный ремонт'],
      ],
      workIds: ['a', 'b', 'c', 'd'],
    },
  ],
}
const source = (stations: readonly PlanSheetStation[]): PlanSheetData => ({
  year: 2027,
  edition: { number: '7', date: '2027-01-01' },
  approval: { title: 'Учебная должность', name: 'Учебный составитель', year: 2026 },
  lines: [
    {
      id: 'l',
      name: 'УЧЕБНОЕ',
      extents: [{ from: { km: 10, m: 0 }, to: { km: 20, m: 0 } }],
      kmLengths: [],
    },
  ],
  pds: [
    {
      id: 'pd',
      name: 'ПД-2',
      pchu: 'ПЧУ-1',
      segments: [{ line: 'l', from: { km: 10, m: 0 }, to: { km: 12, m: 0 } }],
      works: [
        {
          id: 'a',
          name: 'Учебный ремонт',
          place: 'Озёрная · путь № 3',
          lineId: null,
          items: [],
          volume: 1.5,
          unit: 'компл',
          note: '',
          callout: true,
        },
      ],
      tables: [
        {
          title: 'Ведомость работ ПД',
          columns: [{ title: 'Работа', width: 390 }],
          rows: [['Учебный ремонт']],
          workIds: ['a'],
        },
      ],
      stations,
    },
  ],
})
const texts = (shapes: readonly SheetPrimitive[]) =>
  shapes.flatMap((s) => (s.kind === 'text' ? [s.text] : []))
function built(stations: readonly PlanSheetStation[]) {
  const result = buildPdSheets(source(stations), 'pd', 50000, tableMeasurer)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe('Листы станций', () => {
  it('выводит лист станции после листов ПД со схемой, подсветкой, выносками и ведомостью', () => {
    const document = built([station])
    expect(document.pages).toHaveLength(2)
    const page = document.pages[1]!
    expect(page.number).toBe(2)
    const words = texts(page.primitives)
    expect(words).toContain('ППР 2027 · станция Озёрная · ПД-2 · ПЧУ-1')
    expect(words).toContain('Схема станции Озёрная')
    expect(words.some((t) => t.includes('схема станции без масштаба · Лист 2'))).toBe(true)
    for (const label of ['1', '2', '3', '5', '2со', 'переезд 20км']) expect(words).toContain(label)
    expect(words.filter((t) => /^\d\. Учебный/u.test(t)).toSorted()).toEqual([
      '1. Учебный ремонт · 1,5 компл · путь № 3',
      '2. Учебный ремонт · 1,5 компл · стрелка № 5',
      '3. Учебный ремонт · 1,5 компл · вся станция',
    ])
    // Путь 3 — три отрезка подсветки, путь 2 — два; стрелка 5 — серый круг.
    const shaded = page.primitives.filter((s) => s.kind === 'line' && s.shade)
    expect(shaded).toHaveLength(5)
    expect(page.primitives.filter((s) => s.kind === 'circle' && s.shade)).toHaveLength(1)
    // Закрытый путь 2 — пунктир; главный путь толще станционных.
    const tracks = page.primitives.filter((s) => s.kind === 'line' && s.weight && !s.shade)
    expect(tracks.filter((s) => s.kind === 'line' && s.dashed)).toHaveLength(2)
    expect(Math.max(...tracks.map((s) => (s.kind === 'line' ? (s.weight?.value ?? 0) : 0)))).toBe(
      0.6,
    )
    expect(document.workIdsByPage[1]?.toSorted()).toEqual(['a', 'b', 'c', 'd'])
    const xs = page.primitives.flatMap((s) => (s.kind === 'line' ? [s.x1.value, s.x2.value] : []))
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10)
    expect(Math.max(...xs)).toBeLessThanOrEqual(410)
    expect(document.warnings).toEqual([])
    expect(page).toMatchSnapshot()
  })

  it('без листа станции станционная работа остаётся замечанием ведомости ПД', () => {
    expect(built([]).warnings).toEqual([
      'Станционные работы показаны в ведомости: в срезе плана нет координат их осей.',
    ])
  })

  it('называет объект, которого нет на схеме, и станцию без схемы', () => {
    const document = built([
      { ...station, works: [work('a', { kind: 'switch', number: '99' })] },
      { ...station, id: 'S2', name: 'Учебная', layout: null },
    ])
    expect(document.pages).toHaveLength(3)
    expect(document.stations).toEqual([
      { id: 'S1', page: 1 },
      { id: 'S2', page: 2 },
    ])
    expect(document.warnings).toEqual([
      'Станция «Озёрная»: на схеме нет объекта с работой — стрелка № 99.',
      'Станция «Учебная»: схемы нет в срезе плана, работы — в ведомости.',
    ])
    expect(texts(document.pages[2]!.primitives)).toContain(
      'Схема станции не загружена в редакцию паспорта, по которой составлен план. Работы — в ведомости.',
    )
  })

  it('повторяет схему для избытка выносок и переносит таблицы на следующий лист', () => {
    const many = Array.from({ length: 90 }, (_, i) => work(`m${i}`, { kind: 'track', number: '3' }))
    const document = built([
      {
        ...station,
        works: many,
        tables: [
          {
            ...station.tables[0]!,
            rows: many.map((_, i) => [String(i + 1), 'Учебный ремонт']),
            workIds: many.map((w) => w.id),
          },
        ],
      },
    ])
    const stationTexts = document.pages.slice(1).flatMap((p) => texts(p.primitives))
    expect(stationTexts).toContain('Схема станции Озёрная · выноски (продолжение)')
    for (let i = 1; i <= 90; i++)
      expect(stationTexts.some((t) => t.startsWith(`${i}. Учебный ремонт`))).toBe(true)
    expect(document.pages.length).toBeGreaterThan(2)
    expect(new Set(document.workIdsByPage.slice(1).flat())).toEqual(new Set(many.map((w) => w.id)))
  })

  it('отклоняет раскладку с неизвестным узлом вместо пропуска пути', () => {
    const broken = {
      ...station,
      layout: { ...layout, tracks: [{ ...layout.tracks[0]!, nodes: ['a', 'нет'] }] },
    }
    expect(buildPdSheets(source([broken]), 'pd', 50000, tableMeasurer)).toMatchObject({
      ok: false,
      error: { message: 'Станция «Озёрная»: раскладка схемы ссылается на неизвестные узлы.' },
    })
  })

  it('сверяет номер стрелки и пути по правилам импорта схемы', () => {
    const document = built([
      {
        ...station,
        works: [
          work('a', { kind: 'switch', number: '5р' }),
          work('b', { kind: 'track', number: ' 3 ' }),
        ],
      },
    ])
    expect(document.warnings).toEqual([])
    const page = document.pages[1]!
    expect(page.primitives.filter((s) => s.kind === 'circle' && s.shade)).toHaveLength(1)
    expect(page.primitives.filter((s) => s.kind === 'line' && s.shade)).toHaveLength(3)
  })

  it('делит выноски высокой схемы по месту на листе и не выходит за рабочую область', () => {
    const tall: StationLayout = {
      ...layout,
      nodes: [...layout.nodes, { id: 'z', col: 44, row: 12, kind: 'end', end: 'stop' }],
      tracks: [
        ...layout.tracks,
        {
          id: 't9',
          number: '9',
          kind: 'station',
          state: 'normal',
          nodes: ['s3', 'z'],
          fullLength: null,
          capacity: null,
        },
      ],
    }
    const long = 'Учебный ремонт с очень длинным названием работы для проверки переноса строк '
    const works = Array.from({ length: 24 }, (_, i) => ({
      ...work(`m${i}`, { kind: 'track', number: i % 2 ? '3' : '9' }),
      name: long.repeat(3),
    }))
    const document = built([{ ...station, layout: tall, works, tables: [] }])
    const stationPages = document.pages.slice(1)
    expect(stationPages.length).toBeGreaterThan(1)
    for (const page of stationPages)
      for (const shape of page.primitives) {
        if (shape.kind !== 'rect' || shape.width.value !== 68) continue
        expect(shape.y.value + shape.height.value).toBeLessThanOrEqual(245)
      }
    const all = stationPages.flatMap((p) => texts(p.primitives))
    for (let i = 1; i <= 24; i++) expect(all.some((t) => t.startsWith(`${i}. Учебный`))).toBe(true)
  })

  it('рисует здания и платформы с подписью внутри или над прямоугольником', () => {
    const document = built([
      {
        ...station,
        works: [],
        layout: {
          ...layout,
          objects: [
            { id: 'o1', kind: 'building', label: 'Пост ЭЦ', col: 12, row: 3, width: 8, height: 1 },
            {
              id: 'o2',
              kind: 'platform',
              label: 'Платформа пассажирская',
              col: 20,
              row: 3,
              width: 1,
              height: 1,
            },
          ],
        },
      },
    ])
    const page = document.pages[1]!
    const rects = page.primitives.filter(
      (s) => s.kind === 'rect' && s.border && s.width.value < 100 && s.height.value < 10,
    )
    expect(rects.filter((s) => s.kind === 'rect' && s.shade)).toHaveLength(1)
    expect(rects.length).toBeGreaterThanOrEqual(2)
    const words = texts(page.primitives)
    expect(words).toContain('Пост ЭЦ')
    expect(words).toContain('Платформа пассажирская')
  })
})
