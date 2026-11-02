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

export type LayoutObjectKind = 'building' | 'platform'

/**
 * Объект схемы, который составитель ставит вручную (ADR-0049): здание или платформа.
 * Прямоугольник занимает колонки col…col + width и ряды row…row + height − 1;
 * повторный импорт PDF схемы его сохраняет.
 */
export interface LayoutObject {
  readonly id: string
  readonly kind: LayoutObjectKind
  readonly label: string
  readonly col: number
  readonly row: number
  readonly width: number
  readonly height: number
}

export interface StationLayout {
  readonly version: 1
  readonly nodes: readonly LayoutNode[]
  readonly tracks: readonly LayoutTrack[]
  readonly switches: readonly LayoutSwitch[]
  readonly derailers: readonly LayoutDerailer[]
  readonly bridges: readonly LayoutBridge[]
  readonly crossings: readonly LayoutCrossing[]
  /** Здания и платформы; поле появилось в #30, его отсутствие — объектов нет. */
  readonly objects?: readonly LayoutObject[] | undefined
}

/** Пределы объекта схемы: ширина в колонках, высота в рядах, длина подписи. */
export const LAYOUT_OBJECT_LIMITS = { width: 400, height: 20, label: 200 } as const

/** «IIСев», «8СО», «3 ав» — номер без регистра и пробелов; кириллическая «І» как латинская. */
export const layoutNumberKey = (value: string): string =>
  value.toUpperCase().replaceAll('І', 'I').replaceAll('Ё', 'Е').replace(/\s+/gu, '')

/** Суффиксы номера стрелки, которые не меняют стрелку: автовозврат, «р», «п» (ADR-0046). */
export const IGNORED_SWITCH_SUFFIXES = ['ав', 'р', 'п'] as const

/**
 * Номер стрелки для сверки паспорта, схемы и плана: «15р», «13 ав» и «15» — одна стрелка,
 * «8со ав» и «8рсо» — остряк «8со», прочие буквы («1а») остаются частью номера.
 */
export function layoutSwitchKey(value: string): string {
  const match = /^(\d+)([а-яё\s]*)$/iu.exec(value.trim())
  const digits = match?.[1]
  if (!digits) return layoutNumberKey(value)
  let rest = (match[2] ?? '').toLowerCase().replace(/\s+/gu, '')
  if (/^р?со(?:ав)?$/u.test(rest)) return layoutNumberKey(`${digits}со`)
  for (let changed = true; changed;) {
    changed = false
    for (const suffix of IGNORED_SWITCH_SUFFIXES)
      if (rest.endsWith(suffix)) {
        rest = rest.slice(0, -suffix.length)
        changed = true
      }
  }
  return /^[а-яё]{0,2}$/u.test(rest) ? layoutNumberKey(digits + rest) : layoutNumberKey(value)
}
