import type { ExportLocation } from './export-source'
import type {
  ExportPoint,
  ImportedBoundary,
  ImportedStationPd,
  ImportedSubdivision,
  ImportedTrackPd,
  Validity,
} from './org-forms'

/** Замечание импорта: данные не исправляются, решение принимает пользователь. */
export interface ImportRemark {
  readonly text: string
  readonly at?: ExportLocation
}

function remark(text: string, at: ExportLocation | undefined): ImportRemark {
  return at ? { text, at } : { text }
}

/** Строка действует на дату редакции (ГГГГ-ММ-ДД): начало ≤ дата ≤ конец. */
export function validOn(v: Validity, date: string): boolean {
  return (v.from === null || v.from <= date) && date <= v.to
}

/** В иерархию ПЧУ → ПД входят только эти типы; цеха (ЗП) и бригады — отдельно. */
const HIERARCHY_TYPES = new Set(['ПЧУ', 'ПД'])

const cmp = (a: ExportPoint, b: ExportPoint): number => a.km - b.km || a.m - b.m
const fmt = (p: ExportPoint): string => `${p.km}+${String(p.m).padStart(3, '0')}`

function overlap(a: ImportedBoundary, b: ImportedBoundary): [ExportPoint, ExportPoint] | undefined {
  if (a.line !== b.line) return undefined
  const from = cmp(a.from, b.from) >= 0 ? a.from : b.from
  const to = cmp(a.to, b.to) <= 0 ? a.to : b.to
  return cmp(from, to) < 0 ? [from, to] : undefined
}

// --- Мастер отметки действующих -------------------------------------------

export interface SubdivisionChoice {
  readonly code: string
  readonly type: string
  /** Как вышестоящее записано в выгрузке: «ПЧУ-01»; null — предприятие. */
  readonly parent: string | null
  readonly validFrom: string | null
  /** Число отрезков границ на дату редакции. */
  readonly segments: number
  /** Открытые ПД, границы которых пересекаются с этим: признак прежних и новых кодов. */
  readonly overlapsWith: readonly string[]
  /**
   * Предложение мастера: ПД с границами на дату; из пересекающихся — начатые позже.
   * Прежние коды обычно либо без границ, либо пересекаются с новыми.
   */
  readonly suggested: boolean
  /** Почему ПД не предложен: показывается рядом с ним в мастере. */
  readonly note: string | null
}

/**
 * Подразделения ПЧУ и ПД, открытые на дату редакции, для выбора действующих.
 * После реорганизации прежние коды ПД в выгрузке не закрываются, поэтому показываются
 * все открытые; пересечение границ подсказывает, какие из них прежние.
 */
export function subdivisionChoices(
  subdivisions: readonly ImportedSubdivision[],
  boundaries: readonly ImportedBoundary[],
  date: string,
): SubdivisionChoice[] {
  const open = subdivisions.filter((s) => HIERARCHY_TYPES.has(s.type) && validOn(s.validity, date))
  const segments = boundaries.filter((b) => validOn(b.validity, date))
  const ofUnit = (code: string): ImportedBoundary[] =>
    segments.filter((b) => b.subdivision === code)
  const start = new Map(open.map((s) => [s.code, s.validity.from ?? '']))
  return open.map((s) => {
    const mine = ofUnit(s.code)
    const overlapsWith =
      s.type === 'ПД'
        ? open
            .filter((o) => o.type === 'ПД' && o.code !== s.code)
            .filter((o) => mine.some((a) => ofUnit(o.code).some((b) => overlap(a, b))))
            .map((o) => o.code)
        : []
    const newer = overlapsWith.every((o) => (start.get(o) ?? '') <= (s.validity.from ?? ''))
    const isPd = s.type === 'ПД'
    const note = !isPd
      ? null
      : mine.length === 0
        ? 'нет границ на дату редакции'
        : newer
          ? null
          : `границы пересекаются с ${overlapsWith.join(', ')}, начатыми позже`
    return {
      code: s.code,
      type: s.type,
      parent: s.parent?.text ?? null,
      validFrom: s.validity.from,
      segments: mine.length,
      overlapsWith,
      suggested: !isPd || note === null,
      note,
    }
  })
}

// --- Привязка по отмеченным ----------------------------------------------

export interface OrgUnit {
  readonly code: string
  readonly externalId: string
  readonly type: 'ПЧУ' | 'ПД'
  /** Для ПД — код ПЧУ; для ПЧУ — null (подчиняется дистанции). */
  readonly parent: string | null
}

/** Подразделение вне иерархии ПЧУ → ПД: цех, бригада, диагностика. */
export interface OtherUnit {
  readonly code: string
  readonly externalId: string
  readonly type: string
  readonly activity: string | null
}

export interface OrgStructure {
  readonly date: string
  readonly units: readonly OrgUnit[]
  readonly otherUnits: readonly OtherUnit[]
  /** Границы отмеченных ПД и прочих подразделений на дату. */
  readonly boundaries: readonly ImportedBoundary[]
  /** Станция → ПД: только отмеченные ПД. */
  readonly stations: ReadonlyMap<string, string>
  readonly tracks: readonly ImportedTrackPd[]
  readonly remarks: readonly ImportRemark[]
}

export interface OrgSources {
  readonly subdivisions: readonly ImportedSubdivision[]
  readonly boundaries: readonly ImportedBoundary[]
  readonly stationPd: readonly ImportedStationPd[]
  readonly trackPd: readonly ImportedTrackPd[]
}

function hierarchy(
  open: readonly ImportedSubdivision[],
  selected: ReadonlySet<string>,
  remarks: ImportRemark[],
): OrgUnit[] {
  const pds = open.filter((s) => s.type === 'ПД' && selected.has(s.code))
  const pchus = open.filter((s) => s.type === 'ПЧУ')
  const units: OrgUnit[] = []
  const parentOf = (pd: ImportedSubdivision): ImportedSubdivision | undefined =>
    pd.parent?.type === 'ПЧУ' ? pchus.find((u) => u.number === pd.parent?.number) : undefined
  for (const pchu of pchus) {
    if (!pds.some((p) => parentOf(p) === pchu) && !selected.has(pchu.code)) continue
    units.push({ code: pchu.code, externalId: pchu.externalId, type: 'ПЧУ', parent: null })
  }
  for (const pd of pds) {
    const parent = parentOf(pd)
    if (!parent) {
      remarks.push({
        text: `${pd.code} подчиняется «${pd.parent?.text ?? 'предприятию'}», а такого ПЧУ на дату редакции нет`,
        at: pd.at,
      })
    }
    units.push({
      code: pd.code,
      externalId: pd.externalId,
      type: 'ПД',
      parent: parent?.code ?? null,
    })
  }
  return units
}

function overlapRemarks(
  segments: readonly ImportedBoundary[],
  pds: ReadonlySet<string>,
): ImportRemark[] {
  const remarks: ImportRemark[] = []
  const own = segments.filter((b) => pds.has(b.subdivision))
  own.forEach((a, i) => {
    for (const b of own.slice(i + 1)) {
      if (a.subdivision === b.subdivision) continue
      const o = overlap(a, b)
      if (o) {
        remarks.push({
          text: `Границы ${a.subdivision} и ${b.subdivision} перекрываются на «${a.line}» ${fmt(o[0])} – ${fmt(o[1])}`,
          at: b.at,
        })
      }
    }
  })
  return remarks
}

function stationBinding(
  rows: readonly ImportedStationPd[],
  pds: ReadonlySet<string>,
  date: string,
  remarks: ImportRemark[],
): Map<string, string> {
  const valid = rows.filter((r) => validOn(r.validity, date))
  const stations = [...new Set(valid.map((r) => r.station))]
  const out = new Map<string, string>()
  for (const station of stations) {
    const candidates = valid.filter((r) => r.station === station && pds.has(r.subdivision))
    const codes = [...new Set(candidates.map((r) => r.subdivision))]
    const [only] = codes
    if (codes.length === 1 && only) out.set(station, only)
    else if (codes.length === 0) {
      remarks.push(
        remark(
          `Станция ${station} не привязана ни к одному отмеченному ПД`,
          valid.find((r) => r.station === station)?.at,
        ),
      )
    } else {
      remarks.push(
        remark(`Станция ${station} привязана сразу к ${codes.join(', ')}`, candidates[1]?.at),
      )
    }
  }
  return out
}

function trackBinding(
  rows: readonly ImportedTrackPd[],
  pds: ReadonlySet<string>,
  date: string,
  remarks: ImportRemark[],
): ImportedTrackPd[] {
  const valid = rows.filter((r) => validOn(r.validity, date) && pds.has(r.subdivision))
  for (const r of valid) {
    if (r.meters && r.meters.end < r.meters.start) {
      remarks.push({
        text: `Путь «${r.track}» станции ${r.station}: метр конца ${r.meters.end} меньше метра начала ${r.meters.start}`,
        at: r.at,
      })
    }
  }
  return valid
}

/**
 * Оргструктура редакции по отмеченным действующим подразделениям (раздел 6.1):
 * иерархия ПЧУ → ПД, границы на дату, станции и пути отмеченных ПД, замечания.
 * Ничего не исправляется: перекрытия, «лишние» станции и пути становятся замечаниями.
 */
export function buildOrgStructure(
  sources: OrgSources,
  date: string,
  selected: ReadonlySet<string>,
): OrgStructure {
  const remarks: ImportRemark[] = []
  const open = sources.subdivisions.filter((s) => validOn(s.validity, date))
  const units = hierarchy(open, selected, remarks)
  const pds = new Set(units.filter((u) => u.type === 'ПД').map((u) => u.code))
  const otherUnits = open
    .filter((s) => !HIERARCHY_TYPES.has(s.type))
    .map((s) => ({ code: s.code, externalId: s.externalId, type: s.type, activity: s.activity }))
  // Границы всех подразделений оргструктуры: ПЧУ и ПД иерархии и прочих (цеха, бригады).
  const kept = new Set([...units.map((u) => u.code), ...otherUnits.map((u) => u.code)])
  const boundaries = sources.boundaries.filter(
    (b) => validOn(b.validity, date) && kept.has(b.subdivision),
  )
  for (const b of boundaries) {
    if (cmp(b.from, b.to) >= 0)
      remarks.push({
        text: `Граница ${b.subdivision}: конец ${fmt(b.to)} не дальше начала ${fmt(b.from)}`,
        at: b.at,
      })
  }
  remarks.push(...overlapRemarks(boundaries, pds))
  for (const code of pds) {
    if (!boundaries.some((b) => b.subdivision === code))
      remarks.push({ text: `У ${code} нет границ на дату редакции` })
  }
  const stations = stationBinding(sources.stationPd, pds, date, remarks)
  const tracks = trackBinding(sources.trackPd, pds, date, remarks)
  return { date, units, otherUnits, boundaries, stations, tracks, remarks }
}
