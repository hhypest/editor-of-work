import * as fc from 'fast-check'
import {
  chainage,
  compareChainage,
  describeChainageError,
  KmLengths,
  type Chainage,
} from './chainage'
import {
  describePlaceSpecError,
  formatPlaceSpec,
  parsePlaceSpec,
  placeLength,
  type PlaceItem,
  type PlaceSpec,
  type PlaceSpecError,
} from './place-spec'
import type { Result } from './result'

function lengths(entries: [number, number][] = []): KmLengths {
  const r = KmLengths.of(entries)
  if (!r.ok) throw new Error(describeChainageError(r.error))
  return r.value
}

const standard = KmLengths.standard()
const oddKm = lengths([
  [20, 964],
  [30, 1045],
])

function at(km: number, m: number, l: KmLengths = standard): Chainage {
  const r = chainage(km, m, l)
  if (!r.ok) throw new Error(describeChainageError(r.error))
  return r.value
}

function value(r: Result<PlaceSpec, readonly PlaceSpecError[]>): PlaceSpec {
  if (!r.ok) throw new Error(r.error.map(describePlaceSpecError).join('\n'))
  return r.value
}

function errors(r: Result<PlaceSpec, readonly PlaceSpecError[]>): readonly PlaceSpecError[] {
  if (r.ok) throw new Error(`ожидалась ошибка, получено ${formatPlaceSpec(r.value)}`)
  return r.error
}

function spans(text: string, l: KmLengths = standard): [string, string][] {
  return value(parsePlaceSpec(text, 'A', l)).items.map((i) =>
    i.kind === 'span'
      ? [`${i.from.km}+${i.from.m}`, `${i.to.km}+${i.to.m}`]
      : [`${i.at.km}+${i.at.m}`, '·'],
  )
}

function first(text: string, l: KmLengths = standard): PlaceSpecError {
  const e = errors(parsePlaceSpec(text, 'A', l))[0]
  if (!e) throw new Error('нет ошибки')
  return e
}

function print(text: string, l: KmLengths = standard): string {
  return formatPlaceSpec(value(parsePlaceSpec(text, 'A', l)))
}

describe('PlaceSpec: выноски по образцу прототипа', () => {
  // Структура настоящих выносок ППРК прототипа, километры вымышленные (ADR-0008).
  const pprk337 = '12 км пк 1 - 18 км пк 4; 18 км пк 6 - 19 км пк 4; 19 км пк 7 - 45 км пк 10'
  const pprk30 =
    '51 км пк 6 - 56 км пк 3; 56 км пк 5 - 57 км пк 3; 57 км пк 7 - 59 км пк 10; ' +
    '63 км пк 1 - 63 км пк 10; 66 км пк 1 - 69 км пк 10; 71 км пк 1 - 87 км пк 9'

  it('ППРК 33,7 км: 6,4 + 0,9 + 26,4', () => {
    expect(placeLength(value(parsePlaceSpec(pprk337, 'A', standard)), standard)).toBe(33_700)
  })

  it('ППРК 30 км: 4,8 + 0,9 + 2,4 + 1 + 4 + 16,9', () => {
    expect(placeLength(value(parsePlaceSpec(pprk30, 'A', standard)), standard)).toBe(30_000)
  })

  it('нестандартные километры внутри участка меняют сумму на свою разницу', () => {
    // 20 км на 36 м короче, 30 км на 45 м длиннее
    expect(placeLength(value(parsePlaceSpec(pprk337, 'A', oddKm)), oddKm)).toBe(33_709)
  })
})

describe('PlaceSpec: разбор', () => {
  it('пикет занимает [(p − 1)·100; p·100), пк 10 — до конца километра', () => {
    expect(spans('227 км пк 4')).toEqual([['227+300', '227+400']])
    expect(spans('20 км пк 10', oddKm)).toEqual([['20+900', '21+0']])
    expect(placeLength(value(parsePlaceSpec('30 км пк 10', 'A', oddKm)), oddKm)).toBe(145)
  })

  it('километр целиком и диапазон пикетов на одном километре', () => {
    expect(spans('227 км')).toEqual([['227+0', '228+0']])
    expect(spans('227 км пк 4–7')).toEqual([['227+300', '227+700']])
    expect(spans('227 км пк 4 – пк 7')).toEqual([['227+300', '227+700']])
  })

  it('принимает варианты записи пикета, точки и тире', () => {
    const same = [['227+300', '229+0']]
    expect(spans('227 км пк 4 — 228 км пк 10')).toEqual(same)
    expect(spans('227/4-228/10')).toEqual(same)
    expect(spans('227 пк 4 − 228км 10пк')).toEqual(same)
    expect(spans('227 КМ. ПК. 4 – 228 км пк 10')).toEqual(same)
    expect(spans('222+916 – 223 км 50 м')).toEqual([['222+916', '223+50']])
  })

  it('одиночная точная координата — точка, а не участок', () => {
    expect(spans('222+916')).toEqual([['222+916', '·']])
    expect(placeLength(value(parsePlaceSpec('222+916', 'A', standard)), standard)).toBe(0)
  })

  it('километр без пикета в конце участка — начало этого километра', () => {
    expect(spans('44 км – 50 км')).toEqual([['44+0', '50+0']])
  })

  it('части разделяются «;», переводом строки и запятой', () => {
    expect(spans('227 км пк 4; 228 км\n229 км пк 1, 230 км')).toHaveLength(4)
    expect(spans(' ; 227 км ;; ')).toHaveLength(1)
  })

  it('пустая строка — пустое описание', () => {
    expect(value(parsePlaceSpec('  ', 'A', standard)).items).toEqual([])
  })

  it('участки получают направление описания', () => {
    const item = value(parsePlaceSpec('227 км', 'Б', standard)).items[0]
    expect(item?.line).toBe('Б')
  })
})

describe('PlaceSpec: ошибки с позицией', () => {
  it('пикет вне 1–10: позиция и текст фрагмента', () => {
    const text = '227 км пк 4 – 228 км пк 10; 234 км пк 13'
    const e = first(text)
    expect(e.at).toEqual({ start: 28, end: 40 })
    expect(text.slice(e.at.start, e.at.end)).toBe('234 км пк 13')
    expect(describePlaceSpecError(e)).toBe('Позиция 29, «234 км пк 13»: Пикет 13 вне 1–10 (234 км)')
  })

  it('ошибка в конце участка указывает на конец, а не на всю часть', () => {
    const text = '227 км пк 4 – 228 км пк 0'
    expect(first(text).at).toEqual({ start: 14, end: 25 })
  })

  it('голое число после пикета — пикет того же км, даже если вне 1–10', () => {
    const text = '1 км пк 4–13'
    expect(first(text)).toMatchObject({ kind: 'value', text: '13', at: { start: 10, end: 12 } })
    expect(describePlaceSpecError(first(text))).toBe('Позиция 11, «13»: Пикет 13 вне 1–10 (1 км)')
  })

  it('конец пк 10 последнего безопасного километра — ошибка, а не неточная точка', () => {
    expect(first(`${Number.MAX_SAFE_INTEGER} км пк 10`).kind).toBe('value')
  })

  it('ошибки обеих границ участка сообщаются вместе', () => {
    const list = errors(parsePlaceSpec('20+980 – 30+1100', 'A', oddKm))
    expect(list.map((e) => e.text)).toEqual(['20+980', '30+1100'])
  })

  it('конец, записанный от начала, при ошибке в начале не проверяется', () => {
    expect(errors(parsePlaceSpec('у моста – пк 7', 'A', standard)).map((e) => e.text)).toEqual([
      'у моста',
    ])
  })

  it('собирает все ошибки строки по порядку', () => {
    const list = errors(
      parsePlaceSpec('22,5; 227 км пк 4 – 226 км; 1 км – 2 км – 3 км; 227 –', 'A', standard),
    )
    expect(list.map((e) => e.kind)).toEqual(['fraction', 'reversed', 'extra-dash', 'missing-end'])
  })

  it('понятные тексты для частых ошибок', () => {
    expect(describePlaceSpecError(first('22,5 км'))).toContain('дробные километры не принимаются')
    expect(describePlaceSpecError(first('у моста'))).toContain('не понятно, что это за место')
    expect(describePlaceSpecError(first('222+916 – 222+916'))).toContain('начало и конец совпадают')
    expect(describePlaceSpecError(first('20+980', oddKm))).toContain('980 м вне 20 км')
    expect(describePlaceSpecError(first('– 228 км'))).toContain('перед тире нет начала')
  })

  it('перекрытие участков одной работы — ошибка на втором из них', () => {
    const text = '227 км – 229 км; 228 км пк 5'
    const e = first(text)
    expect(e).toMatchObject({ kind: 'overlap', other: '227 км – 229 км', text: '228 км пк 5' })
    expect(e.at.start).toBe(text.indexOf('228 км пк 5'))
  })

  it('стык участков — не перекрытие', () => {
    expect(spans('227 км пк 1 – 227 км пк 5; 227 км пк 6 – 228 км')).toHaveLength(2)
  })
})

describe('PlaceSpec: печать', () => {
  it('печатает пикетами, километрами и точками', () => {
    expect(print('227/4 - 228/10;234 пк3')).toBe('227 км пк 4 – 228 км пк 10; 234 км пк 3')
    expect(print('227 км пк 1 – 227 км пк 10')).toBe('227 км')
    expect(print('227 км пк 4 – 227 км пк 7')).toBe('227 км пк 4–7')
    expect(print('222+916 – 223 км пк 2')).toBe('222+916 – 223 км пк 2')
    expect(print('222+916')).toBe('222+916')
  })

  it('пк 10 нестандартного километра печатается пикетом', () => {
    expect(print('20+900 – 21+000', oddKm)).toBe('20 км пк 10')
    expect(print('20+950 – 21+000', oddKm)).toBe('20+950 – 20 км пк 10')
  })
})

// --- Свойства (fast-check) ---------------------------------------------------

const arbLengths = fc
  .uniqueArray(fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 901, max: 1300 })), {
    selector: ([km]) => km,
    maxLength: 10,
  })
  .map((entries) => lengths(entries))

/** Точка, чаще всего на границе пикета: так проверяется и печать пикетами. */
function arbPoint(l: KmLengths): fc.Arbitrary<Chainage> {
  return fc.integer({ min: 0, max: 30 }).chain((km) =>
    fc
      .oneof(
        fc.integer({ min: 0, max: 9 }).map((p) => p * 100),
        fc.integer({ min: 0, max: l.lengthOf(km) - 1 }),
      )
      .map((m) => at(km, m, l)),
  )
}

function arbItem(l: KmLengths): fc.Arbitrary<PlaceItem> {
  return fc.oneof(
    arbPoint(l).map((p): PlaceItem => ({ kind: 'point', line: 'A', at: p })),
    fc
      .tuple(arbPoint(l), arbPoint(l))
      .filter(([a, b]) => compareChainage(a, b) !== 0)
      .map(([a, b]): PlaceItem => {
        const [from, to] = compareChainage(a, b) < 0 ? [a, b] : [b, a]
        return { kind: 'span', line: 'A', from, to }
      }),
    // Участок до начала следующего километра — конец пк 10.
    arbPoint(l).map((p): PlaceItem => ({
      kind: 'span',
      line: 'A',
      from: p,
      to: { km: p.km + 1, m: 0 },
    })),
  )
}

function disjoint(items: readonly PlaceItem[]): boolean {
  const s = items.filter((i) => i.kind === 'span')
  return s.every((a, i) =>
    s
      .slice(i + 1)
      .every((b) => compareChainage(a.to, b.from) <= 0 || compareChainage(b.to, a.from) <= 0),
  )
}

describe('PlaceSpec: свойства', () => {
  it('печать и разбор возвращают те же участки и точки', () => {
    const arb = arbLengths.chain((l) =>
      fc.tuple(fc.constant(l), fc.array(arbItem(l), { maxLength: 5 }).filter(disjoint)),
    )
    fc.assert(
      fc.property(arb, ([l, items]) => {
        const text = formatPlaceSpec({ line: 'A', items })
        expect(value(parsePlaceSpec(text, 'A', l)).items).toEqual(items)
      }),
    )
  })

  it('пикеты 1–10 километра любой длины в сумме дают его длину', () => {
    fc.assert(
      fc.property(arbLengths, fc.integer({ min: 0, max: 30 }), (l, km) => {
        const text = Array.from({ length: 10 }, (_, i) => `${km} км пк ${i + 1}`).join('; ')
        expect(placeLength(value(parsePlaceSpec(text, 'A', l)), l)).toBe(l.lengthOf(km))
      }),
    )
  })
})
