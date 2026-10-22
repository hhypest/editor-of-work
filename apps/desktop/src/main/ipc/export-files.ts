import { open, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import type { ExportFile } from '@eow/import/application'

const MAX_FILE_BYTES = 64 * 1024 * 1024
export const MAX_EXPORT_BYTES = 128 * 1024 * 1024

export class ExportReadLimitError extends Error {}

/** Один бюджет на весь шаг: выбранные файлы и все прочитанные части frameset. */
export class ExportReadBudget {
  private retained = 0
  constructor(private readonly maximum = MAX_EXPORT_BYTES) {}

  reserve(size: number): void {
    if (size > this.maximum - this.retained)
      throw new ExportReadLimitError(
        'Общий размер выгрузок и связанных листов превышает лимит пакета. ' +
          'Допускается до 128 МиБ за шаг; уменьшите объём пакета, сохранив его комплектность.',
      )
    this.retained += size
  }
}

/** Резервируем размер до выделения буфера; рост файла не приводит к чтению сверх бюджета. */
async function boundedRead(path: string, budget: ExportReadBudget): Promise<Uint8Array> {
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > MAX_FILE_BYTES)
      throw new ExportReadLimitError(
        'Выгрузка или связанный лист должны быть файлом не более 64 МиБ.',
      )
    budget.reserve(info.size)
    const bytes = new Uint8Array(info.size)
    let offset = 0
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, null)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
    const extra = await file.read(new Uint8Array(1), 0, 1, null)
    if (offset !== bytes.length || extra.bytesRead !== 0)
      throw new ExportReadLimitError(
        'Размер файла изменился во время чтения. Выберите файлы заново.',
      )
    return bytes
  } finally {
    await file.close()
  }
}

/** Доступ к связанному листу frameset ограничен папкой выбранного файла, включая symlink. */
export async function selectedExportFile(
  path: string,
  budget = new ExportReadBudget(),
): Promise<ExportFile> {
  const source = await realpath(path)
  const root = dirname(source)
  return {
    name: basename(path),
    bytes: await boundedRead(source, budget),
    sibling: async (part) => {
      const normalized = part.replaceAll('\\', '/')
      if (isAbsolute(normalized) || normalized.includes('\0') || /^[a-z]+:/iu.test(normalized))
        return undefined
      try {
        const target = await realpath(resolve(root, normalized))
        const inside = relative(root, target)
        if (
          inside === '..' ||
          inside.startsWith('../') ||
          inside.startsWith('..\\') ||
          isAbsolute(inside)
        )
          return undefined
        return await boundedRead(target, budget)
      } catch (error) {
        if (error instanceof ExportReadLimitError) throw error
        return undefined
      }
    },
  }
}
