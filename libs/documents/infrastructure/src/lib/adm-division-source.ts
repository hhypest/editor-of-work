import type { AdmDivisionSource } from '@eow/documents/application'
import { DISTRICT_ROW, headOn } from '@eow/passport/import-api'
import { orgUnits, valid, type PassportOverviewData } from './overview-source'

/**
 * Срез Паспорта для административного деления (#32, ADR-0052): действующие ПД и ПЧУ на дату
 * редакции, их границы, привязка станций, оси, пути и стрелки станций. Значения не
 * исправляются: обрезаются только пробелы по краям названий и назначений, как их сравнивает Excel.
 */
export function passportAdmDivisionSource(data: PassportOverviewData): AdmDivisionSource {
  const date = data.edition.date
  const { active, units, pchuOf } = orgUnits(data.org, date)
  const heads = data.manual?.heads ?? []
  const head = (code: string) => headOn(heads, code, date)?.head ?? undefined
  const ids = new Map([...active.values()].map((u) => [u.code, u.id]))
  const result: AdmDivisionSource['units'][number][] = []
  for (const unit of active.values()) {
    if (unit.type === 'ПЧУ') result.push({ code: unit.code, kind: 'ПЧУ', head: head(unit.code) })
    if (unit.type === 'ПД')
      result.push({ code: unit.code, kind: 'ПД', head: head(unit.code), pchu: pchuOf(unit.id) })
  }
  const warnings: string[] = []
  const duplicates = [...active.values()].filter((u) => ids.get(u.code) !== u.id)
  if (duplicates.length)
    warnings.push(
      `Коды подразделений повторяются: ${[...new Set(duplicates.map((u) => u.code))].join(', ')}.`,
    )
  const district = headOn(heads, DISTRICT_ROW, date)?.title ?? undefined
  return {
    edition: { date },
    ...(district ? { district } : {}),
    lines: data.lines.map((l) => ({ name: l.name, kmLengths: l.kmLengths })),
    units: result,
    boundaries: data.org.boundaries.flatMap((b) => {
      const pd = units.get(b.subdivisionId)
      return pd && valid(b, date)
        ? [{ pd, line: b.line, from: b.from, to: b.to, statedLength: b.statedLength }]
        : []
    }),
    bindings: data.org.stations.flatMap((b) => {
      const pd = units.get(b.subdivisionId)
      return pd && valid(b, date) ? [{ station: b.station.trim(), pd }] : []
    }),
    axes: data.stations.flatMap((row) =>
      row.form === 'station-axes' && valid(row, date)
        ? [{ station: row.values.station.trim(), line: row.values.line, at: row.values.axis }]
        : [],
    ),
    tracks: data.stations.flatMap((row) =>
      row.form === 'station-tracks' && valid(row, date)
        ? [
            {
              station: row.values.station.trim(),
              number: row.values.number,
              purpose: row.values.purpose.trim(),
              fullLength: row.values.fullLength,
              usefulLength: row.values.usefulLength,
            },
          ]
        : [],
    ),
    switches: data.stations.flatMap((row) =>
      row.form === 'switches' && valid(row, date)
        ? [
            {
              station: row.values.station.trim(),
              number: row.values.number,
              purpose: row.values.purpose?.trim() || null,
              frogMark: row.values.frogMark,
              railType: row.values.railType,
            },
          ]
        : [],
    ),
    warnings,
  }
}
