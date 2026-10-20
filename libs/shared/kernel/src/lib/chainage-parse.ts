import {
  chainage,
  describeChainageError,
  type Chainage,
  type ChainageError,
  type KmLengths,
} from './chainage'
import { err, ok, type Result } from './result'

export type ChainageParseError =
  | { readonly kind: 'syntax'; readonly text: string }
  | { readonly kind: 'value'; readonly text: string; readonly cause: ChainageError }

/** Ссылка на пикет «227 км пк 4». */
export interface PicketRef {
  readonly km: number
  readonly pk: number
}

const PLUS = /^(\d+)\s*\+\s*(\d+)$/u
const KM_M = /^(\d+)\s*км(?:\s*(\d+)\s*м)?$/u
const KM_PK = /^(\d+)\s*км\s*пк\s*(\d+)$/u

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/gu, ' ')
}

/**
 * Разбор точки: «222+916», «222+5», «222 км 916 м», «222км916м», «222 км» (= 222+000).
 * Метр проверяется по длине километра.
 */
export function parseChainage(
  text: string,
  lengths: KmLengths,
): Result<Chainage, ChainageParseError> {
  const t = normalize(text)
  const match = PLUS.exec(t) ?? KM_M.exec(t)
  if (!match?.[1]) return err({ kind: 'syntax', text })
  const result = chainage(Number(match[1]), Number(match[2] ?? 0), lengths)
  return result.ok ? result : err({ kind: 'value', text, cause: result.error })
}

/** Разбор ссылки на пикет: «227 км пк 4», «227км пк4». Номер пикета проверяется отдельно. */
export function parsePicketRef(text: string): Result<PicketRef, ChainageParseError> {
  const match = KM_PK.exec(normalize(text))
  if (!match?.[1] || !match[2]) return err({ kind: 'syntax', text })
  return ok({ km: Number(match[1]), pk: Number(match[2]) })
}

export function describeParseError(e: ChainageParseError): string {
  switch (e.kind) {
    case 'syntax':
      return `Не удалось разобрать «${e.text}»: ожидается «222+916», «222 км 916 м» или «227 км пк 4»`
    case 'value':
      return describeChainageError(e.cause)
  }
}
