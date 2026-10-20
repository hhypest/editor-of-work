import * as fc from 'fast-check'
import {
  chainage,
  compareChainage,
  describeChainageError,
  distance,
  formatKmM,
  formatPicket,
  formatPlus,
  KmLengths,
  offset,
  picketBounds,
  picketOf,
  type Chainage,
} from './chainage'
import { describeParseError, parseChainage, parsePicketRef } from './chainage-parse'
import type { Result } from './result'

function value<T, E>(r: Result<T, E>): T {
  if (!r.ok) throw new Error(`ожидался успех, получена ошибка ${JSON.stringify(r.error)}`)
  return r.value
}

function failure<T, E>(r: Result<T, E>): E {
  if (r.ok) throw new Error(`ожидалась ошибка, получено ${JSON.stringify(r.value)}`)
  return r.error
}

function lengths(entries: [number, number][] = []): KmLengths {
  const r = KmLengths.of(entries)
  if (!r.ok) throw new Error(describeChainageError(r.error))
  return r.value
}

function at(km: number, m: number, l: KmLengths = KmLengths.standard()): Chainage {
  const r = chainage(km, m, l)
  if (!r.ok) throw new Error(describeChainageError(r.error))
  return r.value
}

// Вымышленное направление с короткими и длинными километрами (ADR-0005, ADR-0008).
const oddKm = lengths([
  [41, 964],
  [42, 1045],
])

describe('Chainage', () => {
  it('принимает метр внутри километра и отклоняет за его длиной', () => {
    expect(chainage(41, 963, oddKm).ok).toBe(true)
    expect(describeChainageError(failure(chainage(41, 964, oddKm)))).toBe(
      '964 м вне 41 км: его длина 964 м',
    )
    expect(chainage(42, 1044, oddKm).ok).toBe(true)
  })

  it('отклоняет дробные и отрицательные значения', () => {
    expect(chainage(1.5, 0, oddKm).ok).toBe(false)
    expect(chainage(1, -1, oddKm).ok).toBe(false)
  })

  it('отклоняет километр за пределами точной целой арифметики', () => {
    expect(failure(parseChainage('9007199254740993 км', oddKm)).kind).toBe('value')
    expect(chainage(Number.MAX_SAFE_INTEGER + 1, 0, oddKm).ok).toBe(false)
    expect(offset(at(1, 0), 2 ** 53, KmLengths.standard()).ok).toBe(false)
  })
})

describe('KmLengths', () => {
  it('отклоняет повтор километра, даже если одна из длин стандартная', () => {
    expect(
      failure(
        KmLengths.of([
          [5, 964],
          [5, 1000],
        ]),
      ),
    ).toEqual({ kind: 'duplicate-km', km: 5 })
    expect(
      failure(
        KmLengths.of([
          [5, 1000],
          [5, 964],
        ]),
      ),
    ).toEqual({ kind: 'duplicate-km', km: 5 })
  })

  it('отклоняет числа за пределами точной целой арифметики', () => {
    expect(KmLengths.of([[2 ** 53, 964]]).ok).toBe(false)
    expect(KmLengths.of([[5, 2 ** 53]]).ok).toBe(false)
  })
})

describe('distance', () => {
  it('учитывает нестандартные километры', () => {
    // 41+335 → 42+531: 964 − 335 + 531 = 1160 (а не 1196 по формуле км·1000 + м)
    expect(distance(at(41, 335, oddKm), at(42, 531, oddKm), oddKm)).toBe(1160)
    // 42+716 → 43+030: 1045 − 716 + 30 = 359
    expect(distance(at(42, 716, oddKm), at(43, 30, oddKm), oddKm)).toBe(359)
  })

  it('со знаком: в обратную сторону отрицательно', () => {
    expect(distance(at(10, 500), at(9, 0), KmLengths.standard())).toBe(-1500)
  })
})

describe('пикеты', () => {
  it('пк 1–9 по 100 м, пк 10 забирает всю разницу', () => {
    const pk9 = picketBounds(41, 9)
    const pk10s = picketBounds(41, 10)
    const pk10l = picketBounds(42, 10)
    expect(distance(value(pk9).start, value(pk9).end, oddKm)).toBe(100)
    expect(distance(value(pk10s).start, value(pk10s).end, oddKm)).toBe(64)
    expect(distance(value(pk10l).start, value(pk10l).end, oddKm)).toBe(145)
  })

  it('пикет точки: 42+1044 лежит в пк 10', () => {
    expect(picketOf(at(42, 1044, oddKm))).toBe(10)
    expect(picketOf(at(227, 350))).toBe(4)
  })

  it('пикет 11 и пикет 0 — ошибка с понятным текстом', () => {
    expect(describeChainageError(failure(picketBounds(227, 11)))).toBe('Пикет 11 вне 1–10 (227 км)')
    expect(picketBounds(227, 0).ok).toBe(false)
  })

  it('километр не длиннее девяти пикетов не принимается в таблицу длин', () => {
    expect(failure(KmLengths.of([[5, 850]])).kind).toBe('km-too-short-for-pickets')
    expect(failure(KmLengths.of([[5, 900]])).kind).toBe('km-too-short-for-pickets')
    expect(KmLengths.of([[5, 901]]).ok).toBe(true)
  })
})

describe('формат и разбор', () => {
  it('печатает три вида записи', () => {
    const c = at(222, 16)
    expect(formatPlus(c)).toBe('222+016')
    expect(formatKmM(c)).toBe('222 км 16 м')
    expect(formatPicket(at(227, 350))).toBe('227 км пк 4')
  })

  it('разбирает записи с пробелами и без', () => {
    const l = KmLengths.standard()
    for (const text of ['222+916', '222 + 916', '222 км 916 м', '222км916м', ' 222  КМ 916 М ']) {
      const r = parseChainage(text, l)
      expect(value(r)).toEqual({ km: 222, m: 916 })
    }
    const whole = parseChainage('222 км', l)
    expect(value(whole)).toEqual({ km: 222, m: 0 })
  })

  it('сообщает о синтаксической ошибке и о метре вне километра', () => {
    expect(describeParseError(failure(parseChainage('222,9', KmLengths.standard())))).toBe(
      'Не удалось разобрать «222,9»: ожидается точка вида «222+916» или «222 км 916 м»',
    )
    expect(
      describeParseError(failure(parseChainage('227 км пк 4', KmLengths.standard()))),
    ).toContain('ожидается точка')
    expect(describeParseError(failure(parsePicketRef('222+916')))).toBe(
      'Не удалось разобрать «222+916»: ожидается пикет вида «227 км пк 4»',
    )
    expect(describeParseError(failure(parseChainage('41+990', oddKm)))).toBe(
      '990 м вне 41 км: его длина 964 м',
    )
  })

  it('разбирает ссылку на пикет', () => {
    const r = parsePicketRef('227 км пк 4')
    expect(value(r)).toEqual({ km: 227, pk: 4 })
    expect(parsePicketRef('227км пк10').ok).toBe(true)
    expect(parsePicketRef('пк 4').ok).toBe(false)
  })
})

// --- Свойства (fast-check) ---------------------------------------------------

/** Направление с несколькими нестандартными километрами в диапазоне 0–60. */
const arbLengths = fc
  .uniqueArray(fc.tuple(fc.integer({ min: 0, max: 60 }), fc.integer({ min: 901, max: 1200 })), {
    selector: ([km]) => km,
    maxLength: 8,
  })
  .map((entries) => lengths(entries))

function arbPoint(l: KmLengths): fc.Arbitrary<Chainage> {
  return fc
    .integer({ min: 0, max: 60 })
    .chain((km) => fc.integer({ min: 0, max: l.lengthOf(km) - 1 }).map((m) => ({ km, m })))
}

const arbCase = arbLengths.chain((l) =>
  fc.tuple(fc.constant(l), arbPoint(l), arbPoint(l), arbPoint(l)),
)

describe('свойства километража', () => {
  it('разбор после печати возвращает ту же точку', () => {
    fc.assert(
      fc.property(arbCase, ([l, a]) => {
        for (const text of [formatPlus(a), formatKmM(a)]) {
          const r = parseChainage(text, l)
          expect(value(r)).toEqual(a)
        }
      }),
    )
  })

  it('расстояние аддитивно и антисимметрично', () => {
    fc.assert(
      fc.property(arbCase, ([l, a, b, c]) => {
        expect(distance(a, b, l) + distance(b, c, l)).toBe(distance(a, c, l))
        expect(distance(a, b, l)).toBe(-distance(b, a, l))
        expect(Math.sign(distance(a, b, l))).toBe(Math.sign(compareChainage(b, a)))
      }),
    )
  })

  it('сдвиг на расстояние до точки приводит в эту точку', () => {
    fc.assert(
      fc.property(arbCase, ([l, a, b]) => {
        const r = offset(a, distance(a, b, l), l)
        expect(value(r)).toEqual(b)
      }),
    )
  })

  it('пикеты покрывают километр без разрывов и перекрытий', () => {
    fc.assert(
      fc.property(arbLengths, fc.integer({ min: 0, max: 60 }), (l, km) => {
        let total = 0
        let prevEnd: Chainage = { km, m: 0 }
        for (let pk = 1; pk <= 10; pk++) {
          const bounds = value(picketBounds(km, pk))
          expect(bounds.start).toEqual(prevEnd)
          total += distance(bounds.start, bounds.end, l)
          prevEnd = bounds.end
        }
        expect(total).toBe(l.lengthOf(km))
      }),
    )
  })

  it('точка лежит в своём пикете', () => {
    fc.assert(
      fc.property(arbCase, ([, a]) => {
        const bounds = value(picketBounds(a.km, picketOf(a)))
        expect(compareChainage(bounds.start, a)).toBeLessThanOrEqual(0)
        expect(compareChainage(a, bounds.end)).toBeLessThan(0)
      }),
    )
  })
})
