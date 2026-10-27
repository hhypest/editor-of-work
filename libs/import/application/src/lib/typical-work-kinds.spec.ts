import { sequentialIds } from '@eow/shared/kernel'
import type { ManualData, ManualWorkKind } from '@eow/passport/import-api'
import { addTypicalWorkKinds, type TypicalWorkKind } from './typical-work-kinds'

const own: ManualWorkKind = {
  id: 'own',
  validFrom: '2026-01-01',
  validTo: null,
  code: 'УЧ-2',
  name: 'Вид редакции с тем же кодом',
  unit: 'км',
  group: 'capital',
  symbol: '◆',
  includedIn: null,
}
const empty: ManualData = {
  workKinds: [],
  repairNorms: [],
  tolerances: [],
  trainPairs: [],
  kilometres: [],
}
const typical: readonly TypicalWorkKind[] = [
  { code: 'УЧ-1', name: 'Учебная выправка', unit: 'км', group: 'current', includedIn: null },
  { code: 'УЧ-2', name: 'Учебная часть', unit: 'км', group: 'current', includedIn: 'УЧ-1' },
  { code: 'УЧ-3', name: 'Учебная замена', unit: 'шт', group: 'capital', includedIn: null },
]

describe('Типовой перечень видов работ в шаблоне', () => {
  it('добавляет перечень в его порядке с новыми ID и пустыми периодами', () => {
    const { data, summary } = addTypicalWorkKinds(empty, typical, sequentialIds('т'))
    expect(summary).toEqual({ added: 3, existing: 0 })
    expect(data.workKinds.map((k) => [k.id, k.code, k.group, k.includedIn])).toEqual([
      ['т-1', 'УЧ-1', 'current', null],
      ['т-2', 'УЧ-2', 'current', 'УЧ-1'],
      ['т-3', 'УЧ-3', 'capital', null],
    ])
    expect(data.workKinds.every((k) => !k.validFrom && !k.validTo && k.symbol === null)).toBe(true)
  })
  it('не меняет виды редакции и прочие разделы, совпадение определяет код', () => {
    const before: ManualData = { ...empty, workKinds: [own] }
    const snapshot = structuredClone(before)
    const { data, summary } = addTypicalWorkKinds(before, typical, sequentialIds('т'))
    expect(summary).toEqual({ added: 2, existing: 1 })
    expect(data.workKinds[0]).toBe(own)
    expect(data.workKinds.map((k) => k.code)).toEqual(['УЧ-2', 'УЧ-1', 'УЧ-3'])
    expect(data.repairNorms).toBe(before.repairNorms)
    expect(before).toEqual(snapshot)
  })
  it('пустой перечень оставляет данные прежними', () => {
    const { data, summary } = addTypicalWorkKinds(
      { ...empty, workKinds: [own] },
      [],
      sequentialIds('т'),
    )
    expect(summary).toEqual({ added: 0, existing: 0 })
    expect(data.workKinds).toEqual([own])
  })
})
