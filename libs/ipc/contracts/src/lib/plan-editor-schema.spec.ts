import { channels } from './channels'
describe('Контракт редактора', () => {
  it('отклоняет неизвестное поле, отрицательную ревизию и неверную структуру до main', () => {
    const request = { action: 'editor', command: { kind: 'open' }, revision: 1, area: 'district' }
    expect(channels.planFile.request.safeParse(request).success).toBe(true)
    expect(channels.planFile.request.safeParse({ ...request, path: '/unexpected' }).success).toBe(
      false,
    )
    expect(channels.planFile.request.safeParse({ ...request, revision: -1 }).success).toBe(false)
    expect(
      channels.planFile.request.safeParse({
        ...request,
        command: { kind: 'manualRows', rows: [{ code: 'work', plan: '1' }] },
      }).success,
    ).toBe(false)
  })
})
