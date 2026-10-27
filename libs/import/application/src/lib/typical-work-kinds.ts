import type { IdGenerator, Result } from '@eow/shared/kernel'
import type { ManualData, ManualWorkKind } from '@eow/passport/import-api'

/**
 * Вид работ типового перечня, который поставляется с программой (ADR-0032).
 * Это подсказка для заполнения шаблона ручных данных: в паспорт строки попадают
 * только после загрузки книги, предпросмотра и подтверждения составителем.
 */
export interface TypicalWorkKind {
  readonly code: string
  readonly name: string
  readonly unit: string
  readonly group: 'current' | 'capital' | 'other'
  readonly includedIn: string | null
}
export interface TypicalWorkKindCatalog {
  load(): Promise<Result<readonly TypicalWorkKind[], { readonly message: string }>>
}
export interface TypicalWorkKindsSummary {
  /** Добавлено в книгу строк перечня, которых не было в редакции. */
  readonly added: number
  /** Коды перечня, уже занятые видами работ редакции: строки редакции не меняются. */
  readonly existing: number
}

/**
 * Дополняет виды работ редакции недостающими строками перечня в его порядке.
 * Строки редакции сохраняются без изменений и стоят первыми; совпадение определяется кодом.
 */
export function addTypicalWorkKinds(
  data: ManualData,
  typical: readonly TypicalWorkKind[],
  ids: IdGenerator,
): { readonly data: ManualData; readonly summary: TypicalWorkKindsSummary } {
  const codes = new Set(data.workKinds.map((k) => k.code))
  const added: ManualWorkKind[] = []
  for (const kind of typical) {
    if (codes.has(kind.code)) continue
    codes.add(kind.code)
    added.push({
      id: ids.next(),
      validFrom: null,
      validTo: null,
      code: kind.code,
      name: kind.name,
      unit: kind.unit,
      group: kind.group,
      symbol: null,
      includedIn: kind.includedIn,
    })
  }
  return {
    data: { ...data, workKinds: [...data.workKinds, ...added] },
    summary: { added: added.length, existing: typical.length - added.length },
  }
}
