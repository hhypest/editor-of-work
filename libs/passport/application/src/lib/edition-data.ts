import type { PassportEdition, PassportError } from '@eow/passport/domain'
import type { ManualData, OrgData, SegmentRow, StationRow } from '@eow/passport/import-api'
import type { Chainage, Result } from '@eow/shared/kernel'

/** Направление редакции с протяжением и длинами нестандартных километров. */
export interface EditionLine {
  readonly id: string
  readonly name: string
  readonly extents: readonly { readonly from: Chainage; readonly to: Chainage }[]
  readonly kmLengths: readonly (readonly [number, number])[]
}

/**
 * Полный срез данных редакции для просмотра и сравнения.
 * Читается одной транзакцией, чтобы разделы не расходились (как в ADR-0014).
 */
export interface EditionData {
  readonly edition: PassportEdition
  readonly lines: readonly EditionLine[]
  readonly segments: readonly SegmentRow[]
  readonly stations: readonly StationRow[]
  readonly manual: ManualData
  readonly org: OrgData
}

/** Порт чтения данных редакции: реализация — в инфраструктуре (SQLite в main). */
export interface PassportEditionData {
  editionData(editionId: number): Promise<Result<EditionData, PassportError>>
}

/** Действующие на дату редакции объекты для создания годового плана. */
export interface PlanningEditionData extends Pick<
  EditionData,
  'edition' | 'lines' | 'org' | 'manual'
> {
  readonly stations: readonly {
    readonly id: string
    readonly name: string
    readonly tracks: readonly string[]
    readonly switches: readonly string[]
  }[]
}
export interface PassportPlanningSource {
  planningData(editionId: number): Promise<Result<PlanningEditionData, PassportError>>
}
