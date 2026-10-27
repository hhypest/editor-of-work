import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ManualData, ManualWorkKind } from '@eow/passport/import-api'
import type { Result } from '@eow/shared/kernel'
import { openPassportDatabase, type PassportDatabase } from './sqlite-passport-store'

const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
const kind = (id: string, code: string, includedIn: string | null = null): ManualWorkKind => ({
  id,
  validFrom: null,
  validTo: null,
  code,
  name: `Учебный вид ${code}`,
  unit: 'км',
  group: 'current',
  symbol: null,
  includedIn,
})
const data = (workKinds: readonly ManualWorkKind[]): ManualData => ({
  workKinds,
  repairNorms: [],
  tolerances: [],
  trainPairs: [],
  kilometres: [],
})

describe('Порядок видов работ в паспорте', () => {
  let root: string, store: PassportDatabase, id: number
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-kind-order-'))
    store = await openPassportDatabase(
      join(root, 'passport.sqlite'),
      resolve(import.meta.dirname, '../../migrations'),
    )
    id = value(await store.createDraft({ date: '2027-01-01', label: 'Учебная редакция' })).id
  })
  afterEach(async () => {
    await store.close()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  async function apply(workKinds: readonly ManualWorkKind[], name = 'Учебная.xlsx') {
    const basis = value(await store.manualBasis(id))
    value(
      await store.applyManualData(id, {
        basisToken: basis.token,
        date: basis.date,
        data: data(workKinds),
        file: {
          id: JSON.stringify(['manual-data', name]),
          form: 'manual-data',
          name,
          importedAt: '2027-01-01T00:00:00Z',
          sha256: 'a'.repeat(64),
          rowCount: workKinds.length,
          warnings: [],
        },
      }),
    )
    return value(await store.manualBasis(id)).data.workKinds.map((k) => k.code)
  }
  it('хранит порядок листа, а не порядок идентификаторов', async () => {
    // Идентификаторы нарочно идут в обратном алфавитном порядке, как случайные UUID.
    const kinds = [kind('z', 'ТС-1'), kind('m', 'ТС-2', 'ТС-1'), kind('a', 'ТС-3')]
    expect(await apply(kinds)).toEqual(['ТС-1', 'ТС-2', 'ТС-3'])
    const reordered = [kinds[2]!, kinds[0]!, kinds[1]!]
    expect(await apply(reordered, 'Переставленная.xlsx')).toEqual(['ТС-3', 'ТС-1', 'ТС-2'])
    expect(value(await store.manualImportReport(id)).map((f) => f.name)).toEqual([
      'Переставленная.xlsx',
    ])
  })
  it('та же книга в том же порядке не перезаписывает данные и журнал', async () => {
    const kinds = [kind('z', 'ТС-1'), kind('a', 'ТС-2')]
    await apply(kinds)
    await apply(kinds, 'Повтор.xlsx')
    expect(value(await store.manualImportReport(id)).map((f) => f.name)).toEqual(['Учебная.xlsx'])
  })
  it('новая редакция копирует порядок видов работ', async () => {
    await apply([kind('z', 'ТС-1'), kind('a', 'ТС-2'), kind('m', 'ТС-3')])
    value(await store.activate(id))
    const next = value(await store.createDraft({ date: '2028-01-01', label: 'Следующая' })).id
    expect(value(await store.manualBasis(next)).data.workKinds.map((k) => k.code)).toEqual([
      'ТС-1',
      'ТС-2',
      'ТС-3',
    ])
  })
})
