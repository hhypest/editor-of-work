import { manualTemplate } from './manual-template-channel'
describe('Канал шаблона ручных данных', () => {
  it('выдача принимает только логический флаг типового перечня', () => {
    const request = (extra: object) => ({ action: 'export', editionId: 1, ...extra })
    expect(manualTemplate.request.safeParse(request({})).success).toBe(true)
    expect(manualTemplate.request.safeParse(request({ typicalWorkKinds: true })).success).toBe(true)
    for (const extra of [{ typicalWorkKinds: 'да' }, { typicalWorkKinds: 1 }, { path: '/x' }])
      expect(manualTemplate.request.safeParse(request(extra)).success).toBe(false)
    expect(
      manualTemplate.request.safeParse({ action: 'prepare', editionId: 1, typicalWorkKinds: true })
        .success,
    ).toBe(false)
  })
  it('итог выдачи содержит только неотрицательные целые счётчики перечня', () => {
    const parse = (typical: unknown) =>
      manualTemplate.response.safeParse({ status: 'exported', typical }).success
    expect(manualTemplate.response.safeParse({ status: 'exported' }).success).toBe(true)
    expect(parse({ added: 120, existing: 2 })).toBe(true)
    for (const typical of [{ added: -1, existing: 0 }, { added: 1.5, existing: 0 }, { added: 1 }])
      expect(parse(typical)).toBe(false)
    expect(parse({ added: 1, existing: 0, kinds: [] })).toBe(false)
  })
})
