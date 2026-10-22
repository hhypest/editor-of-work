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
    }
  | {
      readonly kind: 'rect'
      readonly x: SheetMm
      readonly y: SheetMm
      readonly width: SheetMm
      readonly height: SheetMm
      readonly shade: boolean
      readonly border: boolean
    }
  | { readonly kind: 'circle'; readonly x: SheetMm; readonly y: SheetMm; readonly radius: SheetMm }
  | {
      readonly kind: 'text'
      readonly x: SheetMm
      readonly y: SheetMm
      readonly text: string
      readonly font: SheetFont
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
    readonly from: Chainage
    readonly to: Chainage
  }[]
  readonly warnings: readonly string[]
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
}
