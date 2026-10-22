/** DTO редактора. UI не получает доменные объекты и пути файлов. */
export interface EditorDraft {
  readonly kind: string
  readonly mode: 'line' | 'station'
  readonly line: string
  readonly text: string
  readonly station: string
  readonly objectKind: 'none' | 'track' | 'switch'
  readonly objectNumber: string
  readonly volume: string
  readonly note: string
  readonly callout: boolean
}
export interface EditorIssue {
  readonly field: 'place' | 'volume' | 'form'
  readonly message: string
  readonly start: number | null
  readonly end: number | null
}
export type EditorChange =
  | {
      readonly kind: 'manualRows'
      readonly rows: readonly {
        readonly code: string
        readonly plan: string
        readonly need: string
      }[]
    }
  | { readonly kind: 'add'; readonly draft: EditorDraft }
  | { readonly kind: 'edit'; readonly id: string; readonly draft: EditorDraft }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | {
      readonly kind: 'manual'
      readonly code: string
      readonly field: 'overrides' | 'needs'
      readonly value: string
    }
  | {
      readonly kind: 'approval'
      readonly title: string
      readonly name: string
      readonly year: number
    }
export type EditorAction =
  | EditorChange
  | { readonly kind: 'state' }
  | { readonly kind: 'open' }
  | {
      readonly kind: 'import'
      readonly edition: { readonly number: string; readonly date: string }
    }
  | { readonly kind: 'save'; readonly saveAs: boolean }
  | { readonly kind: 'recover'; readonly accept: boolean }
  | { readonly kind: 'checkPlace'; readonly line: string; readonly text: string }
export interface EditorView {
  readonly year: number
  readonly edition: { readonly number: string; readonly date: string }
  readonly approval: { readonly title: string; readonly name: string; readonly year: number }
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly lines: readonly { readonly id: string; readonly name: string }[]
  readonly stations: readonly {
    readonly id: string
    readonly name: string
    readonly tracks: readonly string[]
    readonly switches: readonly string[]
  }[]
  readonly kinds: readonly { readonly code: string; readonly name: string; readonly unit: string }[]
  readonly areas: readonly { readonly key: string; readonly label: string }[]
  readonly area: string
  readonly works: readonly {
    readonly id: string
    readonly name: string
    readonly place: string
    readonly volume: number
    readonly unit: string
    readonly draft: EditorDraft
  }[]
  readonly tables: readonly {
    readonly title: string
    readonly rows: readonly {
      readonly code: string
      readonly name: string
      readonly unit: string
      readonly computed: number
      readonly value: number
      readonly manual: boolean
      readonly need: number | null
    }[]
  }[]
  readonly importReport: readonly { readonly path: string; readonly message: string }[]
}
export interface EditorState {
  readonly revision: number
  readonly dirty: boolean
  readonly hasFile: boolean
  readonly hasRecovery: boolean
  readonly autosaveError: string | null
  readonly view: EditorView | null
}
export interface PlaceHint {
  readonly normalized: string | null
  readonly meters: number | null
  readonly issues: readonly EditorIssue[]
}
export type EditorReply =
  | { readonly kind: 'state'; readonly state: EditorState }
  | { readonly kind: 'place'; readonly revision: number; readonly hint: PlaceHint }
  | { readonly kind: 'invalid'; readonly issues: readonly EditorIssue[] }
  | { readonly kind: 'cancelled' }
export interface PlanEditorClient {
  send(action: EditorAction, revision: number, area: string): Promise<EditorReply>
}
