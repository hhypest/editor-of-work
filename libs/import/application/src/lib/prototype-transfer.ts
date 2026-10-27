import type { KmLengths, PlaceSpec, TrackSpan } from '@eow/shared/kernel'

/** Опубликованный результат разбора старого проекта. Не зависит от домена планирования. */
export interface PrototypeTransfer {
  readonly year: number
  readonly approval: { readonly title: string; readonly name: string; readonly year: number }
  readonly basis: {
    readonly edition: { readonly number: string; readonly date: string }
    readonly lines: readonly {
      readonly id: string
      readonly name: string
      readonly extent: readonly TrackSpan[]
      readonly kmLengths: KmLengths
    }[]
    readonly pds: readonly {
      readonly id: string
      readonly name: string
      readonly pchu: string
      readonly segments: readonly TrackSpan[]
    }[]
    readonly stations: readonly {
      readonly id: string
      readonly name: string
      readonly tracks: readonly string[]
      readonly switches: readonly string[]
      readonly pd: string | undefined
      readonly legacyLayout?: TransferStationLayout
    }[]
    readonly workKinds: readonly {
      readonly code: string
      readonly name: string
      readonly unit: string
      readonly group: 'current' | 'capital' | 'other'
      readonly inPlanTable: boolean
      readonly includedIn?: string
    }[]
  }
  readonly works: readonly {
    readonly id: string
    readonly kind: string
    readonly place:
      | {
          readonly kind: 'line'
          readonly spec: PlaceSpec
          readonly station?: string
          readonly object?: TransferStationObject
        }
      | {
          readonly kind: 'station'
          readonly station: string
          readonly object?: TransferStationObject
        }
    readonly volume: number | undefined
    readonly note: string
    readonly callout: boolean
  }[]
  readonly manual: readonly {
    readonly area:
      | { readonly kind: 'district' }
      | { readonly kind: 'pd'; readonly pd: string }
      | { readonly kind: 'station'; readonly station: string }
    readonly field: 'overrides' | 'needs'
    readonly code: string
    readonly value: number
  }[]
  /** Ожидаемые показатели из `tables[область].expected` прототипа: только дистанция и ПД. */
  readonly expected: readonly {
    readonly area: { readonly kind: 'district' } | { readonly kind: 'pd'; readonly pd: string }
    readonly rows: readonly {
      readonly id: string
      readonly group: string
      readonly name: string
      readonly unit: string
      readonly value: number | null
    }[]
  }[]
  /** Перечни `tables[область].contract|isso|zp` прототипа: только дистанция и ПД. */
  readonly items: readonly {
    readonly area: { readonly kind: 'district' } | { readonly kind: 'pd'; readonly pd: string }
    readonly table: 'contract' | 'isso' | 'zp'
    readonly rows: readonly {
      readonly id: string
      readonly name: string
      readonly unit: string
      readonly quantity: number
      readonly cost: number
    }[]
  }[]
  readonly prototype: { readonly source: string; readonly report: readonly TransferProblem[] }
}

export interface TransferProblem {
  readonly path: string
  readonly message: string
}
interface TransferStationObject {
  readonly kind: 'track' | 'switch'
  readonly number: string
}

/** Публикуемый срез раскладки прототипа, без зависимости от чужого домена. */
export interface TransferStationLayout {
  readonly tracks: readonly {
    readonly id: string
    readonly number: string
    readonly purpose: string
    readonly label: string
    readonly row: number
    readonly x1: number | null
    readonly x2: number | null
    readonly fullMeters: number | null
    readonly usefulMeters: number | null
    readonly capacity: string
    readonly left: { readonly switchNumber: string; readonly parent: string | null }
    readonly right: { readonly switchNumber: string; readonly parent: string | null }
  }[]
  readonly objects: readonly {
    readonly id: string
    readonly type: string
    readonly text: string
    readonly x: number
    readonly y: number | null
    readonly width: number | null
    readonly height: number | null
  }[]
}
