import type { Chainage, Result } from '@eow/shared/kernel'
import type { OrgImportError, OrgImportFile, OrgImportRemark, OrgImportRow } from './org-import'

export const SEGMENT_FORMS = ['class', 'load', 'speeds', 'rails', 'sleepers', 'ballast'] as const
export type SegmentForm = (typeof SEGMENT_FORMS)[number]
export interface SegmentImportFile extends Omit<OrgImportFile, 'form'> {
  readonly form: SegmentForm
}
export interface SegmentBase extends OrgImportRow {
  readonly lineId: string
  readonly from: Chainage
  readonly to: Chainage
  readonly statedLength: number | null
}

export interface ClassValues {
  readonly trackClass: string | null
  readonly group: string | null
  readonly category: string | null
}

export interface LoadValues {
  readonly grossMillionTonKm: number | null
  readonly axleLoad: number | null
}

export interface SpeedsValues {
  readonly passenger: number | null
  readonly freight: number | null
  readonly suburban: number | null
  readonly empty: number | null
  readonly express: number | null
  readonly highSpeed: number | null
  readonly restrictionReason: string | null
}

export interface RailsValues {
  readonly railType: string | null
  readonly layingSign: string | null
  readonly linkLength: string | null
  readonly hardening: string | null
  readonly purpose: string | null
  readonly plant: string | null
  readonly railClass: string | null
  readonly railGroup: string | null
  readonly laidDate: string | null
  readonly reducedWear: string | null
  readonly sideWear: number | null
  readonly waveWear: string | null
  readonly tonnageBefore: number | null
  readonly tonnageAfter: number | null
}

export interface SleepersValues {
  readonly structure: string | null
  readonly baseType: string | null
  readonly sleeperType: string | null
  readonly density: number | null
  readonly manufactureYear: number | null
  readonly fasteningType: string | null
  readonly fasteningDefective: number | null
  readonly laidFlag: string | null
  readonly padType: string | null
  readonly trackSection: string | null
  readonly upperAbsorberDate: string | null
  readonly upperRepair: string | null
  readonly upperPlant: string | null
  readonly upperDefective: number | null
  readonly lowerAbsorberDate: string | null
  readonly lowerRepair: string | null
  readonly lowerPlant: string | null
  readonly lowerDefective: number | null
  readonly secondarySleeperType: string | null
  readonly tonnageBefore: number | null
  readonly tonnageAfter: number | null
  readonly tonnage: number | null
  readonly sidingFlag: string | null
}

export interface BallastValues {
  readonly ballastType: string | null
  readonly thickness: string | null
  readonly contamination: string | null
  readonly separatingLayer: string | null
  readonly geogridType: string | null
  readonly geogridHeight: string | null
  readonly protectiveThickness: number | null
  readonly protectiveType: string | null
  readonly prismShortageRight: number | null
  readonly prismShortageLeft: number | null
  readonly shoulderShortageRight: number | null
  readonly shoulderShortageLeft: number | null
  readonly monolithicFlag: string | null
  readonly monolithicType: string | null
}

export type SegmentRow =
  | (SegmentBase & { readonly form: 'class'; readonly values: ClassValues })
  | (SegmentBase & { readonly form: 'load'; readonly values: LoadValues })
  | (SegmentBase & { readonly form: 'speeds'; readonly values: SpeedsValues })
  | (SegmentBase & { readonly form: 'rails'; readonly values: RailsValues })
  | (SegmentBase & { readonly form: 'sleepers'; readonly values: SleepersValues })
  | (SegmentBase & { readonly form: 'ballast'; readonly values: BallastValues })

/** Контекст сверки: только данные выбранной редакции; токен защищает от устаревшего предпросмотра. */
export interface SegmentBasis {
  readonly token: string
  readonly date: string
  readonly lines: readonly {
    readonly id: string
    readonly name: string
    readonly kmLengths: readonly (readonly [number, number])[]
  }[]
  readonly boundaries: readonly {
    readonly lineId: string
    readonly subdivisionCode: string
    readonly from: Chainage
    readonly to: Chainage
    readonly statedLength: number | null
  }[]
}
export interface SegmentImport {
  readonly date: string
  readonly basisToken: string
  /** Полный набор частей каждой переданной формы. Остальные формы не изменяются. */
  readonly files: readonly SegmentImportFile[]
  readonly rows: readonly SegmentRow[]
}
export interface SegmentPreview {
  readonly command: SegmentImport
  readonly remarks: readonly OrgImportRemark[]
}
export interface PassportSegmentImport {
  segmentBasis(editionId: number): Promise<Result<SegmentBasis, OrgImportError>>
  applySegmentImport(editionId: number, input: SegmentImport): Promise<Result<void, OrgImportError>>
  segmentImportReport(
    editionId: number,
  ): Promise<Result<readonly SegmentImportFile[], OrgImportError>>
  segmentData(editionId: number): Promise<Result<readonly SegmentRow[], OrgImportError>>
}
