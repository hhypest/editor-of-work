import type { Result } from '@eow/shared/kernel'
import type { OrgImportError } from './org-import'
import type { StationLayout } from './station-layout'

/** Станция редакции и есть ли у неё раскладка. */
export interface StationLayoutEntry {
  readonly id: string
  readonly name: string
  readonly hasLayout: boolean
}

export interface StoredStationLayout {
  readonly layout: StationLayout
  /** Версия записи: SHA-256 сохранённого JSON. */
  readonly version: string
  /** Раскладку можно править только в черновике редакции. */
  readonly editable: boolean
}

/** Чтение и правка раскладок путевого развития станций (редактор станций, #29). */
export interface PassportStationLayouts {
  stationLayoutList(
    editionId: number,
  ): Promise<Result<readonly StationLayoutEntry[], OrgImportError>>
  stationLayout(
    editionId: number,
    stationId: string,
  ): Promise<Result<StoredStationLayout | null, OrgImportError>>
  /** Запись с устаревшей версией отклоняется: правку из другого окна не затираем молча. */
  saveStationLayout(
    editionId: number,
    stationId: string,
    layout: StationLayout,
    version: string,
  ): Promise<Result<{ readonly version: string }, OrgImportError>>
}
