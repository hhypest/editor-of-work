import { createHash } from 'node:crypto'
import {
  addWork,
  areaExists,
  areaKey,
  createAnnualPlan,
  describePlanError,
  planBasis,
  setManualValue,
  setPlanIndicators,
  setPdScale,
  workId,
  type AnnualPlan,
  type BasisLine,
  type PlanArea,
  type PlanBasis,
  type WorkPlace,
} from '@eow/planning/domain'
import {
  chainage,
  compareChainage,
  err,
  KmLengths,
  ok,
  spansOverlap,
  type Result,
  type TrackSpan,
} from '@eow/shared/kernel'
import type { PlanStoreError } from '@eow/planning/application'
import {
  formatHeader,
  planFileSchema,
  planFileV1Schema,
  planFileV2Schema,
  planFileV3Schema,
  snapshotSchema,
  type BasisSnapshot,
  type PlanFile,
} from './plan-file-schema'

export const PLAN_FORMAT_VERSION = 4
type FileResult<T> = Result<T, PlanStoreError>

function invalid(message: string): PlanStoreError {
  return { kind: 'invalid-file', message: `Не удалось открыть план: ${message}` }
}

/** Последовательные преобразования vN → vN+1; схема каждой прежней версии сохраняется. */
const migrations: ReadonlyMap<number, (file: unknown) => unknown> = new Map([
  [
    3,
    (file) => {
      const parsed = planFileV3Schema.safeParse(file)
      if (!parsed.success) return file
      return {
        ...parsed.data,
        format: { ...parsed.data.format, version: 4 },
        plan: { ...parsed.data.plan, pdScales: [] },
      }
    },
  ],
  [
    2,
    (file) => {
      const parsed = planFileV2Schema.safeParse(file)
      if (!parsed.success) return file
      return {
        ...parsed.data,
        format: { ...parsed.data.format, version: 3 },
        plan: { ...parsed.data.plan, indicators: [] },
      }
    },
  ],
  [
    1,
    (file) => {
      const parsed = planFileV1Schema.safeParse(file)
      if (!parsed.success) return file
      return {
        ...parsed.data,
        format: { ...parsed.data.format, version: 2 },
        plan: { ...parsed.data.plan, prototype: null },
      }
    },
  ],
])

export function readPlanFile(text: string): FileResult<PlanFile> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return err(invalid('файл не является JSON'))
  }
  const header = formatHeader.safeParse(value)
  if (!header.success) return err(invalid('нет версии формата'))
  if (header.data.format.version > PLAN_FORMAT_VERSION)
    return err({
      kind: 'future-version',
      message: 'План сохранён более новой программой. Откройте его в новой версии.',
    })
  for (let version = header.data.format.version; version < PLAN_FORMAT_VERSION; version++) {
    const migrate = migrations.get(version)
    if (!migrate) return err(invalid(`нет миграции формата ${version}`))
    value = migrate(value)
  }
  const parsed = planFileSchema.safeParse(value)
  if (!parsed.success)
    return err(
      invalid(
        `неверная структура (${parsed.error.issues.map((i) => i.path.join('.')).join(', ')})`,
      ),
    )
  if (checksum(parsed.data.edition.snapshot) !== parsed.data.edition.checksum)
    return err(invalid('контрольная сумма среза паспорта не совпадает'))
  return ok(parsed.data)
}

function checksum(snapshot: BasisSnapshot): string {
  // Схема задаёт устойчивый порядок полей; порядок массивов (в том числе нормативов) сохраняется.
  return createHash('sha256')
    .update(JSON.stringify(snapshotSchema.parse(snapshot)))
    .digest('hex')
}

function areaFromKey(key: string): PlanArea | undefined {
  if (key === 'district') return { kind: 'district' }
  if (key.startsWith('pd:')) return { kind: 'pd', pd: key.slice(3) }
  if (key.startsWith('station:')) return { kind: 'station', station: key.slice(8) }
  return undefined
}

export function encodePlan(plan: AnnualPlan, appVersion: string): FileResult<string> {
  const basis = plan.basis
  const snapshotResult = snapshotSchema.safeParse({
    lines: [...basis.lines.values()].map((l) => ({ ...l, kmLengths: l.kmLengths.entries() })),
    stations: [...basis.stations.values()].map((s) => ({ ...s, pd: s.pd ?? null })),
    pds: [...basis.pds.values()],
    workKinds: [...basis.workKinds.values()],
  })
  if (!snapshotResult.success) return err(invalid('срез паспорта содержит неверные данные'))
  const snapshot = snapshotResult.data
  const manual: PlanFile['plan']['manual'] = []
  const indicators: PlanFile['plan']['indicators'] = []
  for (const [key, rows] of plan.indicators) {
    const area = areaFromKey(key)
    if (!area) return err(invalid('неизвестная область показателей'))
    indicators.push({ area, rows: rows.map((row) => ({ ...row })) })
  }
  for (const [key, values] of plan.manual) {
    const area = areaFromKey(key)
    if (!area) return err(invalid('неизвестная область ручных значений'))
    manual.push({ area, overrides: [...values.overrides], needs: [...values.needs] })
  }
  const file = planFileSchema.safeParse({
    format: { version: PLAN_FORMAT_VERSION, appVersion },
    edition: { ...basis.edition, checksum: checksum(snapshot), snapshot },
    plan: {
      prototype: plan.prototype ?? null,
      year: plan.year,
      approval: plan.approval,
      works: plan.works.map((w) => ({ ...w, volume: w.volume ?? null })),
      manual,
      indicators,
      pdScales: [...plan.pdScales].map(([pd, scale]) => ({ pd, scale })),
    },
  })
  if (!file.success) return err(invalid('план содержит неверные данные'))
  const domain = restorePlan(file.data)
  return domain.ok ? ok(JSON.stringify(file.data, null, 2) + '\n') : domain
}

function validSpan(s: TrackSpan, lines: ReadonlyMap<string, BasisLine>): boolean {
  const lengths = lines.get(s.line)?.kmLengths
  return (
    lengths !== undefined &&
    chainage(s.from.km, s.from.m, lengths).ok &&
    chainage(s.to.km, s.to.m, lengths).ok &&
    compareChainage(s.from, s.to) < 0
  )
}

function restoreBasis(file: PlanFile): FileResult<PlanBasis> {
  const snapshot = file.edition.snapshot
  const lines: BasisLine[] = []
  for (const line of snapshot.lines) {
    const lengths = KmLengths.of(line.kmLengths)
    if (!lengths.ok) return err(invalid('неверные длины километров'))
    lines.push({ ...line, kmLengths: lengths.value })
  }
  const lineMap = new Map(lines.map((l) => [l.id, l]))
  for (const span of [
    ...lines.flatMap((l) => l.extent),
    ...snapshot.pds.flatMap((pd) => pd.segments),
  ])
    if (!validSpan(span, lineMap)) return err(invalid('неверные координаты границ'))
  const basis = planBasis({
    edition: { number: file.edition.number, date: file.edition.date },
    lines,
    stations: snapshot.stations.map((s) => {
      const { legacyLayout, ...rest } = s
      return {
        ...rest,
        pd: s.pd ?? undefined,
        ...(legacyLayout === undefined ? {} : { legacyLayout }),
      }
    }),
    pds: snapshot.pds,
    workKinds: snapshot.workKinds.map((k) => {
      const { includedIn, ...rest } = k
      return includedIn === undefined ? rest : { ...rest, includedIn }
    }),
  })
  return basis.ok ? basis : err(invalid(describePlanError(basis.error)))
}

function validPlace(place: WorkPlace, basis: PlanBasis): boolean {
  if (place.kind === 'station') return true
  const lengths = basis.lines.get(place.spec.line)?.kmLengths
  if (!lengths) return false
  return place.spec.items.every((item, i, items) => {
    if (item.line !== place.spec.line) return false
    if (item.kind === 'point') return chainage(item.at.km, item.at.m, lengths).ok
    return (
      validSpan(item, basis.lines) &&
      !items.slice(i + 1).some((other) => other.kind === 'span' && spansOverlap(item, other))
    )
  })
}

/** Восстановление через фабрики домена: JSON не может обойти предметные проверки. */
export function restorePlan(file: PlanFile): FileResult<AnnualPlan> {
  const basis = restoreBasis(file)
  if (!basis.ok) return basis
  let result = createAnnualPlan(file.plan.year, basis.value, file.plan.approval)
  if (!result.ok) return err(invalid(result.error.map(describePlanError).join('; ')))
  let plan = result.value
  const scaledPds = new Set<string>()
  for (const entry of file.plan.pdScales) {
    if (scaledPds.has(entry.pd)) return err(invalid('настройка масштаба ПД повторяется'))
    scaledPds.add(entry.pd)
    const changed = setPdScale(plan, entry.pd, entry.scale)
    if (!changed.ok) return err(invalid(changed.error.map(describePlanError).join('; ')))
    plan = changed.value
  }
  for (const work of file.plan.works) {
    const p = work.place
    const place: WorkPlace =
      p.kind === 'line'
        ? {
            kind: 'line',
            spec: p.spec,
            ...(p.station === undefined ? {} : { station: p.station }),
            ...(p.object ? { object: p.object } : {}),
          }
        : p.object
          ? { kind: 'station', station: p.station, object: p.object }
          : { kind: 'station', station: p.station }
    if (!validPlace(place, basis.value)) return err(invalid('неверные координаты места работы'))
    result = addWork(plan, workId(work.id), { ...work, place, volume: work.volume ?? undefined })
    if (!result.ok) return err(invalid(result.error.map(describePlanError).join('; ')))
    plan = result.value
  }
  const areas = new Set<string>()
  const indicatorAreas = new Set<string>()
  for (const entry of file.plan.indicators) {
    const key = areaKey(entry.area)
    if (indicatorAreas.has(key)) return err(invalid('область показателей повторяется'))
    indicatorAreas.add(key)
    const next = setPlanIndicators(plan, entry.area, entry.rows)
    if (!next.ok) return err(invalid(next.error.map(describePlanError).join('; ')))
    plan = next.value
  }
  for (const row of file.plan.manual) {
    if (!areaExists(row.area, basis.value))
      return err(invalid('неизвестная область ручных значений'))
    const key = areaKey(row.area)
    if (areas.has(key)) return err(invalid('область ручных значений повторяется'))
    areas.add(key)
    for (const field of ['overrides', 'needs'] as const) {
      const codes = new Set<string>()
      for (const [code, value] of row[field]) {
        if (codes.has(code)) return err(invalid('ручное значение повторяется'))
        codes.add(code)
        result = setManualValue(plan, row.area, field, code, value)
        if (!result.ok) return err(invalid(result.error.map(describePlanError).join('; ')))
        plan = result.value
      }
    }
  }
  return ok(
    file.plan.prototype === null
      ? plan
      : {
          ...plan,
          prototype: Object.freeze({
            source: file.plan.prototype.source,
            report: Object.freeze(file.plan.prototype.report.map((r) => Object.freeze({ ...r }))),
          }),
        },
  )
}

export function decodePlan(text: string): FileResult<AnnualPlan> {
  const file = readPlanFile(text)
  return file.ok ? restorePlan(file.value) : file
}
