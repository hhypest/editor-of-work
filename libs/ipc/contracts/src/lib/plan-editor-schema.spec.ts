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
  it('проверяет пакет показателей, запрещая лишние поля и чрезмерный размер', () => {
    const row = { id: null, name: 'Учебный показатель', unit: '', value: '0', note: '' }
    const request = (rows: unknown[]) => ({
      action: 'editor',
      command: { kind: 'indicatorRows', rows },
      revision: 1,
      area: 'pd:a',
    })
    expect(channels.planFile.request.safeParse(request([row])).success).toBe(true)
    expect(channels.planFile.request.safeParse(request([])).success).toBe(true)
    for (const invalid of [
      { ...row, value: 0 },
      { ...row, path: '/unexpected' },
      { ...row, id: 4 },
    ])
      expect(channels.planFile.request.safeParse(request([invalid])).success).toBe(false)
    expect(
      channels.planFile.request.safeParse(request(Array.from({ length: 10001 }, () => row)))
        .success,
    ).toBe(false)
  })
})
