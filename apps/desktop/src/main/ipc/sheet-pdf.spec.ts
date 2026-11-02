import { channels } from '@eow/ipc/contracts'
import { PdfRenderError } from '../pdf-renderer'
import { registerSheetPdfHandler, type SheetPdfPorts } from './sheet-pdf'

const page = {
  width: { unit: 'mm', value: 420 },
  height: { unit: 'mm', value: 297 },
  number: 1,
  primitives: [
    {
      kind: 'text',
      text: 'Учебная',
      x: { unit: 'mm', value: 20 },
      y: { unit: 'mm', value: 30 },
      font: { family: 'PT Sans Narrow', weight: 400, size: { unit: 'mm', value: 2.5 } },
      rotate: -90,
    },
  ],
} as const
const pdf = new TextEncoder().encode('%PDF-1.7 учебный')

describe('PDF паспортных схем', () => {
  let handler: (event: unknown, request: unknown) => unknown
  const setup = (ports: Partial<SheetPdfPorts>) => {
    const full: SheetPdfPorts = {
      choosePath: vi.fn<SheetPdfPorts['choosePath']>(async () => '/учебная/схема.pdf'),
      render: vi.fn<SheetPdfPorts['render']>(async () => pdf),
      write: vi.fn<NonNullable<SheetPdfPorts['write']>>(async () => undefined),
      ...ports,
    }
    registerSheetPdfHandler({ handle: (_c, listener) => (handler = listener) }, full)
    return full
  }
  const invoke = async (request: unknown) =>
    channels.sheetPdf.response.parse(await handler(undefined, request))

  it('печатает все листы одним файлом в выбранный путь', async () => {
    const ports = setup({})
    expect(await invoke({ fileName: 'Схема: дистанции.pdf', pages: [page, page] })).toEqual({
      status: 'saved',
    })
    expect(ports.choosePath).toHaveBeenCalledWith('Схема_ дистанции.pdf')
    expect(ports.render).toHaveBeenCalledWith([page, page])
    expect(ports.write).toHaveBeenCalledWith('/учебная/схема.pdf', pdf)
  })

  it('отмена, неверное расширение, ошибка печати и неверный PDF ничего не пишут', async () => {
    const write = vi.fn<NonNullable<SheetPdfPorts['write']>>(async () => undefined)
    setup({ choosePath: async () => undefined, write })
    expect(await invoke({ fileName: 'Схема', pages: [page] })).toEqual({ status: 'cancelled' })
    setup({ choosePath: async () => '/учебная/схема.txt', write })
    expect(await invoke({ fileName: 'Схема', pages: [page] })).toMatchObject({ status: 'error' })
    setup({
      render: async () => {
        throw new PdfRenderError('Окно печати не ответило.')
      },
      write,
    })
    expect(await invoke({ fileName: 'Схема', pages: [page] })).toEqual({
      status: 'error',
      message: 'Окно печати не ответило.',
    })
    setup({ render: async () => new Uint8Array([1, 2, 3]), write })
    expect(await invoke({ fileName: 'Схема', pages: [page] })).toMatchObject({ status: 'error' })
    expect(write).not.toHaveBeenCalled()
  })

  it('отклоняет пустой пакет и повёрнутую не на −90° подпись', async () => {
    setup({})
    await expect(invoke({ fileName: 'Схема', pages: [] })).rejects.toThrow('неверный запрос')
    const turned = { ...page, primitives: [{ ...page.primitives[0], rotate: 90 }] }
    await expect(invoke({ fileName: 'Схема', pages: [turned] })).rejects.toThrow('неверный запрос')
  })
})
