import type { AdmDivisionSource } from './adm-division'
import type { Chainage, Result } from '@eow/shared/kernel'

/** Миллиметры листа отделены от метров пути и CSS-пикселей. */
export interface SheetMm {
  readonly unit: 'mm'
  readonly value: number
}
export const mm = (value: number): SheetMm => ({ unit: 'mm', value })
export type SheetFamily = 'PT Sans' | 'PT Sans Narrow'
export interface SheetFont {
  readonly family: SheetFamily
  readonly size: SheetMm
  readonly weight: 400 | 700
}
export interface TextMeasurer {
  width(text: string, font: SheetFont): SheetMm
}
export type SheetPrimitive =
  | {
      readonly kind: 'line'
      readonly x1: SheetMm
      readonly y1: SheetMm
      readonly x2: SheetMm
      readonly y2: SheetMm
      readonly dashed: boolean
      /** Толщина линии; без неё — тонкая линия листа 0,25 мм. */
      readonly weight?: SheetMm | undefined
      /** Серая линия: подсветка пути с работой под чёрной линией пути. */
      readonly shade?: boolean | undefined
      /** Цвет линии «#rrggbb»; без него — чёрный (или серый при shade). */
      readonly color?: string | undefined
    }
  | {
      readonly kind: 'rect'
      readonly x: SheetMm
      readonly y: SheetMm
      readonly width: SheetMm
      readonly height: SheetMm
      readonly shade: boolean
      readonly border: boolean
      /** Заливка «#rrggbb» вместо белой или серой. */
      readonly fill?: string | undefined
    }
  | {
      readonly kind: 'circle'
      readonly x: SheetMm
      readonly y: SheetMm
      readonly radius: SheetMm
      /** Серая заливка: подсветка стрелки с работой. */
      readonly shade?: boolean | undefined
    }
  | {
      readonly kind: 'text'
      readonly x: SheetMm
      readonly y: SheetMm
      readonly text: string
      readonly font: SheetFont
      /** −90 — подпись читается снизу вверх, поворот вокруг точки (x; y). */
      readonly rotate?: -90 | undefined
      /** Цвет текста «#rrggbb»; без него — чёрный. */
      readonly color?: string | undefined
      /** middle — x задаёт середину строки. */
      readonly anchor?: 'middle' | undefined
    }
export interface SheetPage {
  readonly width: SheetMm
  readonly height: SheetMm
  readonly number: number
  readonly primitives: readonly SheetPrimitive[]
}
export interface OverviewLine {
  readonly id: string
  readonly name: string
  readonly extents: readonly { readonly from: Chainage; readonly to: Chainage }[]
  readonly kmLengths: readonly (readonly [number, number])[]
}
export interface OverviewSource {
  readonly edition: { readonly id: number; readonly date: string; readonly label: string }
  readonly lines: readonly OverviewLine[]
  readonly axes: readonly {
    readonly id: string
    readonly lineId: string
    readonly name: string
    readonly at: Chainage
  }[]
  readonly boundaries: readonly {
    readonly lineId: string
    readonly code: string
    /** ПЧУ, в которое входит ПД, по оргструктуре на дату редакции; нет — «не указан». */
    readonly pchu?: string | undefined
    readonly from: Chainage
    readonly to: Chainage
  }[]
  readonly warnings: readonly string[]
  /** Название дистанции из листа «Руководители» (ADR-0051). */
  readonly district?: string | undefined
  /** ФИО руководителей по кодам ПД и ПЧУ на дату редакции. */
  readonly heads?: Readonly<Record<string, string>> | undefined
  /** Станционные пути (кроме главных) и стрелки по названию станции на дату редакции. */
  readonly stationStats?:
    | Readonly<
        Record<
          string,
          { readonly tracks: number; readonly meters: number; readonly switches: number }
        >
      >
    | undefined
  /** Станции с осями, не привязанные ни к одному действующему ПД. */
  readonly unboundStations?: readonly string[] | undefined
}
export interface OverviewDocument {
  readonly pages: readonly SheetPage[]
  readonly warnings: readonly string[]
}
export interface SheetError {
  readonly message: string
}
export type OverviewScale = 25000 | 50000 | 100000
export interface OverviewClient {
  editions(): Promise<
    Result<
      readonly {
        readonly id: number
        readonly number: number
        readonly label: string
        readonly date: string
      }[],
      SheetError
    >
  >
  source(editionId: number): Promise<Result<OverviewSource, SheetError>>
  /** Срез редакции для административного деления (#32). */
  admDivision(editionId: number): Promise<Result<AdmDivisionSource, SheetError>>
}
