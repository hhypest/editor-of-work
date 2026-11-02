import { channels, type ResponseOf } from '@eow/ipc/contracts'
import type { Workbook } from '@eow/documents/application'
import { writePdfAtomically } from '../pdf-exporter'
import { workbookToXlsx } from '../spreadsheet-exporter'
import { registerHandler, type IpcMainLike } from './register'

type Response = ResponseOf<typeof channels.spreadsheet>

export interface SpreadsheetPorts {
  /** Диалог сохранения: путь не покидает main. */
  choosePath(defaultName: string): Promise<string | undefined>
  render?: (workbook: Workbook) => Promise<Uint8Array>
  write?: (path: string, data: Uint8Array) => Promise<void>
}

/** Имя файла по умолчанию без знаков, недопустимых в Windows. */
export function xlsxFileName(name: string): string {
  const clean = name
    .replace(/\.xlsx$/iu, '')
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
    .replace(/[. ]+$/u, '')
    .trim()
  return `${clean || 'Книга'}.xlsx`
}

/** Книга xlsx (ADR-0052): запись ExcelJS и атомарная замена файла. */
export function registerSpreadsheetHandler(ipc: IpcMainLike, ports: SpreadsheetPorts): void {
  const render = ports.render ?? workbookToXlsx
  const write = ports.write ?? writePdfAtomically
  registerHandler(ipc, channels.spreadsheet, async ({ fileName, workbook }): Promise<Response> => {
    const path = await ports.choosePath(xlsxFileName(fileName))
    if (!path) return { status: 'cancelled' }
    if (!/\.xlsx$/iu.test(path))
      return { status: 'error', message: 'Укажите имя файла с расширением .xlsx.' }
    try {
      await write(path, await render(workbook))
      return { status: 'saved' }
    } catch {
      return {
        status: 'error',
        message: 'Не удалось сохранить книгу. Проверьте, что файл не открыт в Excel, и повторите.',
      }
    }
  })
}
