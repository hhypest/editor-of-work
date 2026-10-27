import { channels } from './channels'
describe('Контракт редактора', () => {
  it('проверяет строгий пакет состава таблиц', () => {
    const request = (hidden: unknown) => ({
      action: 'editor',
      command: { kind: 'pdTables', hidden },
      revision: 1,
      area: 'pd:a',
    })
    expect(channels.planFile.request.safeParse(request(['works', 'current'])).success).toBe(true)
    expect(channels.planFile.request.safeParse(request([])).success).toBe(true)
    for (const hidden of [['unknown'], [1], 'works', Array.from({ length: 8 }, () => 'works')])
      expect(channels.planFile.request.safeParse(request(hidden)).success).toBe(false)
    expect(
      channels.planFile.request.safeParse({ ...request([]), path: '/unexpected' }).success,
    ).toBe(false)
  })
  it('принимает только поддерживаемые числовые масштабы и строгую команду', () => {
    const request = (scale: unknown) => ({
      action: 'editor',
      command: { kind: 'pdScale', scale },
      revision: 1,
      area: 'pd:a',
    })
    for (const scale of [25000, 50000, 100000])
      expect(channels.planFile.request.safeParse(request(scale)).success).toBe(true)
    for (const scale of [0, 75000, 25000.1, '25000', null])
      expect(channels.planFile.request.safeParse(request(scale)).success).toBe(false)
    expect(
      channels.planFile.request.safeParse({ ...request(25000), path: '/unexpected' }).success,
    ).toBe(false)
  })
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
  it('проверяет строгий пакет ожидаемых показателей с текстом значения', () => {
    const row = { id: null, group: 'Учебный показатель', name: '', unit: 'км', value: '' }
    const request = (rows: unknown[]) => ({
      action: 'editor',
      command: { kind: 'expectedRows', rows },
      revision: 1,
      area: 'district',
    })
    expect(channels.planFile.request.safeParse(request([row])).success).toBe(true)
    expect(channels.planFile.request.safeParse(request([])).success).toBe(true)
    for (const invalid of [
      { ...row, value: null },
      { ...row, value: 1 },
      { ...row, note: '' },
      { ...row, id: 4 },
      { id: null, name: '', unit: '', value: '' },
    ])
      expect(channels.planFile.request.safeParse(request([invalid])).success).toBe(false)
    expect(
      channels.planFile.request.safeParse(request(Array.from({ length: 10001 }, () => row)))
        .success,
    ).toBe(false)
  })
})
