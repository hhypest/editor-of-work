import type { EditionInput, PassportEdition, PassportError } from '@eow/passport/domain'
import type { Result } from '@eow/shared/kernel'

/** Одна база дистанции. Изменения редакций и их данных атомарны. */
export interface PassportStore {
  list(): Promise<Result<readonly PassportEdition[], PassportError>>
  /** Копирует действующую редакцию, а для пустой базы создаёт пустой черновик. */
  createDraft(input: EditionInput): Promise<Result<PassportEdition, PassportError>>
  /** Копия SQLite до изменения, затем замена действующей редакции одной транзакцией. */
  activate(id: number): Promise<Result<PassportEdition, PassportError>>
}

export type { EditionInput, PassportEdition, PassportError } from '@eow/passport/domain'
