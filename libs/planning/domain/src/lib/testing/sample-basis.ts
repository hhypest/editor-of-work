import {
  chainage,
  KmLengths,
  type Chainage,
  type StationLayout,
  type TrackSpan,
} from '@eow/shared/kernel'
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
 * Вымышленная раскладка станции «Озёрная»: главный путь 1 во втором ряду, путь 3 над ним
 * между стрелками 1 и 3, тупиковый путь 2 под ним от стрелки 5 с упором и остряком 2со,
 * мост на главном пути у правой горловины, переезд у левой.
 */
export function sampleStationLayout(): StationLayout {
  return {
    version: 1,
    nodes: [
      { id: 'a', col: 0, row: 1, kind: 'end', end: 'open' },
      { id: 's1', col: 4, row: 1, kind: 'switch' },
      { id: 's5', col: 8, row: 1, kind: 'switch' },
      { id: 's3', col: 36, row: 1, kind: 'switch' },
      { id: 'b', col: 44, row: 1, kind: 'end', end: 'open' },
      { id: 'c', col: 6, row: 0, kind: 'bend' },
      { id: 'd', col: 34, row: 0, kind: 'bend' },
      { id: 'e', col: 10, row: 2, kind: 'bend' },
      { id: 'f', col: 30, row: 2, kind: 'end', end: 'stop' },
    ],
    tracks: [
      {
        id: 't1',
        number: '1',
        kind: 'main',
        state: 'normal',
        nodes: ['a', 's1', 's5', 's3', 'b'],
        fullLength: null,
        capacity: null,
      },
      {
        id: 't3',
        number: '3',
        kind: 'station',
        state: 'normal',
        nodes: ['s1', 'c', 'd', 's3'],
        fullLength: 850,
        capacity: '70',
      },
      {
        id: 't2',
        number: '2',
        kind: 'station',
        state: 'normal',
        nodes: ['s5', 'e', 'f'],
        fullLength: 400,
        capacity: null,
      },
    ],
    switches: [
      { id: 'w1', number: '1', node: 's1', track: 't1', branch: 't3' },
      { id: 'w5', number: '5', node: 's5', track: 't1', branch: 't2' },
      { id: 'w3', number: '3', node: 's3', track: 't1', branch: 't3' },
    ],
    derailers: [{ id: 'r1', number: '2со', track: 't2', col: 26 }],
    bridges: [{ id: 'g1', label: null, track: 't1', fromCol: 40, toCol: 42 }],
    crossings: [{ id: 'x1', label: 'переезд 20км', km: 20, pk: 3, col: 2, fromRow: 0, toRow: 2 }],
  }
}

/**
 * Вымышленный срез редакции для тестов и примеров (ADR-0008).
 * Направление «L1» — два участка протяжения, между ними чужая дистанция (25–30 км);
 * 20 км короче обычного (964 м). ПД-1 — 10–18 км, ПД-2 — 18–25 и 30–45 км,
 * 45–60 км не входит ни в один действующий ПД. Станция «S1» (ПД-2) с путями 1–3
 * и стрелками 1, 3, 5 и раскладкой схемы.
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
      {
        id: 'S1',
        name: 'Озёрная',
        tracks: ['1', '2', '3'],
        switches: ['1', '3', '5'],
        pd: 'ПД-2',
        layout: sampleStationLayout(),
      },
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
