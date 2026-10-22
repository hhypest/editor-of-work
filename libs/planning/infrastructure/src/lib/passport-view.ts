import type { ManualData, OrgData } from '@eow/passport/import-api'
import type { PassportView, PlanCreationError } from '@eow/planning/application'
import type {
  BasisLine,
  BasisPd,
  BasisStation,
  PlanBasisInput,
  WorkKind,
} from '@eow/planning/domain'
import {
  chainage,
  err,
  KmLengths,
  ok,
  spanContains,
  spansOverlap,
  trackSpan,
  type Chainage,
  type Result,
  type TrackSpan,
} from '@eow/shared/kernel'

interface Edition {
  readonly id: number
  readonly number: number
  readonly date: string
  readonly label: string
  readonly status: 'draft' | 'active' | 'archived'
}
/** Структурный опубликованный вход: без импорта домена или application Паспорта. */
export interface PassportPlanData {
  readonly edition: Edition
  readonly lines: readonly {
    readonly id: string
    readonly name: string
    readonly extents: readonly { readonly from: Chainage; readonly to: Chainage }[]
    readonly kmLengths: readonly (readonly [number, number])[]
  }[]
  readonly stations: readonly {
    readonly id: string
    readonly name: string
    readonly tracks: readonly string[]
    readonly switches: readonly string[]
  }[]
  readonly org: OrgData
  readonly manual: ManualData
}
export interface PassportPlanSource {
  list(): Promise<Result<readonly Edition[], PlanCreationError>>
  planningData(id: number): Promise<Result<PassportPlanData, PlanCreationError>>
}
const invalid = (message: string): Result<never, PlanCreationError> => err({ message })
const valid = (
  row: { readonly validFrom: string | null; readonly validTo: string | null },
  date: string,
): boolean =>
  (row.validFrom === null || row.validFrom <= date) && (row.validTo === null || row.validTo >= date)

/** Перевод согласованного среза в язык Планирования без угадывания неоднозначных связей. */
export function passportPlanBasis(
  data: PassportPlanData,
): Result<PlanBasisInput, PlanCreationError> {
  if (data.edition.status === 'draft')
    return invalid(
      'Сначала введите редакцию паспорта в действие. Черновик не может быть основой плана.',
    )
  const date = data.edition.date
  const count = data.org.boundaries.length
  if (count * count > 10_000_000) return invalid('Слишком много границ для создания плана.')
  const lines: BasisLine[] = []
  for (const source of data.lines) {
    const lengths = KmLengths.of(source.kmLengths)
    if (!lengths.ok) return invalid(`Направление «${source.name}»: неверные длины километров.`)
    const extent: TrackSpan[] = []
    for (const e of source.extents) {
      const from = chainage(e.from.km, e.from.m, lengths.value)
      const to = chainage(e.to.km, e.to.m, lengths.value)
      if (!from.ok || !to.ok)
        return invalid(`Направление «${source.name}»: координаты вне длин километров.`)
      const span = trackSpan(source.id, from.value, to.value)
      if (!span.ok || extent.some((p) => spansOverlap(p, span.value)))
        return invalid(`Направление «${source.name}»: пустое или пересекающееся протяжение.`)
      extent.push(span.value)
    }
    if (!extent.length)
      return invalid(`Направление «${source.name}»: нет протяжения на дату редакции.`)
    lines.push({ id: source.id, name: source.name, kmLengths: lengths.value, extent })
  }
  const units = new Map(
    data.org.subdivisions.filter((u) => u.active && valid(u, date)).map((u) => [u.id, u]),
  )
  const pds: BasisPd[] = []
  for (const unit of units.values()) {
    if (unit.type !== 'ПД') continue
    let parent = unit.parentId
    let pchu = 'Не указан'
    const visited = new Set([unit.id])
    while (parent !== null) {
      if (visited.has(parent)) return invalid(`ПД «${unit.code}»: цикл оргструктуры.`)
      visited.add(parent)
      const ancestor = units.get(parent)
      if (!ancestor) break
      if (ancestor.type === 'ПЧУ') {
        pchu = ancestor.code
        break
      }
      parent = ancestor.parentId
    }
    const segments: TrackSpan[] = []
    for (const boundary of data.org.boundaries.filter(
      (b) => b.subdivisionId === unit.id && valid(b, date),
    )) {
      const matches = lines.filter((l) => l.name === boundary.line)
      const line = matches.length === 1 ? matches[0] : undefined
      if (!line)
        return invalid(
          `ПД «${unit.code}»: направление «${boundary.line}» отсутствует или неоднозначно.`,
        )
      const from = chainage(boundary.from.km, boundary.from.m, line.kmLengths)
      const to = chainage(boundary.to.km, boundary.to.m, line.kmLengths)
      if (!from.ok || !to.ok)
        return invalid(`ПД «${unit.code}»: координаты границы вне длин километров.`)
      const span = trackSpan(line.id, from.value, to.value)
      if (!span.ok || !line.extent.some((e) => spanContains(e, span.value)))
        return invalid(`ПД «${unit.code}»: граница вне протяжения или пересекает разрыв.`)
      segments.push(span.value)
    }
    pds.push({ id: unit.id, name: unit.code, pchu, segments })
  }
  const stations: BasisStation[] = []
  const names = new Set<string>()
  for (const station of data.stations) {
    if (names.has(station.name))
      return invalid(`Станция «${station.name}» неоднозначна в редакции.`)
    names.add(station.name)
    if (
      new Set(station.tracks).size !== station.tracks.length ||
      new Set(station.switches).size !== station.switches.length
    )
      return invalid(`Станция «${station.name}»: повторяются номера путей или стрелок.`)
    const bindings = new Set(
      data.org.stations
        .filter(
          (b) =>
            b.station === station.name &&
            valid(b, date) &&
            pds.some((p) => p.id === b.subdivisionId),
        )
        .map((b) => b.subdivisionId),
    )
    if (bindings.size > 1)
      return invalid(`Станция «${station.name}» относится к нескольким действующим ПД.`)
    stations.push({
      id: station.id,
      name: station.name,
      tracks: [...station.tracks],
      switches: [...station.switches],
      pd: [...bindings][0],
    })
  }
  const workKinds: WorkKind[] = []
  for (const kind of data.manual.workKinds.filter((k) => valid(k, date))) {
    const group = kind.group
    if (group !== 'current' && group !== 'capital' && group !== 'other')
      return invalid(`Вид работ «${kind.code}»: неизвестная группа.`)
    workKinds.push({
      code: kind.code,
      name: kind.name,
      unit: kind.unit,
      group,
      inPlanTable: true,
      ...(kind.includedIn === null ? {} : { includedIn: kind.includedIn }),
    })
  }
  return ok({
    edition: { number: String(data.edition.number), date },
    lines,
    pds,
    stations,
    workKinds,
  })
}

export function passportPlanView(source: PassportPlanSource): PassportView {
  return {
    async editions() {
      const result = await source.list()
      if (!result.ok) return result
      return ok(
        result.value.flatMap((e) => (e.status === 'draft' ? [] : [{ ...e, status: e.status }])),
      )
    },
    async basis(id) {
      const result = await source.planningData(id)
      return result.ok ? passportPlanBasis(result.value) : result
    },
  }
}
