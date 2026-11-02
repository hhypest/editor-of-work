import {
  canRedo,
  canUndo,
  commit,
  endGroup,
  historyOf,
  redo,
  undo,
  type History,
  type Result,
} from '@eow/shared/kernel'
import {
  moveNode,
  renumberSwitch,
  renumberTrack,
  type Cell,
  type StationLayout,
} from '@eow/stations/domain'

export type {
  StationLayout,
  Cell,
  LayoutNode,
  LayoutTrack,
  LayoutSwitch,
  LayoutNodeKind,
  LayoutTrackKind,
  LayoutTrackState,
} from '@eow/stations/domain'

/** Редакция паспорта в выборе редактора: контекст станций не видит домен паспорта. */
export interface StationEdition {
  readonly id: number
  readonly number: number
  readonly date: string
  readonly label: string
  readonly status: 'draft' | 'active' | 'archived'
}

/** Станция редакции в списке редактора. */
export interface StationEntry {
  readonly id: string
  readonly name: string
  readonly hasLayout: boolean
}

/** Раскладка станции, как её отдал паспорт. */
export interface LoadedLayout {
  readonly layout: StationLayout
  /** Версия записи: запись с устаревшей версией отклоняется, чтобы не затереть чужую правку. */
  readonly version: string
  /** Править можно только черновик редакции. */
  readonly editable: boolean
}

export interface StationLayoutError {
  readonly message: string
}

/** Порт чтения и записи раскладок; реализация — IPC к паспорту в main. */
export interface StationLayoutClient {
  stations(editionId: number): Promise<Result<readonly StationEntry[], StationLayoutError>>
  load(
    editionId: number,
    stationId: string,
  ): Promise<Result<LoadedLayout | null, StationLayoutError>>
  save(
    editionId: number,
    stationId: string,
    layout: StationLayout,
    version: string,
  ): Promise<Result<{ readonly version: string }, StationLayoutError>>
}

export type EditorAction =
  /** `drag` — ключ перетаскивания: все сдвиги одного перетаскивания — один шаг отмены. */
  | { readonly kind: 'move'; readonly node: string; readonly to: Cell; readonly drag?: string }
  | { readonly kind: 'end-drag' }
  | { readonly kind: 'renumber-track'; readonly track: string; readonly number: string | null }
  | { readonly kind: 'renumber-switch'; readonly switchId: string; readonly number: string | null }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }

export interface EditorState {
  readonly history: History<StationLayout>
  /** Последняя отклонённая правка; следующая удачная правка её сбрасывает. */
  readonly error: string | null
}

export const openEditor = (layout: StationLayout): EditorState => ({
  history: historyOf(layout),
  error: null,
})

export const canUndoEdit = (s: EditorState): boolean => canUndo(s.history)
export const canRedoEdit = (s: EditorState): boolean => canRedo(s.history)

/** Одна правка пользователя: новое состояние истории или текст, почему правка отклонена. */
export function applyEdit(state: EditorState, action: EditorAction): EditorState {
  const present = state.history.present
  const apply = (
    result: Result<StationLayout, { readonly message: string }>,
    group?: string,
  ): EditorState =>
    result.ok
      ? {
          history: commit(state.history, result.value, group === undefined ? {} : { group }),
          error: null,
        }
      : { ...state, error: result.error.message }
  switch (action.kind) {
    case 'move':
      return apply(moveNode(present, action.node, action.to), action.drag)
    case 'end-drag':
      return { ...state, history: endGroup(state.history) }
    case 'renumber-track':
      return apply(renumberTrack(present, action.track, action.number))
    case 'renumber-switch':
      return apply(renumberSwitch(present, action.switchId, action.number))
    case 'undo':
      return { history: undo(endGroup(state.history)), error: null }
    case 'redo':
      return { history: redo(state.history), error: null }
  }
}
