import { err, ok, type Result } from './result'

/**
 * Километраж — пара целых «км + м», как в ЕК АСУИ (ADR-0005).
 * 0 ≤ m < длина километра km. Расстояния считаются только через {@link KmLengths}.
 */
export interface Chainage {
  readonly km: number
  readonly m: number
}

/** Длина обычного километра, м. */
export const STANDARD_KM_LENGTH = 1000
/** Длина пикетов 1–9, м. Вся разница нестандартного километра относится на пк 10. */
export const PICKET_LENGTH = 100
export const PICKETS_PER_KM = 10
/** Километр должен быть длиннее девяти полных пикетов, иначе правило «разница на пк 10» неприменимо. */
export const MIN_KM_LENGTH = (PICKETS_PER_KM - 1) * PICKET_LENGTH

export type ChainageError =
  | { readonly kind: 'not-integer'; readonly km: number; readonly m: number }
  | { readonly kind: 'negative'; readonly km: number; readonly m: number }
  | {
      readonly kind: 'meter-out-of-km'
      readonly km: number
      readonly m: number
      readonly length: number
    }
  | { readonly kind: 'picket-out-of-range'; readonly km: number; readonly pk: number }
  | { readonly kind: 'km-too-short-for-pickets'; readonly km: number; readonly length: number }
  | { readonly kind: 'invalid-km-length'; readonly km: number; readonly length: number }
  | { readonly kind: 'duplicate-km'; readonly km: number }

/** Текст ошибки для пользователя. */
export function describeChainageError(e: ChainageError): string {
  switch (e.kind) {
    case 'not-integer':
      return `Километр и метр должны быть целыми числами в допустимом диапазоне: ${e.km} км ${e.m} м`
    case 'negative':
      return `Километр и метр не могут быть отрицательными: ${e.km} км ${e.m} м`
    case 'meter-out-of-km':
      return `${e.m} м вне ${e.km} км: его длина ${e.length} м`
    case 'picket-out-of-range':
      return `Пикет ${e.pk} вне 1–${PICKETS_PER_KM} (${e.km} км)`
    case 'km-too-short-for-pickets':
      return `${e.km} км длиной ${e.length} м короче девяти пикетов по ${PICKET_LENGTH} м`
    case 'invalid-km-length':
      return `Длина ${e.km} км должна быть целым числом метров, а не ${e.length}`
    case 'duplicate-km':
      return `Длина ${e.km} км задана несколько раз — оставьте одну строку`
  }
}

/**
 * Длины километров направления. По умолчанию километр — 1000 м;
 * нестандартные длины вводятся вручную (ADR-0005).
 */
export class KmLengths {
  private constructor(private readonly nonStandard: ReadonlyMap<number, number>) {}

  static standard(): KmLengths {
    return new KmLengths(new Map())
  }

  /**
   * Каждый километр задаётся один раз. Километр не длиннее девяти пикетов (≤ 900 м)
   * не принимается: к нему неприменимо правило «пк 1–9 по 100 м, разница на пк 10».
   */
  static of(
    entries: Iterable<readonly [km: number, length: number]>,
  ): Result<KmLengths, ChainageError> {
    const map = new Map<number, number>()
    const seen = new Set<number>()
    for (const [km, length] of entries) {
      if (!Number.isSafeInteger(km)) return err({ kind: 'not-integer', km, m: 0 })
      if (km < 0) return err({ kind: 'negative', km, m: 0 })
      if (seen.has(km)) return err({ kind: 'duplicate-km', km })
      seen.add(km)
      if (!Number.isSafeInteger(length)) return err({ kind: 'invalid-km-length', km, length })
      if (length <= MIN_KM_LENGTH) return err({ kind: 'km-too-short-for-pickets', km, length })
      if (length !== STANDARD_KM_LENGTH) map.set(km, length)
    }
    return ok(new KmLengths(map))
  }

  lengthOf(km: number): number {
    return this.nonStandard.get(km) ?? STANDARD_KM_LENGTH
  }

  isStandard(km: number): boolean {
    return !this.nonStandard.has(km)
  }

  /** Нестандартные километры по возрастанию. */
  entries(): readonly (readonly [number, number])[] {
    return [...this.nonStandard.entries()].toSorted(([a], [b]) => a - b)
  }
}

export function chainage(
  km: number,
  m: number,
  lengths: KmLengths,
): Result<Chainage, ChainageError> {
  if (!Number.isSafeInteger(km) || !Number.isSafeInteger(m)) {
    return err({ kind: 'not-integer', km, m })
  }
  if (km < 0 || m < 0) return err({ kind: 'negative', km, m })
  const length = lengths.lengthOf(km)
  if (m >= length) return err({ kind: 'meter-out-of-km', km, m, length })
  return ok({ km, m })
}

export function compareChainage(a: Chainage, b: Chainage): number {
  return a.km - b.km || a.m - b.m
}

export function sameChainage(a: Chainage, b: Chainage): boolean {
  return a.km === b.km && a.m === b.m
}

/** Расстояние от a до b в метрах со знаком: положительное, если b дальше a. */
export function distance(a: Chainage, b: Chainage, lengths: KmLengths): number {
  if (compareChainage(a, b) > 0) return -distance(b, a, lengths)
  let total = b.m - a.m
  for (let km = a.km; km < b.km; km++) total += lengths.lengthOf(km)
  return total
}

/** Точка на расстоянии meters от start (вперёд при положительном, назад при отрицательном). */
export function offset(
  start: Chainage,
  meters: number,
  lengths: KmLengths,
): Result<Chainage, ChainageError> {
  if (!Number.isSafeInteger(meters) || !Number.isSafeInteger(start.m + meters)) {
    return err({ kind: 'not-integer', km: start.km, m: meters })
  }
  let km = start.km
  let m = start.m + meters
  while (m >= lengths.lengthOf(km)) {
    m -= lengths.lengthOf(km)
    km++
    if (!Number.isSafeInteger(km)) return err({ kind: 'not-integer', km, m })
  }
  while (m < 0) {
    km--
    if (km < 0) return err({ kind: 'negative', km, m })
    m += lengths.lengthOf(km)
  }
  return ok({ km, m })
}

/** Границы пикета [start; end): пк 1–9 по 100 м, пк 10 — до конца километра любой длины. */
export function picketBounds(
  km: number,
  pk: number,
): Result<{ readonly start: Chainage; readonly end: Chainage }, ChainageError> {
  // Длина километра не нужна: KmLengths гарантирует, что он длиннее девяти пикетов,
  // а конец пк 10 — начало следующего километра.
  if (!Number.isSafeInteger(km)) return err({ kind: 'not-integer', km, m: 0 })
  if (km < 0) return err({ kind: 'negative', km, m: 0 })
  if (!Number.isInteger(pk) || pk < 1 || pk > PICKETS_PER_KM)
    return err({ kind: 'picket-out-of-range', km, pk })
  const start: Chainage = { km, m: (pk - 1) * PICKET_LENGTH }
  const end: Chainage = pk === PICKETS_PER_KM ? { km: km + 1, m: 0 } : { km, m: pk * PICKET_LENGTH }
  return ok({ start, end })
}

/**
 * Пикет, в котором лежит точка (1–10). Таблица длин не нужна: KmLengths не допускает
 * километров короче девяти пикетов, а пк 10 тянется до конца километра.
 */
export function picketOf(c: Chainage): number {
  return Math.min(Math.floor(c.m / PICKET_LENGTH) + 1, PICKETS_PER_KM)
}

/** «222+916» */
export function formatPlus(c: Chainage): string {
  return `${c.km}+${String(c.m).padStart(3, '0')}`
}

/** «222 км 916 м» */
export function formatKmM(c: Chainage): string {
  return `${c.km} км ${c.m} м`
}

/** «227 км пк 4» — пикет, в котором лежит точка. */
export function formatPicket(c: Chainage): string {
  return `${c.km} км пк ${picketOf(c)}`
}
