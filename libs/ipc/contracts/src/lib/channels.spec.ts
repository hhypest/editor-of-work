import { channels } from './channels'

describe('контракт IPC', () => {
  it('лист редактора требует целую ревизию и ПД; пути и лишние поля не принимаются', () => {
    const request = { action: 'previewEditorSheets', revision: 2, pd: 'ПД-1' }
    expect(channels.planFile.request.safeParse(request).success).toBe(true)
    for (const patch of [{ revision: -1 }, { revision: 1.5 }, { pd: '' }, { path: 'C:/private' }])
      expect(channels.planFile.request.safeParse({ ...request, ...patch }).success).toBe(false)
  })
  it('имена каналов уникальны и имеют вид «контекст:действие»', () => {
    const names = Object.values(channels).map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[a-z]+:[a-zA-Z]+$/)
  })

  it('app:info принимает только пустой запрос', () => {
    expect(channels.appInfo.request.safeParse({}).success).toBe(true)
    expect(channels.appInfo.request.safeParse({ path: 'C:\\' }).success).toBe(false)
  })

  it('app:info отклоняет ответ без версии продукта или формата плана', () => {
    expect(channels.appInfo.response.safeParse({ name: 'editor-of-work' }).success).toBe(false)
    expect(
      channels.appInfo.response.safeParse({ name: 'editor-of-work', version: '0.5.0-alpha.1' })
        .success,
    ).toBe(false)
    expect(
      channels.appInfo.response.safeParse({
        name: 'editor-of-work',
        version: '0.5.0-alpha.1',
        planFormat: 7,
      }).success,
    ).toBe(true)
  })
})
