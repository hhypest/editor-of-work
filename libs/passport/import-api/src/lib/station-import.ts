import type { Chainage, Result } from '@eow/shared/kernel'
import type { OrgImportError, OrgImportFile, OrgImportRemark, OrgImportRow } from './org-import'

export const STATION_FORMS = [
  'station-axes',
  'station-tracks',
  'switches',
  'crossings-general',
  'crossings-technical',
  'crossings-operational',
  'okato',
] as const
export type StationForm = (typeof STATION_FORMS)[number]
export interface StationImportFile extends Omit<OrgImportFile, 'form'> {
  readonly form: StationForm
}

export interface StationAxisValues {
  readonly station: string
  readonly line: string
  readonly axis: Chainage
  /** Границы станции; у остановочных пунктов без стрелок их в выгрузке нет. */
  readonly from: Chainage | null
  readonly to: Chainage | null
  /** Номера крайних стрелок: «Стрелочный перевод № 1, на станции …» → «1». */
  readonly firstSwitch: string | null
  readonly lastSwitch: string | null
  readonly trackSection: string | null
}

export interface StationTrackValues {
  readonly station: string
  readonly purpose: string
  readonly park: string | null
  readonly number: string
  /** Граница пути «от / через / до»: номера стрелок или «упор». */
  readonly from: string | null
  readonly via: readonly string[]
  readonly to: string | null
  readonly fullLength: number | null
  readonly usefulLength: number | null
  /** Тип рельсов с наибольшей длиной на пути. */
  readonly railType: string | null
  readonly ballastType: string | null
  readonly sleeperType: string | null
  /** Последний ремонт капитального характера: год и вид (КРс, КРн). */
  readonly lastRepairYear: number | null
  readonly lastRepairKind: string | null
  readonly classCode: string | null
}

export interface StationSwitchValues {
  readonly station: string
  readonly number: string
  readonly park: string | null
  readonly purpose: string | null
  /** Путь, как он назван в отчёте: главный путь или «Путь … № 3 на станции …». */
  readonly track: string | null
  readonly side: string | null
  readonly laidDate: string | null
  readonly control: string | null
  readonly railType: string | null
  readonly frogMark: string | null
  readonly frogKind: string | null
  /** Число крестовин: у глухих пересечений и перекрёстных переводов их несколько. */
  readonly frogs: number
  readonly sleeperType: string | null
}

export interface CrossingValues {
  readonly title: string
  readonly number: string
  readonly name: string | null
  /** Направление из книги: «СЕВЕРНАЯ-ЮЖНАЯ». */
  readonly direction: string | null
  /** Станция из столбца «Станция»: у переездов на главных путях там «-». */
  readonly stationColumn: string | null
  readonly titleStation: string | null
  readonly place: CrossingPlaceValues | null
  readonly category: string | null
  readonly type: string | null
  readonly region: string | null
  readonly district: string | null
  readonly city: string | null
  readonly road: string | null
  readonly regulated: boolean | null
  readonly signalling: string | null
  readonly surface: string | null
  readonly barriers: string | null
  readonly trainsPerDay: number | null
  readonly vehiclesPerDay: number | null
  /** Наибольшая из максимальных скоростей поездов. */
  readonly trainSpeed: number | null
  readonly lastOverhaul: string | null
  /** Все совпавшие главные пути; неоднозначность не выбирается по порядку. */
  readonly lines: readonly string[]
}

export interface TerritoryValues {
  readonly name: string
  readonly type: string
  readonly parent: string | null
  readonly parentType: string | null
}

export interface CrossingPlaceValues {
  readonly km: number
  readonly pk: number
  /** Подъездной путь, на котором стоит переезд («ш.Горняк»); null — главный путь. */
  readonly siding: string | null
}

export type StationRow =
  | (OrgImportRow & { readonly form: 'station-axes'; readonly values: StationAxisValues })
  | (OrgImportRow & { readonly form: 'station-tracks'; readonly values: StationTrackValues })
  | (OrgImportRow & { readonly form: 'switches'; readonly values: StationSwitchValues })
  | (OrgImportRow & { readonly form: 'crossings-general'; readonly values: CrossingValues })
  | (OrgImportRow & { readonly form: 'okato'; readonly values: TerritoryValues })

export interface StationExclusion {
  readonly name: string
  readonly reason: string
}
export interface StationBasis {
  readonly token: string
  readonly date: string
  readonly lines: readonly {
    readonly id: string
    readonly name: string
    readonly kmLengths: readonly (readonly [number, number])[]
  }[]
  readonly stations: readonly { readonly id: string; readonly name: string }[]
  readonly tracks: readonly {
    readonly id: string
    readonly stationId: string
    readonly number: string
  }[]
  readonly excludedStations: readonly StationExclusion[]
}
export interface StationImport {
  readonly date: string
  readonly basisToken: string
  /** Все части семи форм: станции, экспликации, три книги переездов, ОКАТО. */
  readonly files: readonly StationImportFile[]
  readonly rows: readonly StationRow[]
}
export interface StationPreview {
  readonly command: StationImport
  readonly remarks: readonly OrgImportRemark[]
  readonly exclusionCandidates: readonly string[]
}
export interface PassportStationImport {
  stationBasis(editionId: number): Promise<Result<StationBasis, OrgImportError>>
  applyStationImport(editionId: number, input: StationImport): Promise<Result<void, OrgImportError>>
  stationImportReport(
    editionId: number,
  ): Promise<Result<readonly StationImportFile[], OrgImportError>>
  stationData(editionId: number): Promise<Result<readonly StationRow[], OrgImportError>>
  setStationExclusions(
    editionId: number,
    exclusions: readonly StationExclusion[],
  ): Promise<Result<void, OrgImportError>>
}
