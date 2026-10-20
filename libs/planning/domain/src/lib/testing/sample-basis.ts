import { chainage, KmLengths, type Chainage, type TrackSpan } from '@eow/shared/kernel'
import { planBasis, type PlanBasis } from '../plan-basis'

function lengthsOrThrow(entries: [number, number][]): KmLengths {
  const r = KmLengths.of(entries)
  if (!r.ok) throw new Error(`неверная таблица длин: ${r.error.kind}`)
  return r.value
}

function point(km: number, m: number, lengths: KmLengths): Chainage {
  const r = chainage(km, m, lengths)
  if (!r.ok) throw new Error(`неверная точка ${km}+${m}`)
  return r.value
}

/**
 * Вымышленный срез редакции для тестов и примеров (ADR-0008).
 * Направление «L1» — два участка протяжения, между ними чужая дистанция (25–30 км);
 * 20 км короче обычного (964 м). ПД-1 — 10–18 км, ПД-2 — 18–25 и 30–45 км,
 * 45–60 км не входит ни в один действующий ПД. Станция «S1» (ПД-2) с путями 1–3
 * и стрелками 1, 3, 5.
 */
export function samplePlanBasis(): PlanBasis {
  const lengths = lengthsOrThrow([[20, 964]])
  const span = (from: [number, number], to: [number, number]): TrackSpan => ({
    line: 'L1',
    from: point(from[0], from[1], lengths),
    to: point(to[0], to[1], lengths),
  })
  const r = planBasis({
    edition: { number: '7', date: '2026-01-15' },
    lines: [
      {
        id: 'L1',
        name: 'Северная — Южная, 1',
        extent: [span([10, 0], [25, 0]), span([30, 0], [60, 500])],
        kmLengths: lengths,
      },
    ],
    stations: [
      { id: 'S1', name: 'Озёрная', tracks: ['1', '2', '3'], switches: ['1', '3', '5'], pd: 'ПД-2' },
    ],
    pds: [
      { id: 'ПД-1', name: 'ПД-1', pchu: 'ПЧУ-1', segments: [span([10, 0], [18, 0])] },
      {
        id: 'ПД-2',
        name: 'ПД-2',
        pchu: 'ПЧУ-1',
        segments: [span([18, 0], [25, 0]), span([30, 0], [45, 0])],
      },
    ],
    workKinds: [
      {
        code: 'ППР',
        name: 'Планово-предупредительная выправка',
        unit: 'км',
        group: 'current',
        inPlanTable: true,
      },
      {
        code: 'ППРК',
        name: 'ППРК (входит в ППР)',
        unit: 'км',
        group: 'current',
        inPlanTable: false,
        includedIn: 'ППР',
      },
      {
        code: 'КСП',
        name: 'Капитальный ремонт стрелочных переводов',
        unit: 'компл',
        group: 'capital',
        inPlanTable: true,
      },
    ],
  })
  if (!r.ok) throw new Error(`неверный срез: ${r.error.kind}`)
  return r.value
}
