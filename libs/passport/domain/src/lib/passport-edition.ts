import { err, ok, type Result } from '@eow/shared/kernel'

export interface PassportEdition {
  readonly id: number
  readonly number: number
  readonly date: string
  readonly label: string
  readonly status: 'draft' | 'active' | 'archived'
}

export interface EditionInput {
  readonly date: string
  readonly label: string
}

export interface PassportError {
  readonly kind: 'invalid-edition' | 'invalid-import' | 'not-found' | 'immutable' | 'storage'
  readonly message: string
}

export function validateEdition(input: EditionInput): Result<EditionInput, PassportError> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? new Date(input.date) : undefined
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.date)
    return err({ kind: 'invalid-edition', message: 'Укажите существующую дату редакции.' })
  const label = input.label.trim()
  if (!label || label.length > 200)
    return err({ kind: 'invalid-edition', message: 'Название редакции: от 1 до 200 символов.' })
  return ok(Object.freeze({ date: input.date, label }))
}

export function canActivate(edition: PassportEdition): Result<void, PassportError> {
  return edition.status === 'draft'
    ? ok(undefined)
    : err({ kind: 'immutable', message: 'Ввести в действие можно только черновик.' })
}
