import { picketBounds, type Result } from '@eow/shared/kernel'
import type { ExportError, ExportLocation, ExportTable } from './export-source'
import type { ImportedCrossing } from './crossing-forms'
import type { ImportRemark } from './org-structure'
import { validOn } from './org-structure'
import { parseRows, type ExportPoint, type Validity } from './row-reader'
import type { ImportedStationAxis, ImportedSwitch, ImportedTrack } from './station-forms'

// --- ОКАТО -----------------------------------------------------------------

export interface ImportedTerritory {
  readonly name: string
  readonly type: string
  readonly parent: string | null
  readonly parentType: string | null
  readonly validity: Validity
  readonly at: ExportLocation
}

export function parseOkato(
  table: ExportTable,
): Result<ImportedTerritory[], readonly ExportError[]> {
  return parseRows(table, 'okato', (r) => ({
    name: r.required('ОКАТО'),
    type: r.required('Тип'),
    parent: r.text('Верхний ОКАТО'),
    parentType: r.text('Тип верхнего ОКАТО'),
    validity: r.validity('Начало действия', 'Конец действия'),
    at: r.location(),
  }))
}

const territoryKey = (name: string, type: string): string => JSON.stringify([type, name])

/** Дерево территорий на дату: вышестоящая есть в выгрузке, циклов нет (раздел 6.1). */
export function checkTerritories(
  territories: readonly ImportedTerritory[],
  date: string,
): {
  readonly territories: readonly ImportedTerritory[]
  readonly remarks: readonly ImportRemark[]
} {
  const valid = territories.filter((t) => validOn(t.validity, date))
  const byKey = new Map(valid.map((t) => [territoryKey(t.name, t.type), t]))
  const remarks: ImportRemark[] = []
  for (const t of valid) {
    if (t.parent === null) continue
    if (!byKey.has(territoryKey(t.parent, t.parentType ?? ''))) {
      remarks.push({
        text: `У территории «${t.name}» нет вышестоящей «${t.parent}» в выгрузке ОКАТО`,
        at: t.at,
      })
      continue
    }
    const seen = new Set<string>()
    let cur: ImportedTerritory | undefined = t
    while (cur?.parent) {
      const key = territoryKey(cur.name, cur.type)
      if (seen.has(key)) {
        remarks.push({
          text: `Территории ОКАТО ссылаются друг на друга по кругу: «${t.name}»`,
          at: t.at,
        })
        break
      }
      seen.add(key)
      cur = byKey.get(territoryKey(cur.parent, cur.parentType ?? ''))
    }
  }
  return { territories: valid, remarks }
}

// --- Станции, пути, стрелки и переезды ---------------------------------------

export interface StationSources {
  readonly axes: readonly ImportedStationAxis[]
  readonly tracks: readonly ImportedTrack[]
  readonly switches: readonly ImportedSwitch[]
  readonly crossings: readonly ImportedCrossing[]
  /** Имена главных путей из выгрузок характеристик и границ. */
  readonly lines: readonly string[]
}

export interface StationCheck {
  readonly axes: readonly ImportedStationAxis[]
  readonly tracks: readonly ImportedTrack[]
  readonly switches: readonly ImportedSwitch[]
  readonly crossings: readonly ImportedCrossing[]
  /** Главные пути каждого переезда по столбцу «Направление»; без совпадения — нет записи. */
  readonly crossingLines: ReadonlyMap<string, readonly string[]>
  /**
   * Станции без путей и стрелок в экспликациях — возможно, ликвидированы.
   * Только подсказка: список исключений редакции ведёт пользователь.
   */
  readonly exclusionCandidates: readonly string[]
  readonly remarks: readonly ImportRemark[]
}

const cmp = (a: ExportPoint, b: ExportPoint): number => a.km - b.km || a.m - b.m

/** «Главный путь Северная-Южная, 1» и «СЕВЕРНАЯ-ЮЖНАЯ» — одно направление. */
export function directionKey(text: string): string {
  return text
    .replace(/^главный путь\s+/iu, '')
    .replace(/,\s*\d+\s*$/u, '')
    .toUpperCase()
    .replaceAll('Ё', 'Е')
    .replaceAll(/\s+/gu, '')
}

/** Границей пути бывает стрелка («9», «4СО»), упор или объект («ТЭЦ», «М1»): сверяются только стрелки. */
const SWITCH_NUMBER = /^\d+\S*$/u

function remark(text: string, at: ExportLocation | undefined): ImportRemark {
  return at ? { text, at } : { text }
}

function switchRemarks(
  tracks: readonly ImportedTrack[],
  switches: readonly ImportedSwitch[],
): ImportRemark[] {
  const known = new Map<string, Set<string>>()
  for (const s of switches) known.set(s.station, (known.get(s.station) ?? new Set()).add(s.number))
  const out: ImportRemark[] = []
  for (const t of tracks) {
    const own = known.get(t.station) ?? new Set<string>()
    const ends = [t.from, ...t.via, t.to].filter(
      (x): x is string => x !== null && SWITCH_NUMBER.test(x),
    )
    const missing = ends.filter((n) => !own.has(n))
    if (missing.length > 0) {
      out.push(
        remark(
          `Путь № ${t.number} станции ${t.station}: в экспликации стрелок нет перевода № ${missing.join(', ')}`,
          t.at,
        ),
      )
    }
  }
  return out
}

function crossingRemarks(
  crossings: readonly ImportedCrossing[],
  axes: readonly ImportedStationAxis[],
  excluded: ReadonlySet<string>,
): ImportRemark[] {
  const out: ImportRemark[] = []
  for (const c of crossings) {
    const station = c.titleStation
    if (station === null) continue
    if (excluded.has(station)) {
      out.push(
        remark(
          `Переезд № ${c.number}: в названии исключённая станция ${station}; переезд остаётся на направлении по километру`,
          c.at,
        ),
      )
      continue
    }
    const own = axes.filter((a) => a.station === station)
    if (own.length === 0) {
      out.push(
        remark(`Переезд № ${c.number}: станции ${station} из названия нет в осях станций`, c.at),
      )
      continue
    }
    // Переезд станционного или подъездного пути (в столбце «Станция» — её название,
    // направление «-») и переезд на ветке считаются не по главному пути.
    if (!c.place || c.place.siding || c.stationColumn !== null) continue
    const picket = picketBounds(c.place.km, c.place.pk)
    if (!picket.ok) continue
    const point = picket.value.start
    const relevant = own.filter(
      (a) => c.direction !== null && directionKey(a.line) === directionKey(c.direction),
    )
    if (relevant.length === 0 && c.direction !== null) {
      out.push(
        remark(
          `Переезд № ${c.number}: станция ${station} из названия отсутствует на направлении «${c.direction}»`,
          c.at,
        ),
      )
      continue
    }
    const bounded = relevant.filter((a) => a.from !== null && a.to !== null)
    // Без границ станции (остановочный пункт) проверить километр не по чему.
    if (bounded.length === 0) continue
    const inside = bounded.some(
      (a) => a.from !== null && a.to !== null && cmp(a.from, point) <= 0 && cmp(point, a.to) <= 0,
    )
    if (!inside) {
      out.push(
        remark(
          `Переезд № ${c.number} записан «на станции ${station}», но ${c.place.km} км пк ${c.place.pk} вне её границ — проверьте станцию в названии`,
          c.at,
        ),
      )
    }
  }
  return out
}

/**
 * Сверка станционных данных (раздел 8.3, критерии #18): станции экспликаций есть
 * в осях, стрелки на границах путей есть в экспликации стрелок, станция в названии
 * переезда совпадает с его километром. Исключённые станции (список исключений
 * редакции) убираются из осей и экспликаций. Данные не исправляются.
 */
export function checkStations(
  sources: StationSources,
  date: string,
  excluded: ReadonlySet<string>,
): StationCheck {
  const remarks: ImportRemark[] = []
  const axes = sources.axes.filter((a) => validOn(a.validity, date) && !excluded.has(a.station))
  const stations = new Set(axes.map((a) => a.station))
  const keep = <T extends { readonly station: string; readonly at: ExportLocation }>(
    rows: readonly T[],
    what: string,
  ): T[] =>
    rows.filter((row) => {
      if (excluded.has(row.station)) return false
      if (!stations.has(row.station)) {
        remarks.push(
          remark(
            `Станция ${row.station} есть в экспликации ${what}, но нет в осях станций`,
            row.at,
          ),
        )
      }
      return true
    })
  const tracks = keep(sources.tracks, 'путей')
  const switches = keep(sources.switches, 'стрелочных переводов')
  remarks.push(...switchRemarks(tracks, switches))
  remarks.push(...crossingRemarks(sources.crossings, axes, excluded))

  const lineByKey = new Map<string, string[]>()
  for (const line of sources.lines) {
    const key = directionKey(line)
    lineByKey.set(key, [...(lineByKey.get(key) ?? []), line])
  }
  const crossingLines = new Map<string, readonly string[]>()
  for (const c of sources.crossings) {
    const line = c.direction ? lineByKey.get(directionKey(c.direction)) : undefined
    if (!c.place)
      remarks.push(remark(`Переезд № ${c.number}: не удалось разобрать привязку км и пк`, c.at))
    if (line && c.stationColumn === null && !c.place?.siding) crossingLines.set(c.title, line)
    else if (c.stationColumn === null && !c.place?.siding)
      remarks.push(
        remark(
          `Переезд № ${c.number}: направления «${c.direction ?? '—'}» нет среди главных путей`,
          c.at,
        ),
      )
    else if (
      c.stationColumn !== null &&
      !stations.has(c.stationColumn) &&
      !excluded.has(c.stationColumn)
    )
      remarks.push(
        remark(`Переезд № ${c.number}: станции ${c.stationColumn} нет в осях станций`, c.at),
      )
  }

  const withData = new Set([...tracks, ...switches].map((x) => x.station))
  const exclusionCandidates = [...stations].filter((s) => !withData.has(s))
  return {
    axes,
    tracks,
    switches,
    crossings: sources.crossings,
    crossingLines,
    exclusionCandidates,
    remarks: [
      ...new Map(
        remarks.map((r) => [JSON.stringify([r.text, r.at?.file, r.at?.sheet, r.at?.row]), r]),
      ).values(),
    ],
  }
}
