import type { PlanSheetData } from '@eow/planning/sheet-api'
import { buildPdSheets } from './pd-layout'
import { tableMeasurer } from './testing/table-measurer'
const span = (from: number, to: number) => ({
  line: 'l',
  from: { km: from, m: 0 },
  to: { km: to, m: 0 },
})
const work = (id: string, km: number): PlanSheetData['pds'][number]['works'][number] => ({
  id,
  name: 'Учебная работа',
  place: 'Учебное место',
  lineId: 'l',
  items: [{ kind: 'span', ...span(km, km + 1) }],
  volume: 1,
  unit: 'км',
  note: '',
  callout: false,
})
const source: PlanSheetData = {
  year: 2027,
  edition: { number: '1', date: '2027-01-01' },
  approval: { title: '', name: '', year: 2026 },
  lines: [{ id: 'l', name: 'Учебное', extents: [span(10, 80)], kmLengths: [[20, 964]] }],
  pds: [
    {
      id: 'pd',
      name: 'Учебный ПД',
      pchu: 'Учебный',
      segments: [10, 20, 30, 40, 50, 60].map((km) => span(km, km + 1)),
      works: [10, 20, 30, 40, 50, 60].map((km, i) => work(`w${i}`, km)),
      tables: [],
    },
  ],
}
const pd = source.pds[0]!
function built(data = source) {
  const result = buildPdSheets(data, 'pd', 50000, tableMeasurer)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
describe('Принадлежность работ физическим страницам ПД', () => {
  it('учитывает отметки без выносок, разрывы и нестандартный км; не повторяет работу внутри страницы', () => {
    const across = { ...work('across', 10), items: [{ kind: 'span' as const, ...span(10, 61) }] }
    const document = built({ ...source, pds: [{ ...pd, works: [across, ...pd.works] }] })
    expect(document.pages).toHaveLength(2)
    expect(document.workIdsByPage).toEqual([
      ['across', 'w0', 'w1', 'w2', 'w3', 'w4'],
      ['across', 'w5'],
    ])
    expect(
      document.pages[0]!.primitives.filter((p) => p.kind === 'text').map((p) => p.text),
    ).toContain('Учебное · 20+000 – 21+000')
  })
  it('относит точку на общей границе к следующему ряду и сохраняет работу на обеих страницах при пересечении', () => {
    // Пять рядов по 17 500 м; укороченный км 20 сдвигает границу с 97+500 на 97+536.
    const data = {
      ...source,
      pds: [
        {
          ...pd,
          segments: [span(10, 115)],
          works: [
            {
              ...work('point', 97),
              items: [{ kind: 'point' as const, line: 'l', at: { km: 97, m: 536 } }],
            },
            { ...work('cross', 97), items: [{ kind: 'span' as const, ...span(97, 99) }] },
          ],
        },
      ],
      lines: [{ ...source.lines[0]!, extents: [span(10, 115)] }],
    }
    const document = built(data)
    expect(document.pages).toHaveLength(2)
    expect(document.workIdsByPage).toEqual([['cross'], ['point', 'cross']])
  })
  it('связывает станционные работы со строками ведомости и оставляет сводные страницы пустыми', () => {
    const works = Array.from({ length: 80 }, (_, i) => ({
      ...work(`s${i}`, 10),
      lineId: null,
      items: [],
    }))
    const rows = works.map((w) => [w.id])
    const document = built({
      ...source,
      pds: [
        {
          ...pd,
          segments: [],
          works,
          tables: [
            {
              title: 'Произвольное название ведомости',
              columns: [{ title: 'Работа', width: 390 }],
              rows,
              workIds: works.map((w) => w.id),
            },
            {
              title: 'Учебная сводка',
              columns: [{ title: 'Показатель', width: 390 }],
              rows: Array.from({ length: 50 }, () => ['Итог по всему ПД']),
            },
          ],
        },
      ],
    })
    expect(document.workIdsByPage.flat()).toEqual(works.map((w) => w.id))
    const textIds = document.pages.map((page) =>
      page.primitives
        .filter((p) => p.kind === 'text')
        .map((p) => p.text)
        .filter((text) => /^s\d+$/u.test(text)),
    )
    expect(document.workIdsByPage).toEqual(textIds)
    expect(document.workIdsByPage.at(-1)).toEqual([])
  })
  it('на продолжении выносок учитывает все повторённые отметки ряда', () => {
    const works = Array.from({ length: 60 }, (_, i) => ({ ...work(`w${i}`, 10), callout: true }))
    const document = built({ ...source, pds: [{ ...pd, segments: [span(10, 11)], works }] })
    expect(document.pages.length).toBeGreaterThan(1)
    expect(document.workIdsByPage).toEqual(document.pages.map(() => works.map((w) => w.id)))
  })
  it.each(['count', 'unknown', 'duplicate'] as const)(
    'отклоняет несогласованные ID (%s)',
    (problem) => {
      const data = {
        ...source,
        pds: [
          {
            ...pd,
            works: problem === 'duplicate' ? [pd.works[0]!, pd.works[0]!] : pd.works,
            tables: [
              {
                title: 'Учебная',
                columns: [{ title: 'Работа', width: 390 }],
                rows: [['Учебная']],
                workIds: problem === 'count' ? [] : problem === 'unknown' ? ['нет'] : ['w0'],
              },
            ],
          },
        ],
      }
      expect(buildPdSheets(data, 'pd', 50000, tableMeasurer)).toMatchObject({
        ok: false,
        error: { message: expect.stringContaining('ссылки') },
      })
    },
  )
})
