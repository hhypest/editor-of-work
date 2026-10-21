import type { Result } from '@eow/shared/kernel'
import type { ManualBasis, ManualData, ManualIssue, ManualImport } from '@eow/passport/import-api'
export interface ManualTemplateContent {
  readonly date: string
  readonly basisToken: string
  readonly data: ManualData
  readonly sourceRows: Readonly<Record<keyof ManualData, readonly number[]>>
}
export interface ManualDataTemplate {
  write(basis: ManualBasis): Promise<Result<Uint8Array, readonly ManualIssue[]>>
  read(bytes: Uint8Array): Promise<Result<ManualTemplateContent, readonly ManualIssue[]>>
}
export interface ManualTemplatePreview {
  readonly command: ManualImport
  readonly changes: readonly {
    readonly sheet: string
    readonly added: number
    readonly changed: number
    readonly removed: number
  }[]
}
