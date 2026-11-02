import type { Result } from '@eow/shared/kernel'
import type { OrgImportError, OrgImportRemark } from './org-import'
import type { StationLayout } from './station-layout'

/** Значение `import_file.form` у PDF схемы станции. */
export const STATION_SCHEME_FORM = 'station-scheme'

/** Что импорту нужно знать о редакции, чтобы свести схемы с экспликациями. */
export interface StationSchemeBasis {
  readonly token: string
  readonly stations: readonly { readonly id: string; readonly name: string }[]
  readonly tracks: readonly {
    readonly stationId: string
    readonly number: string
    readonly fullLength: number | null
  }[]
  readonly switches: readonly { readonly stationId: string; readonly number: string }[]
  /** Станции, у которых раскладка уже есть: импорт заменит её. */
  readonly layouts: readonly string[]
}

export interface StationSchemeFile {
  readonly id: string
  readonly name: string
  readonly sha256: string
  readonly importedAt: string
  readonly warnings: readonly OrgImportRemark[]
}

/** Раскладки выбранных станций; раскладки остальных станций не меняются. */
export interface StationSchemeImport {
  /** Срез, который видел пользователь перед подтверждением; проверяется внутри записи. */
  readonly expectedEditionToken?: string | undefined
  readonly basisToken: string
  readonly files: readonly StationSchemeFile[]
  readonly layouts: readonly {
    readonly stationId: string
    readonly importFileId: string
    readonly layout: StationLayout
  }[]
}

export interface StationSchemePreview {
  readonly command: StationSchemeImport
  readonly remarks: readonly OrgImportRemark[]
  /** Сколько уже записанных раскладок будет заменено. */
  readonly replaced: number
}

export interface PassportStationSchemeImport {
  stationSchemeBasis(editionId: number): Promise<Result<StationSchemeBasis, OrgImportError>>
  applyStationSchemeImport(
    editionId: number,
    input: StationSchemeImport,
  ): Promise<Result<void, OrgImportError>>
}
