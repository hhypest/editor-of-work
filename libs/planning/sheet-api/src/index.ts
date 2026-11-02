import type { Chainage, PlaceItem, StationLayout, TrackSpan } from '@eow/shared/kernel'

/** Контекст применённого плана; незавершённые формы в срез не входят. */
export interface PlanPreviewContext {
  readonly pdScale?: 25000 | 50000 | 100000 | null | undefined
  readonly planEpoch?: number | undefined
  readonly revision: number
  readonly area: string
  /** ПД, листы которого показывает предпросмотр: ПД области или ПД станции; null — нет. */
  readonly sheetPd?: string | null | undefined
  readonly hasPlan: boolean
  readonly hasRecovery: boolean
  readonly busy: boolean
  readonly pending: boolean
}
export interface PlanPdScaleChange {
  readonly revision: number
  readonly area: string
  readonly scale: 25000 | 50000 | 100000
}

/** Работы, размещённые на готовой странице той же ревизии плана. */
export interface PlanPageSelection {
  readonly revision: number
  readonly area: string
  readonly page: number
  readonly workIds: readonly string[]
}

/** Таблица листа: ширины столбцов в мм, сумма — 390. */
export interface PlanSheetTable {
  readonly title: string
  readonly columns: readonly { readonly title: string; readonly width: number }[]
  readonly rows: readonly (readonly string[])[]
  /** ID работы для каждой строки ведомости; у сводных таблиц отсутствует. */
  readonly workIds?: readonly string[] | undefined
  /**
   * Столбец подписи группы: строки несут полную подпись, повтор у подряд идущих строк
   * скрывается в пределах страницы и печатается в начале каждого продолжения.
   */
  readonly groupColumn?: number | undefined
}

/**
 * Лист станции в составе листов её ПД (ADR-0048): раскладка схемы из среза паспорта,
 * работы станции с объектом для подсветки и таблицы станции.
 */
export interface PlanSheetStation {
  readonly id: string
  readonly name: string
  /** null — схема станции не загружена в паспорт или план составлен до формата v9. */
  readonly layout: StationLayout | null
  readonly works: readonly {
    readonly id: string
    readonly name: string
    /** Путь или стрелка, к которым привязана работа; null — работа на всю станцию. */
    readonly object: { readonly kind: 'track' | 'switch'; readonly number: string } | null
    readonly volume: number
    readonly unit: string
    readonly note: string
    readonly callout: boolean
  }[]
  readonly tables: readonly PlanSheetTable[]
}

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
    readonly scale?: 25000 | 50000 | 100000 | undefined
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
    readonly tables: readonly PlanSheetTable[]
    /** Станции ПД с раскладкой или работами; пусто, если листы станций скрыты. */
    readonly stations: readonly PlanSheetStation[]
  }[]
}
