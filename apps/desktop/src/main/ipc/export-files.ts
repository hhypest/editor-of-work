import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import type { ExportFile } from '@eow/import/application'

/** Доступ к связанному листу frameset ограничен папкой выбранного файла, включая symlink. */
export async function selectedExportFile(path: string): Promise<ExportFile> {
  const source = await realpath(path)
  const root = dirname(source)
  const boundedRead = async (file: string): Promise<Uint8Array> => {
    const info = await stat(file)
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('Некорректный размер файла')
    return readFile(file)
  }
  return {
    name: basename(path),
    bytes: await boundedRead(source),
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
        return await boundedRead(target)
      } catch {
        return undefined
      }
    },
  }
}
