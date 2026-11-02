import { channels, type ResponseOf } from '@eow/ipc/contracts'
import { pdfFileNames, type SheetPage } from '@eow/documents/application'
import { PdfRenderError } from '../pdf-renderer'
import { writePdfAtomically } from '../pdf-exporter'
import { registerHandler, type IpcMainLike } from './register'

type Response = ResponseOf<typeof channels.sheetPdf>

export interface SheetPdfPorts {
  /** Диалог сохранения: путь не покидает main. */
  choosePath(defaultName: string): Promise<string | undefined>
  render(pages: readonly SheetPage[]): Promise<Uint8Array>
  write?: (path: string, data: Uint8Array) => Promise<void>
}

/**
 * PDF листов паспортных схем (ADR-0050): одна печать всех листов и атомарная запись.
 * Замену существующего файла пользователь подтверждает в диалоге сохранения.
 */
export function registerSheetPdfHandler(ipc: IpcMainLike, ports: SheetPdfPorts): void {
  const write = ports.write ?? writePdfAtomically
  registerHandler(ipc, channels.sheetPdf, async ({ fileName, pages }): Promise<Response> => {
    const name = pdfFileNames([fileName.replace(/\.pdf$/iu, '')])[0] ?? 'Схема.pdf'
    const path = await ports.choosePath(name)
    if (!path) return { status: 'cancelled' }
    if (!/\.pdf$/iu.test(path))
      return { status: 'error', message: 'Укажите имя файла с расширением .pdf.' }
    try {
      const data = await ports.render(pages)
      if (data.length < 5 || String.fromCharCode(...data.slice(0, 5)) !== '%PDF-')
        return { status: 'error', message: 'Не удалось сформировать корректный PDF.' }
      await write(path, data)
      return { status: 'saved' }
    } catch (error) {
      return {
        status: 'error',
        message:
          error instanceof PdfRenderError
            ? error.message
            : 'Не удалось сохранить PDF. Проверьте доступ к папке и повторите попытку.',
      }
    }
  })
}
