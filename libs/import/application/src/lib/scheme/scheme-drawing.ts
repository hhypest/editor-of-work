/**
 * Векторное содержимое листа схемы станции, как его прочитала инфраструктура из PDF.
 * Координаты — пункты листа (1/72 дюйма), начало в левом верхнем углу, ось y вниз.
 * Это сырые данные формата: смысл (путь, стрелка, переезд) им придаёт распознавание.
 */
export interface DrawingPoint {
  readonly x: number
  readonly y: number
}

/** Цвет RGB, каждая составляющая 0…1. */
export type DrawingColor = readonly [number, number, number]

export interface DrawingPath {
  /** Подпути: у отрезка две точки, у ломаной больше; замкнутые подпути повторяют первую точку. */
  readonly subpaths: readonly (readonly DrawingPoint[])[]
  /** Цвет обводки; null — путь только заливается. */
  readonly stroke: DrawingColor | null
  /** Цвет заливки; null — путь только обводится. */
  readonly fill: DrawingColor | null
  /** Толщина линии в пунктах листа. */
  readonly width: number
  /** Штрих-пунктир в пунктах листа; пустой — сплошная линия. */
  readonly dash: readonly number[]
}

export interface DrawingText {
  readonly text: string
  /** Начало базовой линии первого знака. */
  readonly origin: DrawingPoint
  /** Направление строки в радианах: 0 — слева направо, −π/2 — снизу вверх. */
  readonly angle: number
  /** Кегль в пунктах листа. */
  readonly size: number
  /** Длина строки вдоль направления, в пунктах листа. */
  readonly width: number
  readonly color: DrawingColor
}

export interface SchemeDrawing {
  readonly width: number
  readonly height: number
  readonly paths: readonly DrawingPath[]
  readonly texts: readonly DrawingText[]
}
