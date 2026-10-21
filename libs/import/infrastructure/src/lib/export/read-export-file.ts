import { createHash } from 'node:crypto'
import type { ExportFile, ExportSource, ExportTable, ExportError } from '@eow/import/application'
import { ok, type Result } from '@eow/shared/kernel'

/** Обычный файл — SHA-256 байтов; frameset — оболочка и все потреблённые части. */
export async function readExportFile(
  source: ExportSource,
  file: ExportFile,
): Promise<
  Result<{ readonly tables: readonly ExportTable[]; readonly sha256: string }, ExportError>
> {
  const mainSha256 = createHash('sha256').update(file.bytes).digest('hex')
  const parts: [string, string][] = []
  const sibling = file.sibling
  const read = await source.read({
    ...file,
    ...(sibling
      ? {
          sibling: async (relativePath: string) => {
            const bytes = await sibling(relativePath)
            if (bytes) parts.push([relativePath, createHash('sha256').update(bytes).digest('hex')])
            return bytes
          },
        }
      : {}),
  })
  if (!read.ok) return read
  const sha256 =
    parts.length === 0
      ? mainSha256
      : createHash('sha256')
          .update(JSON.stringify(['frameset-v1', mainSha256, parts]))
          .digest('hex')
  return ok({ tables: read.value, sha256 })
}
