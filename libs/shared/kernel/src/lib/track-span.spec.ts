import * as fc from 'fast-check'
import {
  chainage,
  compareChainage,
  describeChainageError,
  distance,
  KmLengths,
  offset,
  type Chainage,
} from './chainage'
import {
  describeTrackSpanError,
  intersectSpans,
  mergeSpans,
  spanContains,
  spanContainsPoint,
  spanLength,
  spansOverlap,
  trackSpan,
  type TrackSpan,
} from './track-span'

function lengths(entries: [number, number][] = []): KmLengths {
  const r = KmLengths.of(entries)
  if (!r.ok) throw new Error(describeChainageError(r.error))
  return r.value
}

const oddKm = lengths([
  [41, 964],
  [42, 1045],
])

function at(km: number, m: number, l: KmLengths = oddKm): Chainage {
  const r = chainage(km, m, l)
  if (!r.ok) throw new Error(describeChainageError(r.error))
  return r.value
}

function span(from: Chainage, to: Chainage, line = 'A'): TrackSpan {
  const r = trackSpan(line, from, to)
  if (!r.ok) throw new Error(describeTrackSpanError(r.error))
  return r.value
}

describe('TrackSpan', () => {
  it('требует, чтобы конец был дальше начала', () => {
    expect(trackSpan('A', at(41, 500), at(41, 500)).ok).toBe(false)
    expect(trackSpan('A', at(42, 0), at(41, 900))).toEqual({
      ok: false,
      error: { kind: 'empty-span', from: at(42, 0), to: at(41, 900) },
    })
    expect(describeTrackSpanError({ kind: 'empty-span', from: at(42, 0), to: at(41, 900) })).toBe(
      'Конец участка 41+900 должен быть дальше начала 42+000',
    )
  })

  it('считает длину через нестандартные километры', () => {
    // 40+500 → 43+100: 500 + 964 + 1045 + 100
    expect(spanLength(span(at(40, 500), at(43, 100)), oddKm)).toBe(2609)
  })

  it('пересечение — общая часть, стык не пересекается', () => {
    const a = span(at(40, 0), at(42, 0))
    const b = span(at(41, 500), at(43, 0))
    expect(intersectSpans(a, b)).toEqual({ line: 'A', from: at(41, 500), to: at(42, 0) })
    expect(spansOverlap(a, span(at(42, 0), at(43, 0)))).toBe(false)
    expect(intersectSpans(a, span(at(41, 0), at(41, 100), 'B'))).toBeUndefined()
  })

  it('вложение и точка: начало входит, конец нет', () => {
    const outer = span(at(40, 0), at(42, 0))
    expect(spanContains(outer, span(at(41, 0), at(42, 0)))).toBe(true)
    expect(spanContains(outer, span(at(41, 0), at(42, 1)))).toBe(false)
    expect(spanContains(outer, span(at(41, 0), at(42, 0), 'B'))).toBe(false)
    expect(spanContainsPoint(outer, { line: 'A', at: at(40, 0) })).toBe(true)
    expect(spanContainsPoint(outer, { line: 'A', at: at(42, 0) })).toBe(false)
  })
})

describe('mergeSpans', () => {
  it('сливает перекрывающиеся и стыкующиеся участки одного направления', () => {
    const merged = mergeSpans([
      span(at(15, 0), at(20, 0)),
      span(at(10, 0), at(15, 0)),
      span(at(12, 0), at(13, 0)),
      span(at(22, 0), at(23, 0)),
      span(at(10, 0), at(11, 0), 'B'),
    ])
    expect(merged).toEqual([
      span(at(10, 0), at(20, 0)),
      span(at(22, 0), at(23, 0)),
      span(at(10, 0), at(11, 0), 'B'),
    ])
  })
})

// --- Свойства (fast-check) ---------------------------------------------------

const arbLengths = fc
  .uniqueArray(fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 901, max: 1300 })), {
    selector: ([km]) => km,
    maxLength: 10,
  })
  .map((entries) => lengths(entries))

function arbPoint(l: KmLengths): fc.Arbitrary<Chainage> {
  return fc
    .integer({ min: 0, max: 30 })
    .chain((km) => fc.integer({ min: 0, max: l.lengthOf(km) - 1 }).map((m) => at(km, m, l)))
}

function arbSpan(l: KmLengths): fc.Arbitrary<TrackSpan> {
  return fc
    .tuple(arbPoint(l), arbPoint(l))
    .filter(([a, b]) => compareChainage(a, b) !== 0)
    .map(([a, b]) => (compareChainage(a, b) < 0 ? span(a, b) : span(b, a)))
}

const withSpans = arbLengths.chain((l) => fc.tuple(fc.constant(l), arbSpan(l), arbSpan(l)))

describe('TrackSpan: свойства', () => {
  it('длина аддитивна: разрез участка в любой точке не меняет сумму', () => {
    const withCut = arbLengths.chain((l) =>
      arbSpan(l).chain((s) =>
        fc.integer({ min: 0, max: spanLength(s, l) }).map((d) => [l, s, d] as const),
      ),
    )
    fc.assert(
      fc.property(withCut, ([l, s, d]) => {
        const cut = offset(s.from, d, l)
        expect(cut.ok).toBe(true)
        if (!cut.ok) return
        expect(distance(s.from, cut.value, l) + distance(cut.value, s.to, l)).toBe(spanLength(s, l))
      }),
    )
  })

  it('пересечение перестановочно, лежит в обоих участках и не длиннее меньшего', () => {
    fc.assert(
      fc.property(withSpans, ([l, a, b]) => {
        const ab = intersectSpans(a, b)
        expect(ab).toEqual(intersectSpans(b, a))
        if (!ab) return
        expect(spanContains(a, ab) && spanContains(b, ab)).toBe(true)
        expect(spanLength(ab, l)).toBeLessThanOrEqual(Math.min(spanLength(a, l), spanLength(b, l)))
      }),
    )
  })

  it('длина объединения перекрывающихся участков = сумма длин − пересечение', () => {
    fc.assert(
      fc.property(withSpans, ([l, a, b]) => {
        const ab = intersectSpans(a, b)
        if (!ab) return
        const hull = span(
          compareChainage(a.from, b.from) <= 0 ? a.from : b.from,
          compareChainage(a.to, b.to) >= 0 ? a.to : b.to,
        )
        expect(spanLength(hull, l)).toBe(spanLength(a, l) + spanLength(b, l) - spanLength(ab, l))
      }),
    )
  })

  it('участок вложен в другой тогда и только тогда, когда пересечение равно ему самому', () => {
    fc.assert(
      fc.property(withSpans, ([, a, b]) => {
        const ab = intersectSpans(a, b)
        const same =
          ab !== undefined &&
          compareChainage(ab.from, b.from) === 0 &&
          compareChainage(ab.to, b.to) === 0
        expect(spanContains(a, b)).toBe(same)
      }),
    )
  })
})

describe('mergeSpans: свойства', () => {
  it('точка покрыта объединением тогда и только тогда, когда покрыта хотя бы одним участком', () => {
    const arb = arbLengths.chain((l) =>
      fc.tuple(fc.array(arbSpan(l), { maxLength: 6 }), fc.array(arbPoint(l), { maxLength: 10 })),
    )
    fc.assert(
      fc.property(arb, ([spans, points]) => {
        const merged = mergeSpans(spans)
        for (const p of points) {
          const inAny = spans.some((s) => spanContainsPoint(s, { line: 'A', at: p }))
          const inMerged = merged.some((s) => spanContainsPoint(s, { line: 'A', at: p }))
          expect(inMerged).toBe(inAny)
        }
        merged.slice(1).forEach((s, i) => {
          const prev = merged[i]
          expect(prev && compareChainage(prev.to, s.from) < 0).toBe(true)
        })
      }),
    )
  })
})
