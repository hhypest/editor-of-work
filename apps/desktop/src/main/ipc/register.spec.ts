import { channels } from '@eow/ipc/contracts'
import { IpcValidationError, registerHandler, type IpcMainLike } from './register'

function fakeIpc() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) }
  const invoke = (name: string, ...args: unknown[]) => {
    const h = handlers.get(name)
    if (!h) throw new Error(`нет обработчика ${name}`)
    return Promise.resolve(h({}, ...args))
  }
  return { ipc, invoke }
}

describe('registerHandler', () => {
  it('вызывает обработчик для правильного запроса', async () => {
    const { ipc, invoke } = fakeIpc()
    registerHandler(ipc, channels.appInfo, () => ({
      name: 'editor-of-work',
      version: '0.5.0-alpha.1',
      planFormat: 7,
    }))
    await expect(invoke('app:info', {})).resolves.toEqual({
      name: 'editor-of-work',
      version: '0.5.0-alpha.1',
      planFormat: 7,
    })
  })

  it('отклоняет запрос, не прошедший схему, и не вызывает обработчик', async () => {
    const { ipc, invoke } = fakeIpc()
    const handler = vi.fn<() => { name: string; version: string; planFormat: number }>(() => ({
      name: 'x',
      version: '1',
      planFormat: 1,
    }))
    registerHandler(ipc, channels.appInfo, handler)
    await expect(invoke('app:info', { path: '/etc' })).rejects.toBeInstanceOf(IpcValidationError)
    expect(handler).not.toHaveBeenCalled()
  })

  it('отклоняет лишние аргументы', async () => {
    const { ipc, invoke } = fakeIpc()
    registerHandler(ipc, channels.appInfo, () => ({ name: 'x', version: '1', planFormat: 1 }))
    await expect(invoke('app:info', {}, {})).rejects.toThrow('ожидался один аргумент')
  })

  it('не пропускает ответ, не прошедший схему', async () => {
    const { ipc, invoke } = fakeIpc()
    registerHandler(ipc, channels.appInfo, () => ({ name: 'x', version: '1' }) as never)
    await expect(invoke('app:info', {})).rejects.toThrow('неверный ответ')
  })
})
