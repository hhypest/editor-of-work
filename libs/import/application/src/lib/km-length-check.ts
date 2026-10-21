import { chainage, distance, KmLengths } from '@eow/shared/kernel'
import type { ExportLocation } from './export-source'
import type { ExportPoint } from './row-reader'
import type { SegmentBase } from './segment-forms'

/** Длины километров, уже известные по направлению (введены вручную или шаблоном). */
export type KnownKmLengths = ReadonlyMap<string, KmLengths>

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
  readonly at?: ExportLocation
}

export interface LengthCheck {
  readonly candidates: readonly KmLengthCandidate[]
  readonly mismatches: readonly LengthMismatch[]
}

/** Отрезок как уравнение: сумма отклонений длин его километров = заявленная − вычисленная. */
interface Equation {
  readonly segment: SegmentBase
  readonly kms: readonly number[]
  readonly computed: number
  readonly residual: number
}

function equationOf(s: SegmentBase, known: KmLengths): Equation {
  // В длину отрезка входят километры от начального до предпоследнего.
  const kms = Array.from({ length: Math.max(0, s.to.km - s.from.km) }, (_, i) => s.from.km + i)
  const computed = distance(s.from, s.to, known)
  return { segment: s, kms, computed, residual: (s.statedLength ?? computed) - computed }
}

/**
 * Отклонения длин километров одного направления. Сначала — то, что следует из
 * уравнений однозначно (один неизвестный километр). Когда таких нет, самый короткий
 * сходящийся отрезок считается состоящим из стандартных километров, и разбор
 * продолжается: так длинный отрезок, где короткий и длинный километр гасят друг
 * друга, не объявляет их стандартными раньше времени.
 */
function solve(
  equations: readonly Equation[],
  lengths: KmLengths,
): {
  readonly deviation: ReadonlyMap<number, number>
} {
  const deviation = new Map(lengths.entries().map(([km]) => [km, 0]))
  const blocked = new Set<number>()
  const unknown = (e: Equation): number[] => e.kms.filter((k) => !deviation.has(k))
  const rest = (e: Equation): number =>
    e.residual - e.kms.reduce((sum, k) => sum + (deviation.get(k) ?? 0), 0)
  const bySize = equations.toSorted((a, b) => a.kms.length - b.kms.length)
  for (;;) {
    // Сначала собираем все предложения, чтобы результат не зависел от порядка файлов.
    const proposals = new Map<number, Set<number>>()
    for (const e of bySize) {
      const open = unknown(e)
      const [only] = open
      if (open.length === 1 && only !== undefined) {
        const choices = proposals.get(only) ?? new Set<number>()
        choices.add(rest(e))
        proposals.set(only, choices)
      }
    }
    let progress = false
    for (const [km, choices] of proposals) {
      const delta = [...choices][0]
      if (choices.size !== 1 || delta === undefined) {
        blocked.add(km)
        continue
      }
      const proposed = KmLengths.of([[km, lengths.lengthOf(km) + delta]])
      if (
        !proposed.ok ||
        equations.some((e) =>
          [e.segment.from, e.segment.to].some(
            (p) => p.km === km && !chainage(p.km, p.m, proposed.value).ok,
          ),
        )
      ) {
        blocked.add(km)
        continue
      }
      if (blocked.has(km)) continue
      deviation.set(km, delta)
      progress = true
    }
    if (progress) continue
    const assumed = bySize.find(
      (e) => unknown(e).length > 0 && !unknown(e).some((k) => blocked.has(k)) && rest(e) === 0,
    )
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
    const lengths = known.get(line) ?? KmLengths.standard()
    const equations = list.map((s) => equationOf(s, lengths))
    const { deviation } = solve(equations, lengths)
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
        ...(e.segment.at ? { at: e.segment.at } : {}),
      })
    }
    for (const [km, d] of deviation) {
      if (d === 0) continue
      const support = equations.filter((e) => e.kms.includes(km) && explained(e))
      candidates.push({
        line,
        km,
        length: lengths.lengthOf(km) + d,
        evidence: support.length,
        at: support.flatMap((e) => (e.segment.at ? [e.segment.at] : [])),
      })
    }
  }
  const order = (a: KmLengthCandidate, b: KmLengthCandidate): number =>
    a.line < b.line ? -1 : a.line > b.line ? 1 : a.km - b.km
  return { candidates: candidates.toSorted(order), mismatches }
}
