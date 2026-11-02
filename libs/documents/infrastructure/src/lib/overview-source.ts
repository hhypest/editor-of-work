import type { OverviewLine, OverviewSource } from '@eow/documents/application'
import type { OrgData, StationRow } from '@eow/passport/import-api'

export interface PassportOverviewData {
  readonly edition: OverviewSource['edition']
  readonly lines: readonly OverviewLine[]
  readonly org: OrgData
  readonly stations: readonly StationRow[]
}
const valid = (
  row: { readonly validFrom: string | null; readonly validTo: string | null },
  date: string,
): boolean =>
  (row.validFrom === null || row.validFrom <= date) && (row.validTo === null || row.validTo >= date)

/** Проекция среза Паспорта: без догадок о направлении и без восстановления исключённых объектов. */
export function passportOverviewSource(data: PassportOverviewData): OverviewSource {
  const date = data.edition.date
  const active = new Map(
    data.org.subdivisions.filter((u) => u.active && valid(u, date)).map((u) => [u.id, u]),
  )
  const units = new Map(
    [...active.values()].filter((u) => u.type === 'ПД').map((u) => [u.id, u.code]),
  )
  /** ПЧУ — ближайший действующий предок ПД; цикл оргструктуры обрывает поиск. */
  const pchuOf = (id: string): string | undefined => {
    const seen = new Set<string>()
    let parent = active.get(id)?.parentId ?? null
    while (parent !== null && !seen.has(parent)) {
      seen.add(parent)
      const unit = active.get(parent)
      if (!unit) return undefined
      if (unit.type === 'ПЧУ') return unit.code
      parent = unit.parentId
    }
    return undefined
  }
  const warnings: string[] = []
  const lineId = (name: string): string | undefined => {
    const lines = data.lines.filter((l) => l.name === name)
    if (lines.length !== 1) {
      warnings.push(`Направление «${name}» отсутствует или неоднозначно; его привязки не показаны.`)
      return undefined
    }
    return lines[0]?.id
  }
  const axes: OverviewSource['axes'][number][] = []
  for (const row of data.stations)
    if (row.form === 'station-axes' && valid(row, date)) {
      const id = lineId(row.values.line)
      if (id) axes.push({ id: row.id, lineId: id, name: row.values.station, at: row.values.axis })
    }
  const boundaries: OverviewSource['boundaries'][number][] = []
  for (const boundary of data.org.boundaries) {
    const code = units.get(boundary.subdivisionId)
    if (!code || !valid(boundary, date)) continue
    const id = lineId(boundary.line)
    const pchu = pchuOf(boundary.subdivisionId)
    if (id)
      boundaries.push({
        lineId: id,
        code,
        ...(pchu === undefined ? {} : { pchu }),
        from: boundary.from,
        to: boundary.to,
      })
  }
  return { edition: data.edition, lines: data.lines, axes, boundaries, warnings }
}
