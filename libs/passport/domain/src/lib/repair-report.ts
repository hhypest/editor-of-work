import {
  chainage,
  compareChainage,
  distance,
  err,
  KmLengths,
  ok,
  type Chainage,
  type Result,
} from '@eow/shared/kernel'
import type { PassportError } from './passport-edition'
import { assessRepairs, repairPeriodContains } from './repair-need'
import type { RepairReport, RepairReportRow, RepairSegment, RepairSnapshot } from './repair-types'

/** ADR-0007: результат каждый раз строится из исходных данных редакции, без записи в БД. */
export function calculateRepairReport(
  snapshot: RepairSnapshot,
): Result<RepairReport, PassportError> {
  const year = Number(snapshot.date.slice(0, 4))
  const norms = snapshot.norms.filter((n) => repairPeriodContains(n, snapshot.date))
  if (
    norms.some(
      (n) =>
        (n.years === null && n.millionTons === null) ||
        [n.years, n.millionTons].some((v) => v !== null && (!Number.isFinite(v) || v <= 0)),
    )
  )
    return err({
      kind: 'invalid-import',
      message: 'Нормы ремонта должны содержать положительные пороги.',
    })
  const rows: RepairReportRow[] = []
  for (const line of snapshot.lines) {
    const lengths = KmLengths.of(line.kmLengths)
    if (!lengths.ok) return invalidGeometry()
    const segments = snapshot.segments.filter(
      (s) => s.lineId === line.id && repairPeriodContains(s, snapshot.date),
    )
    for (const extent of line.extents) {
      if (compareChainage(extent.from, extent.to) >= 0) return invalidGeometry()
      const points = [extent.from, extent.to, ...segments.flatMap((s) => [s.from, s.to])]
        .filter((p) => compareChainage(extent.from, p) <= 0 && compareChainage(p, extent.to) <= 0)
        .toSorted(compareChainage)
        .filter((p, i, all) => i === 0 || compareChainage(p, all[i - 1] ?? p) !== 0)
      if (points.some((p) => !chainage(p.km, p.m, lengths.value).ok)) return invalidGeometry()
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1],
          to = points[i]
        if (!from || !to) continue
        const covering = segments.filter(
          (s) => compareChainage(s.from, from) <= 0 && compareChainage(to, s.to) <= 0,
        )
        rows.push(
          lineRow(
            line,
            covering,
            from,
            to,
            distance(from, to, lengths.value),
            snapshot.date,
            year,
            norms,
          ),
        )
      }
    }
  }
  for (const track of snapshot.tracks.filter((t) => repairPeriodContains(t, snapshot.date))) {
    const lastRepairYear = track.lastRepairYear
    rows.push({
      location: { kind: 'station', station: track.station, track: track.number },
      lastRepairYear,
      tonnageAfter: null,
      assessments: assessRepairs(
        {
          trackClass: track.classCode,
          trackGroup: null,
          trackCategory: null,
          railType: track.railType,
          sleeperType: track.sleeperType,
        },
        lastRepairYear,
        null,
        year,
        norms,
      ),
    })
  }
  return ok({ date: snapshot.date, rows })
}
function invalidGeometry(): Result<never, PassportError> {
  return err({
    kind: 'invalid-import',
    message: 'Неверные координаты или длины километров для отчёта о ремонтах.',
  })
}
function lineRow(
  line: RepairSnapshot['lines'][number],
  segments: readonly RepairSegment[],
  from: Chainage,
  to: Chainage,
  lengthM: number,
  date: string,
  year: number,
  norms: RepairSnapshot['norms'],
): RepairReportRow {
  const classes = segments.filter((s) => s.form === 'class')
  const rails = segments.filter((s) => s.form === 'rails')
  const sleepers = segments.filter((s) => s.form === 'sleepers')
  const c = classes.length === 1 ? classes[0]?.values : undefined
  const r = rails.length === 1 ? rails[0]?.values : undefined
  const s = sleepers.length === 1 ? sleepers[0]?.values : undefined
  const lastRepairYear = r?.laidDate && r.laidDate <= date ? Number(r.laidDate.slice(0, 4)) : null
  const tonnageAfter = r?.tonnageAfter ?? null
  const problem = [classes, rails, sleepers].some((values) => values.length > 1)
    ? 'Перекрываются характеристики одного вида. Уточните исходные данные.'
    : r?.laidDate && r.laidDate > date
      ? 'Дата укладки рельсов позже даты редакции. Уточните исходные данные.'
      : null
  return {
    location: { kind: 'line', lineId: line.id, lineName: line.name, from, to, lengthM },
    lastRepairYear,
    tonnageAfter,
    assessments: assessRepairs(
      {
        trackClass: c?.trackClass ?? null,
        trackGroup: c?.group ?? null,
        trackCategory: c?.category ?? null,
        railType: r?.railType ?? null,
        sleeperType: s?.sleeperType ?? null,
      },
      lastRepairYear,
      tonnageAfter,
      year,
      norms,
      problem,
    ),
  }
}
