/**
 * Раскладка путевого развития станции на сетке, версия 1 (ADR-0046): общий формат паспорта,
 * редактора станций и среза годового плана. Ряд — междупутье, колонка — половина междупутья.
 * Пути и съезды — ломаные по узлам слева направо; стрелка — узел на пути, от которого
 * отходит ветвь. Остряки, мосты и переезды привязаны к колонкам, поэтому лежат на своих путях.
 */
export interface Cell {
  readonly col: number
  readonly row: number
}

export type LayoutNodeKind = 'switch' | 'end' | 'bend' | 'crossing'
export type LayoutTrackKind = 'main' | 'station' | 'connector' | 'siding'
export type LayoutTrackState = 'normal' | 'closed' | 'conserved'

export interface LayoutNode extends Cell {
  readonly id: string
  readonly kind: LayoutNodeKind
  /** У конца пути: упор или выход за пределы схемы. */
  readonly end?: 'stop' | 'open' | undefined
}

export interface LayoutTrack {
  readonly id: string
  /** Номер как на схеме; null — съезд или путь без номера. */
  readonly number: string | null
  readonly kind: LayoutTrackKind
  readonly state: LayoutTrackState
  /** Узлы слева направо. */
  readonly nodes: readonly string[]
  /** Полная длина и вместимость — подписи схемы, а не экспликация. */
  readonly fullLength: number | null
  readonly capacity: string | null
}

export interface LayoutSwitch {
  readonly id: string
  readonly number: string | null
  readonly node: string
  /** Путь, по которому проходит прямое направление: на нём лежит стрелка. */
  readonly track: string
  /** Путь или съезд, который начинается или заканчивается в узле стрелки. */
  readonly branch: string
}

export interface LayoutDerailer {
  readonly id: string
  readonly number: string
  readonly track: string
  readonly col: number
}

export interface LayoutBridge {
  readonly id: string
  readonly label: string | null
  readonly track: string
  readonly fromCol: number
  readonly toCol: number
}

export interface LayoutCrossing {
  readonly id: string
  /** Подпись схемы: «переезд 51км». */
  readonly label: string
  readonly km: number | null
  readonly pk: number | null
  readonly col: number
  readonly fromRow: number
  readonly toRow: number
}

export interface StationLayout {
  readonly version: 1
  readonly nodes: readonly LayoutNode[]
  readonly tracks: readonly LayoutTrack[]
  readonly switches: readonly LayoutSwitch[]
  readonly derailers: readonly LayoutDerailer[]
  readonly bridges: readonly LayoutBridge[]
  readonly crossings: readonly LayoutCrossing[]
}
