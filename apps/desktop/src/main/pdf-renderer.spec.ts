import { channels } from '@eow/ipc/contracts'
import { mm, type SheetPage } from '@eow/documents/application'
import { createPdfRenderer, PDF_OPTIONS, type PrintWindow } from './pdf-renderer'
import type { IpcMainLike } from './ipc/register'
const page: SheetPage = { width: mm(420), height: mm(297), number: 7, primitives: [] }
function setup(timeout = 60000) {
  let handler: (event: unknown, ...args: unknown[]) => unknown = () => undefined
  const ipc: IpcMainLike = {
    handle: (_name, fn) => {
      handler = fn
    },
  }
  let closed: () => void = () => undefined
  let destroyed = false
  const win: PrintWindow = {
    webContents: {
      id: 42,
      printToPDF: vi.fn<PrintWindow['webContents']['printToPDF']>(async () => new Uint8Array([1])),
    },
    loadURL: vi.fn<PrintWindow['loadURL']>(async () => undefined),
    once: (_event, fn) => {
      closed = fn
    },
    isDestroyed: () => destroyed,
    destroy: vi.fn<PrintWindow['destroy']>(() => {
      destroyed = true
      closed()
    }),
  }
  const render = createPdfRenderer(ipc, () => win, 'app://ui/?print=1', timeout)
  const invoke = async (action: string, id = 42) =>
    channels.printHost.response.parse(await handler({ sender: { id } }, { action }))
  return { win, render, invoke, close: () => win.destroy() }
}
afterEach(() => vi.useRealTimers())
it('ждёт готовности нужного окна, печатает А3 и освобождает модель после завершения', async () => {
  const { win, render, invoke } = setup()
  const pending = render([page])
  expect(await invoke('load', 999)).toMatchObject({ status: 'error' })
  expect(await invoke('ready')).toMatchObject({ status: 'error' })
  expect(await invoke('load')).toEqual({ status: 'pages', pages: [page] })
  expect(await invoke('load')).toMatchObject({ status: 'error' })
  expect(win.webContents.printToPDF).not.toHaveBeenCalled()
  await invoke('ready')
  await expect(pending).resolves.toEqual(new Uint8Array([1]))
  expect(win.webContents.printToPDF).toHaveBeenCalledExactlyOnceWith(PDF_OPTIONS)
  expect(win.loadURL).toHaveBeenCalledExactlyOnceWith('app://ui/?print=1')
  expect(win.destroy).toHaveBeenCalledTimes(1)
  expect(await invoke('load')).toMatchObject({ status: 'error' })
})
it.each(['fonts', 'close', 'load', 'print'] as const)(
  'отказ %s завершает экспорт и удаляет окно',
  async (failure) => {
    const { win, render, invoke, close } = setup()
    if (failure === 'load') vi.mocked(win.loadURL).mockRejectedValueOnce(new Error('load'))
    if (failure === 'print')
      vi.mocked(win.webContents.printToPDF).mockRejectedValueOnce(new Error('print'))
    const pending = render([page])
    const rejected = pending.catch((error: unknown) => error)
    if (failure === 'fonts') await invoke('failed')
    if (failure === 'close') close()
    if (failure === 'print') {
      await invoke('load')
      await invoke('ready')
    }
    await rejected
    expect(win.isDestroyed()).toBe(true)
    expect(await invoke('load')).toMatchObject({ status: 'error' })
  },
)
it.each(['ready', 'print'] as const)(
  'тайм-аут ожидания %s не оставляет окно и модель',
  async (phase) => {
    vi.useFakeTimers()
    const { win, render, invoke } = setup(100)
    vi.mocked(win.webContents.printToPDF).mockImplementation(() => new Promise(() => undefined))
    const pending = render([page])
    const rejected = pending.catch((error: unknown) => error)
    if (phase === 'print') {
      await invoke('load')
      await invoke('ready')
    }
    await vi.advanceTimersByTimeAsync(101)
    await rejected
    expect(win.isDestroyed()).toBe(true)
    expect(await invoke('load')).toMatchObject({ status: 'error' })
  },
)
it('печатает несколько листов одним вызовом и отклоняет пустой набор', async () => {
  const { win, render, invoke } = setup()
  await expect(render([])).rejects.toThrow('Нет листов')
  const second = { ...page, number: 8 }
  const pending = render([page, second])
  expect(await invoke('load')).toEqual({ status: 'pages', pages: [page, second] })
  await invoke('ready')
  await expect(pending).resolves.toEqual(new Uint8Array([1]))
  expect(win.webContents.printToPDF).toHaveBeenCalledTimes(1)
})
