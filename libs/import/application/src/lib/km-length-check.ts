import type { ExportLocation } from './export-source'
import type { ExportPoint } from './row-reader'
import type { SegmentBase } from './segment-forms'

export const STANDARD_KM = 1000

/** Длины километров, уже известные по направлению (введены вручную или шаблоном). */
export type KnownKmLengths = ReadonlyMap<string, ReadonlyMap<number, number>>

/**
 * Кандидат в нестандартный километр: так объясняется длина отрезков из выгрузки.
 * Только показывается — длины километров вводит пользователь (ADR-0005).
 */
export interface KmLengthCandidate {
  readonly line: string
  readonly km: number
  readonly length: number
  /** Сколько отрезков всех форм сходятся с этой длиной. */
  readonly evidence: number
  readonly at: readonly ExportLocation[]
}

/** Отрезок, длину которого не удалось объяснить. */
export interface LengthMismatch {
  readonly line: string
  readonly from: ExportPoint
  readonly to: ExportPoint
  readonly stated: number
  /** Длина по координатам с известными длинами километров. */
  readonly computed: number
  /**
   * Километры, на которые может приходиться разница. Пусто — все километры отрезка
   * уже определены другими отрезками, и расхождение — ошибка в самой строке выгрузки.
   */
  readonly kms: readonly number[]
  readonly at: ExportLocation
}

export interface LengthCheck {
  readonly candidates: readonly KmLengthCandidate[]
  readonly mismatches: readonly LengthMismatch[]
}

const lengthOf = (known: ReadonlyMap<number, number> | undefined, km: number): number =>
  known?.get(km) ?? STANDARD_KM

/** Отрезок как уравнение: сумма отклонений длин его километров = заявленная − вычисленная. */
interface Equation {
  readonly segment: SegmentBase
  readonly kms: readonly number[]
  readonly computed: number
  readonly residual: number
}

function equationOf(s: SegmentBase, known: ReadonlyMap<number, number> | undefined): Equation {
  // В длину отрезка входят километры от начального до предпоследнего.
  const kms = Array.from({ length: Math.max(0, s.to.km - s.from.km) }, (_, i) => s.from.km + i)
  const computed = s.to.m - s.from.m + kms.reduce((sum, km) => sum + lengthOf(known, km), 0)
  return { segment: s, kms, computed, residual: (s.statedLength ?? computed) - computed }
}

/**
 * Отклонения длин километров одного направления. Сначала — то, что следует из
 * уравнений однозначно (один неизвестный километр). Когда таких нет, самый короткий
 * сходящийся отрезок считается состоящим из стандартных километров, и разбор
 * продолжается: так длинный отрезок, где короткий и длинный километр гасят друг
 * друга, не объявляет их стандартными раньше времени.
 */
function solve(equations: readonly Equation[]): {
  readonly deviation: ReadonlyMap<number, number>
} {
  const deviation = new Map<number, number>()
  const unknown = (e: Equation): number[] => e.kms.filter((k) => !deviation.has(k))
  const rest = (e: Equation): number =>
    e.residual - e.kms.reduce((sum, k) => sum + (deviation.get(k) ?? 0), 0)
  const bySize = equations.toSorted((a, b) => a.kms.length - b.kms.length)
  for (;;) {
    let progress = false
    for (const e of bySize) {
      const open = unknown(e)
      const [only] = open
      if (open.length === 1 && only !== undefined) {
        deviation.set(only, rest(e))
        progress = true
      }
    }
    if (progress) continue
    const assumed = bySize.find((e) => unknown(e).length > 0 && rest(e) === 0)
    if (!assumed) break
    for (const k of unknown(assumed)) deviation.set(k, 0)
  }
  return { deviation }
}

/**
 * Сверка заявленной длины отрезков с координатами (раздел 8.3, ADR-0005) по всем
 * формам характеристик сразу: чем больше форм с разной нарезкой отрезков, тем
 * точнее определяются километры нестандартной длины.
 */
export function checkKmLengths(
  segments: readonly SegmentBase[],
  known: KnownKmLengths = new Map(),
): LengthCheck {
  const byLine = new Map<string, SegmentBase[]>()
  for (const s of segments)
    if (s.statedLength !== null) byLine.set(s.line, [...(byLine.get(s.line) ?? []), s])
  const candidates: KmLengthCandidate[] = []
  const mismatches: LengthMismatch[] = []
  for (const [line, list] of byLine) {
    const lengths = known.get(line)
    const equations = list.map((s) => equationOf(s, lengths))
    const { deviation } = solve(equations)
    const explained = (e: Equation): boolean =>
      e.kms.every((k) => deviation.has(k)) &&
      e.kms.reduce((sum, k) => sum + (deviation.get(k) ?? 0), 0) === e.residual
    const rest = (e: Equation): number =>
      e.residual - e.kms.reduce((sum, k) => sum + (deviation.get(k) ?? 0), 0)
    for (const e of equations) {
      if (explained(e)) continue
      const open = e.kms.filter((k) => !deviation.has(k))
      // Остаток ноль при неопределённых километрах — отрезок не противоречит найденному.
      if (open.length > 0 && rest(e) === 0) continue
      mismatches.push({
        line,
        from: e.segment.from,
        to: e.segment.to,
        stated: e.segment.statedLength ?? e.computed,
        computed: e.computed,
        kms: open,
        at: e.segment.at,
      })
    }
    for (const [km, d] of deviation) {
      if (d === 0) continue
      const support = equations.filter((e) => e.kms.includes(km) && explained(e))
      candidates.push({
        line,
        km,
        length: lengthOf(lengths, km) + d,
        evidence: support.length,
        at: support.map((e) => e.segment.at),
      })
    }
  }
  const order = (a: KmLengthCandidate, b: KmLengthCandidate): number =>
    a.line < b.line ? -1 : a.line > b.line ? 1 : a.km - b.km
  return { candidates: candidates.toSorted(order), mismatches }
}
