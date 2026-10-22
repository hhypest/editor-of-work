import { samplePlanBasis } from '@eow/planning/domain'
import { err, ok } from '@eow/shared/kernel'
import { createPlanFromPassport, type PassportView } from './passport-view'
function input() {
  const b = samplePlanBasis()
  return {
    edition: b.edition,
    lines: [...b.lines.values()],
    pds: [...b.pds.values()],
    stations: [...b.stations.values()],
    workKinds: [...b.workKinds.values()],
  }
}
const port = (): PassportView => ({
  editions: async () => ok([]),
  basis: vi.fn<PassportView['basis']>(async () => ok(input())),
})
describe('Новый план из паспорта', () => {
  it('создаёт пустые работы и ручные значения с собственным срезом и грифом без ФИО', async () => {
    const source = port()
    const plan = await createPlanFromPassport(source, 7, 2027)
    expect(source.basis).toHaveBeenCalledWith(7)
    expect(plan).toMatchObject({
      ok: true,
      value: {
        year: 2027,
        approval: { title: '', name: '', year: 2026 },
        works: [],
        manual: new Map(),
      },
    })
    if (!plan.ok) throw new Error('нет плана')
    expect(plan.value.basis.lines.get('L1')?.kmLengths.lengthOf(20)).toBe(964)
    expect(plan.value.prototype).toBeUndefined()
  })
  it('отклоняет неверные год и редакцию до чтения паспорта', async () => {
    const source = port()
    for (const [id, year] of [
      [7, 1999],
      [7, 2101],
      [7, 2027.5],
      [0, 2027],
    ])
      expect((await createPlanFromPassport(source, id!, year!)).ok).toBe(false)
    expect(source.basis).not.toHaveBeenCalled()
  })
  it('возвращает ошибку источника и не создаёт план по пустому каталогу', async () => {
    const source = port()
    vi.mocked(source.basis).mockResolvedValueOnce(err({ message: 'Нет редакции' }))
    expect(await createPlanFromPassport(source, 7, 2027)).toEqual(err({ message: 'Нет редакции' }))
    vi.mocked(source.basis).mockResolvedValueOnce(ok({ ...input(), workKinds: [] }))
    expect(await createPlanFromPassport(source, 7, 2027)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('виды работ') },
    })
  })
  it('не создаёт план с перекрывающимися границами ПД', async () => {
    const source = port(),
      b = input()
    vi.mocked(source.basis).mockResolvedValueOnce(
      ok({ ...b, pds: [...b.pds, { ...b.pds[0]!, id: 'duplicate' }] }),
    )
    expect((await createPlanFromPassport(source, 7, 2027)).ok).toBe(false)
  })
})
