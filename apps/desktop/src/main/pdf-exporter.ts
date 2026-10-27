import { access, constants, copyFile, link, open, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { PdfRenderError } from './pdf-renderer'
import { randomUUID } from 'node:crypto'
import { err, ok } from '@eow/shared/kernel'
import type { PdfBatchWriter, PdfExporter, SheetPage } from '@eow/documents/application'

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
export class PdfExistsError extends Error {}
/**
 * Запись без замены: готовый временный файл становится целью жёсткой ссылкой, которая
 * не создаётся поверх существующего файла. На томах без жёстких ссылок (FAT32 флешки)
 * — копия с флагом «только новый файл». Существующий файл не меняется никогда.
 */
export async function writePdfExclusively(path: string, data: Uint8Array): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx')
    try {
      await file.writeFile(data)
      await file.sync()
    } finally {
      await file.close()
    }
    try {
      await link(temporary, path)
    } catch (error) {
      if (codeOf(error) === 'EEXIST') throw new PdfExistsError(basename(path))
      try {
        await copyFile(temporary, path, constants.COPYFILE_EXCL)
      } catch (copyError) {
        if (codeOf(copyError) === 'EEXIST') throw new PdfExistsError(basename(path))
        throw copyError
      }
    }
  } finally {
    await rm(temporary, { force: true })
  }
}
function codeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}
const MAX_PDF_FILE_BYTES = 512 * 1024 * 1024
function validPdf(data: Uint8Array): boolean {
  return (
    data.length >= 5 &&
    data.length <= MAX_PDF_FILE_BYTES &&
    String.fromCharCode(...data.slice(0, 5)) === '%PDF-'
  )
}
export function pdfExporter(
  choosePath: (page: SheetPage) => Promise<string | undefined>,
  render: (pages: readonly SheetPage[]) => Promise<Uint8Array>,
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
        const data = await render([page])
        if (!validPdf(data)) return err({ message: 'Не удалось сформировать корректный PDF.' })
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

/** Пакет листов: диалоги main, проверка занятых имён и атомарная запись каждого файла. */
export function pdfBatchWriter(
  dialogs: {
    chooseFile(defaultName: string): Promise<string | undefined>
    chooseFolder(): Promise<string | undefined>
  },
  render: (pages: readonly SheetPage[]) => Promise<Uint8Array>,
  write = writePdfAtomically,
  writeNew = writePdfExclusively,
): PdfBatchWriter {
  return {
    chooseFile: (name) => dialogs.chooseFile(name),
    chooseFolder: () => dialogs.chooseFolder(),
    join: (folder, name) => join(folder, name),
    async existing(folder, names) {
      const taken: string[] = []
      for (const name of names)
        if (
          await access(join(folder, name)).then(
            () => true,
            () => false,
          )
        )
          taken.push(name)
      return taken
    },
    async write(path, pages, options) {
      try {
        const data = await render(pages)
        if (!validPdf(data)) return err({ message: 'Не удалось сформировать корректный PDF.' })
        await (options.replace ? write : writeNew)(path, data)
        return ok(undefined)
      } catch (error) {
        if (error instanceof PdfRenderError) return err({ message: error.message })
        if (error instanceof PdfExistsError)
          return err({
            message: `Файл «${error.message}» появился в папке во время сохранения и не перезаписан.`,
          })
        return err({
          message: 'Не удалось сохранить PDF. Проверьте доступ к папке и повторите попытку.',
        })
      }
    },
  }
}
