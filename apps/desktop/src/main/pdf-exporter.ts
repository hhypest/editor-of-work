import { open, rename, rm } from 'node:fs/promises'
import { PdfRenderError } from './pdf-renderer'
import { randomUUID } from 'node:crypto'
import { err, ok } from '@eow/shared/kernel'
import type { PdfExporter, SheetPage } from '@eow/documents/application'

/** Временный файл рядом с целью: сбой до rename сохраняет прежний PDF. */
export async function writePdfAtomically(path: string, data: Uint8Array): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx')
    try {
      await file.writeFile(data)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}
export function pdfExporter(
  choosePath: (page: SheetPage) => Promise<string | undefined>,
  render: (page: SheetPage) => Promise<Uint8Array>,
  write = writePdfAtomically,
): PdfExporter {
  return {
    async export(page) {
      try {
        const chosen = await choosePath(page)
        if (!chosen) return ok('cancelled')
        if (!/\.pdf$/iu.test(chosen))
          return err({ message: 'Укажите имя файла с расширением .pdf.' })
        const path = chosen
        const data = await render(page)
        if (
          data.length < 5 ||
          data.length > 100 * 1024 * 1024 ||
          String.fromCharCode(...data.slice(0, 5)) !== '%PDF-'
        )
          return err({ message: 'Не удалось сформировать корректный PDF.' })
        await write(path, data)
        return ok('saved')
      } catch (error) {
        if (error instanceof PdfRenderError) return err({ message: error.message })
        return err({
          message: 'Не удалось сохранить PDF. Проверьте доступ к папке и повторите попытку.',
        })
      }
    },
  }
}
