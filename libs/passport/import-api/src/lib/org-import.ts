import type { Result } from '@eow/shared/kernel'

/** Опубликованная ошибка сценария, независимая от объектов домена Паспорта. */
export interface OrgImportError {
  readonly kind: 'invalid-edition' | 'invalid-import' | 'not-found' | 'immutable' | 'storage'
  readonly message: string
}

export const ORG_FORMS = ['subdivisions', 'boundaries', 'station-pd', 'track-pd'] as const
export type OrgForm = (typeof ORG_FORMS)[number]

export interface OrgImportRemark {
  readonly text: string
  readonly at?:
    | {
        readonly file: string
        readonly sheet: string
        readonly row?: number | undefined
        readonly column?: string | undefined
        readonly header?: string | undefined
      }
    | undefined
}

export interface OrgImportFile {
  readonly id: string
  readonly name: string
  readonly form: OrgForm
  /** SHA-256 файла; для frameset — пакета оболочки и потреблённых частей. */
  readonly sha256: string
  readonly importedAt: string
  /** Все прочитанные строки, включая отсеянные по периоду. */
  readonly rowCount: number
  readonly warnings: readonly OrgImportRemark[]
}

export interface OrgImportRow {
  readonly id: string
  readonly importFileId: string
  readonly validFrom: string | null
  readonly validTo: string
}

export interface OrgImportSubdivision extends OrgImportRow {
  readonly code: string
  readonly type: string
  readonly parentId: string | null
  readonly activity: string | null
  readonly active: boolean
}

export interface OrgImportBoundary extends OrgImportRow {
  readonly line: string
  /** Длина из выгрузки; сверка с координатами выполняется отдельно (#17). */
  readonly statedLength: number | null
  readonly subdivisionId: string
  readonly from: { readonly km: number; readonly m: number }
  readonly to: { readonly km: number; readonly m: number }
}

export interface OrgImportStation extends OrgImportRow {
  readonly station: string
  readonly subdivisionId: string
}

export interface OrgImportTrack extends OrgImportStation {
  readonly track: string
  readonly meters: { readonly start: number; readonly end: number } | null
}

/** Полная замена четырёх форм оргструктуры; части выгрузок передаются вместе. */
export interface OrgImport {
  readonly date: string
  readonly files: readonly OrgImportFile[]
  readonly subdivisions: readonly OrgImportSubdivision[]
  readonly boundaries: readonly OrgImportBoundary[]
  readonly stations: readonly OrgImportStation[]
  readonly tracks: readonly OrgImportTrack[]
}

/** Опубликованный сценарий Паспорта: Импорт не получает доступа к таблицам БД. */
export interface PassportOrgImport {
  applyOrgImport(editionId: number, input: OrgImport): Promise<Result<void, OrgImportError>>
  orgImportReport(editionId: number): Promise<Result<readonly OrgImportFile[], OrgImportError>>
}
