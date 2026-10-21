import { KmLengths } from '@eow/shared/kernel'
import { checkKmLengths } from './km-length-check'
import type { SegmentBase } from './segment-forms'

function checked(...args: Parameters<typeof checkKmLengths>) {
  const result = checkKmLengths(...args)
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

const at = { file: 'f.xls', sheet: 'Лист1', row: 2 }

function point(t: string): { km: number; m: number } {
  const [km, m] = t.split('+').map(Number)
  return { km: km ?? 0, m: m ?? 0 }
}

/** Отрезок «км+м → км+м» с заявленной длиной. */
function seg(from: string, to: string, stated: number, line = 'L1'): SegmentBase {
  return { line, from: point(from), to: point(to), statedLength: stated, at }
}

describe('Сверка длин отрезков с координатами', () => {
  it('всё сходится — ни кандидатов, ни замечаний', () => {
    expect(checked([seg('10+0', '12+500', 2500), seg('12+500', '15+0', 2500)])).toEqual({
      candidates: [],
      mismatches: [],
    })
  })

  it('отрезок внутри двух соседних км выдаёт длину одного из них', () => {
    // 20+500 → 21+300: 1000 − 500 + 300 = 800, а заявлено 764 → 20 км = 964 м
    const r = checked([seg('20+500', '21+300', 764), seg('18+0', '20+500', 2500)])
    expect(r.candidates).toMatchObject([{ line: 'L1', km: 20, length: 964, evidence: 1 }])
    expect(r.mismatches).toEqual([])
  })

  it('короткий и длинный км рядом: длинный отрезок сходится, короткие их находят', () => {
    // 374 км = 972, 375 км = 1030: на отрезке 370 → 380 отклонения гасят друг друга.
    const segments = [
      seg('370+0', '380+0', 10_002),
      seg('374+335', '375+531', 1168),
      seg('374+500', '376+300', 1802),
      seg('376+300', '380+0', 3700),
      seg('370+0', '374+335', 4335),
    ]
    const r = checked(segments)
    expect(r.candidates.map((c) => [c.km, c.length, c.evidence])).toEqual([
      [374, 972, 3],
      [375, 1030, 2],
    ])
    expect(r.mismatches).toEqual([])
  })

  it('расхождение, которое нельзя отнести к одному км, — замечание с возможными км', () => {
    const r = checked([seg('383+100', '385+100', 1998)])
    expect(r.candidates).toEqual([])
    expect(r.mismatches).toMatchObject([{ stated: 1998, computed: 2000, kms: [383, 384] }])
  })

  it('все км отрезка определены, а длина не сходится — ошибка строки выгрузки', () => {
    const r = checked([
      seg('10+0', '11+0', 1000),
      seg('11+0', '12+0', 1000),
      seg('10+0', '12+0', 2007),
    ])
    expect(r.mismatches).toMatchObject([{ stated: 2007, computed: 2000, kms: [] }])
  })

  it('известные длины км учитываются: кандидатов нет', () => {
    const lengths = KmLengths.of([[20, 964]])
    if (!lengths.ok) throw new Error('некорректная фикстура')
    const known = new Map([['L1', lengths.value]])
    expect(checked([seg('20+500', '21+300', 764)], known)).toEqual({
      candidates: [],
      mismatches: [],
    })
  })

  it('направления сверяются отдельно', () => {
    const r = checked([seg('20+500', '21+300', 764, 'L1'), seg('20+500', '21+300', 800, 'L2')])
    expect(r.candidates.map((c) => c.line)).toEqual(['L1'])
  })
  it('противоречащие отрезки не выбирают длину по порядку файлов', () => {
    const rows = [seg('10+0', '11+0', 964), seg('10+0', '11+0', 970)]
    for (const input of [rows, rows.toReversed()]) {
      const result = checked(input)
      expect(result.candidates).toEqual([])
      expect(result.mismatches).toHaveLength(2)
    }
  })
  it('невозможная длина км остаётся замечанием, а не кандидатом', () => {
    for (const stated of [900, 964.5]) {
      const result = checked([seg('10+0', '11+0', stated)])
      expect(result.candidates).toEqual([])
      expect(result.mismatches).toHaveLength(1)
    }
  })
  it('не предлагает пересмотреть уже введённую длину по одной противоречащей строке', () => {
    const lengths = KmLengths.of([[10, 964]])
    if (!lengths.ok) throw new Error('некорректная фикстура')
    const result = checked([seg('10+0', '11+0', 970)], new Map([['L1', lengths.value]]))
    expect(result.candidates).toEqual([])
    expect(result.mismatches).toMatchObject([{ stated: 970, computed: 964, kms: [] }])
  })
  it('огромный диапазон возвращает Result до обхода километров и выделения массива', () => {
    const result = checkKmLengths([seg('10+0', `${Number.MAX_SAFE_INTEGER}+0`, 964)])
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import', message: expect.stringContaining('технический предел') },
    })
  })
  it('неизвестная длина -1 не участвует в поиске кандидата', () => {
    const result = checked([seg('10+0', '11+0', -1), seg('10+0', '11+0', 964)])
    expect(result.candidates).toMatchObject([{ km: 10, length: 964, evidence: 1 }])
    expect(result.mismatches).toEqual([])
  })
})
