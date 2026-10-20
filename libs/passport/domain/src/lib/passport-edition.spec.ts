import { describe, expect, it } from 'vitest'
import { canActivate, validateEdition } from './passport-edition'

describe('Редакция паспорта', () => {
  it('проверяет календарную дату и убирает края названия', () => {
    expect(validateEdition({ date: '2028-02-29', label: '  Учебная  ' })).toEqual({
      ok: true,
      value: { date: '2028-02-29', label: 'Учебная' },
    })
  })
  it.each(['2027-02-29', '2027-04-31', '2027-00-01', 'не дата', '2027-1-1'])(
    'отклоняет невозможную дату %s',
    (date) => {
      expect(validateEdition({ date, label: 'Учебная' })).toMatchObject({
        ok: false,
        error: { kind: 'invalid-edition' },
      })
    },
  )
  it.each(['  ', 'x'.repeat(201)])('требует название в пределах 200 символов', (label) => {
    expect(validateEdition({ date: '2027-01-01', label }).ok).toBe(false)
  })
  it.each(['draft', 'active', 'archived'] as const)(
    'вводит в действие только черновик (%s)',
    (status) => {
      expect(
        canActivate({ id: 1, number: 1, date: '2027-01-01', label: 'Учебная', status }).ok,
      ).toBe(status === 'draft')
    },
  )
})
