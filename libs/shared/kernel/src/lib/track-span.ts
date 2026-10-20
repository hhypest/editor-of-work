import { compareChainage, distance, formatPlus, type Chainage, type KmLengths } from './chainage'
import { err, ok, type Result } from './result'

/**
 * Участок пути [from; to) на одном направлении: начало входит в участок, конец — нет.
 * Так соседние участки «…– 228 км пк 10» и «229 км пк 1 –…» стыкуются без общего метра.
 */
export interface TrackSpan {
  /** Идентификатор направления (главного пути) в редакции паспорта. */
  readonly line: string
  readonly from: Chainage
  readonly to: Chainage
}

/** Точка на направлении. */
export interface TrackPoint {
  readonly line: string
  readonly at: Chainage
}

export interface TrackSpanError {
  readonly kind: 'empty-span'
  readonly from: Chainage
  readonly to: Chainage
}

export function describeTrackSpanError(e: TrackSpanError): string {
  return `Конец участка ${formatPlus(e.to)} должен быть дальше начала ${formatPlus(e.from)}`
}

/** Участок положительной длины. Точки должны быть уже проверены по длинам километров. */
export function trackSpan(
  line: string,
  from: Chainage,
  to: Chainage,
): Result<TrackSpan, TrackSpanError> {
  if (compareChainage(from, to) >= 0) return err({ kind: 'empty-span', from, to })
  return ok({ line, from, to })
}

/** Длина участка в метрах — через длины километров направления. */
export function spanLength(span: TrackSpan, lengths: KmLengths): number {
  return distance(span.from, span.to, lengths)
}

function later(a: Chainage, b: Chainage): Chainage {
  return compareChainage(a, b) >= 0 ? a : b
}

function earlier(a: Chainage, b: Chainage): Chainage {
  return compareChainage(a, b) <= 0 ? a : b
}

/** Общая часть двух участков; undefined, если они на разных направлениях или только стыкуются. */
export function intersectSpans(a: TrackSpan, b: TrackSpan): TrackSpan | undefined {
  if (a.line !== b.line) return undefined
  const from = later(a.from, b.from)
  const to = earlier(a.to, b.to)
  return compareChainage(from, to) < 0 ? { line: a.line, from, to } : undefined
}

export function spansOverlap(a: TrackSpan, b: TrackSpan): boolean {
  return intersectSpans(a, b) !== undefined
}

/** Участок inner целиком лежит в outer. */
export function spanContains(outer: TrackSpan, inner: TrackSpan): boolean {
  return (
    outer.line === inner.line &&
    compareChainage(outer.from, inner.from) <= 0 &&
    compareChainage(inner.to, outer.to) <= 0
  )
}

/** Точка лежит в участке: from ≤ at < to. */
export function spanContainsPoint(span: TrackSpan, point: TrackPoint): boolean {
  return (
    span.line === point.line &&
    compareChainage(span.from, point.at) <= 0 &&
    compareChainage(point.at, span.to) < 0
  )
}
