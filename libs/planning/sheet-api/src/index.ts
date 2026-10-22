import type { Chainage, PlaceItem, TrackSpan } from '@eow/shared/kernel'

/** Опубликованный срез для Документов: доменные объекты и расчёты остаются в Планировании. */
export interface PlanSheetData {
  readonly year: number
  readonly edition: { readonly number: string; readonly date: string }
  readonly approval: { readonly title: string; readonly name: string; readonly year: number }
  readonly lines: readonly {
    readonly id: string
    readonly name: string
    readonly extents: readonly { readonly from: Chainage; readonly to: Chainage }[]
    readonly kmLengths: readonly (readonly [number, number])[]
  }[]
  readonly pds: readonly {
    readonly id: string
    readonly name: string
    readonly pchu: string
    readonly segments: readonly TrackSpan[]
    readonly works: readonly {
      readonly id: string
      readonly name: string
      readonly place: string
      readonly lineId: string | null
      readonly items: readonly PlaceItem[]
      readonly volume: number
      readonly unit: string
      readonly note: string
      readonly callout: boolean
    }[]
    readonly tables: readonly {
      readonly title: string
      readonly columns: readonly { readonly title: string; readonly width: number }[]
      readonly rows: readonly (readonly string[])[]
    }[]
  }[]
}
