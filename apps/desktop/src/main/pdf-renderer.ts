import { channels, type ResponseOf } from '@eow/ipc/contracts'
import type { SheetPage } from '@eow/documents/application'
import { registerHandler, type IpcMainLike } from './ipc/register'

export class PdfRenderError extends Error {}

export const PDF_OPTIONS = {
  pageSize: 'A3',
  landscape: true,
  printBackground: true,
  displayHeaderFooter: false,
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
  scale: 1,
  preferCSSPageSize: true,
} as const
export interface PrintWindow {
  readonly webContents: {
    readonly id: number
    printToPDF(options: typeof PDF_OPTIONS): Promise<Uint8Array>
  }
  loadURL(url: string): Promise<unknown>
  once(event: 'closed', listener: () => void): unknown
  isDestroyed(): boolean
  destroy(): void
}
interface PrintJob {
  readonly pages: readonly SheetPage[]
  loaded: boolean
  ready: boolean
  readonly complete: () => void
  readonly fail: (error: Error) => void
}
function senderId(event: unknown): number | undefined {
  if (typeof event !== 'object' || event === null || !('sender' in event)) return undefined
  const sender = event.sender
  return typeof sender === 'object' &&
    sender !== null &&
    'id' in sender &&
    typeof sender.id === 'number'
    ? sender.id
    : undefined
}

/**
 * Отдельное окно на файл: все его листы печатаются одним printToPDF, каждый на своей
 * странице А3. Модель доступна только webContents этого окна.
 */
export function createPdfRenderer(
  ipc: IpcMainLike,
  createWindow: () => PrintWindow,
  url: string,
  timeoutMs = 60000,
) {
  const jobs = new Map<number, PrintJob>()
  registerHandler(
    ipc,
    channels.printHost,
    (request, event): ResponseOf<typeof channels.printHost> => {
      const id = senderId(event),
        job = id === undefined ? undefined : jobs.get(id)
      if (!job) return { status: 'error', message: 'Окно печати не зарегистрировано.' }
      if (request.action === 'load' && !job.loaded) {
        job.loaded = true
        return channels.printHost.response.parse({ status: 'pages', pages: job.pages })
      }
      if (request.action === 'ready' && job.loaded && !job.ready) {
        job.ready = true
        job.complete()
        return { status: 'ok' }
      }
      if (request.action === 'failed')
        job.fail(new PdfRenderError('Не удалось отрисовать лист или загрузить встроенные шрифты.'))
      return { status: 'error', message: 'Неверная последовательность подготовки PDF.' }
    },
  )
  return async (pages: readonly SheetPage[]): Promise<Uint8Array> => {
    if (!pages.length) throw new PdfRenderError('Нет листов для PDF.')
    const win = createWindow()
    const id = win.webContents.id
    let complete: () => void = () => undefined
    const ready = new Promise<void>((resolve) => {
      complete = resolve
    })
    let fail: (error: Error) => void = () => undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      fail = reject
    })
    const timer = setTimeout(
      () => fail(new PdfRenderError('Превышено время подготовки PDF. Повторите сохранение.')),
      timeoutMs,
    )
    jobs.set(id, { pages, loaded: false, ready: false, complete, fail })
    win.once('closed', () =>
      fail(new PdfRenderError('Окно подготовки PDF закрыто. Повторите сохранение.')),
    )
    try {
      return await Promise.race([
        (async () => {
          await Promise.all([win.loadURL(url), ready])
          return win.webContents.printToPDF(PDF_OPTIONS)
        })(),
        aborted,
      ])
    } finally {
      clearTimeout(timer)
      jobs.delete(id)
      if (!win.isDestroyed()) win.destroy()
    }
  }
}
