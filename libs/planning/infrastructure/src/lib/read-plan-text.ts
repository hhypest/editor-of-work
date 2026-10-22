import { open } from 'node:fs/promises'

/** 20 МиБ UTF-16 в IPC: до 4 байт UTF-8 на единицу с запасом для прежних файлов. */
export const MAX_PLAN_FILE_BYTES = 80 * 1024 * 1024
export class PlanTextReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanTextReadError'
  }
}
interface PlanTextFile {
  stat(): Promise<{ readonly size: number; isFile(): boolean }>
  read(buffer: Uint8Array): Promise<{ readonly bytesRead: number }>
}
/** Проверяется и заявленный размер, и каждый фактически прочитанный блок. */
export async function readBoundedPlanText(
  file: PlanTextFile,
  limit = MAX_PLAN_FILE_BYTES,
): Promise<string> {
  const info = await file.stat()
  if (!info.isFile())
    throw new PlanTextReadError('Выберите обычный файл плана или проекта прототипа.')
  const tooLarge = (): PlanTextReadError =>
    new PlanTextReadError(
      'Файл плана или проекта прототипа превышает допустимый размер чтения (80 МиБ).',
    )
  if (info.size > limit) throw tooLarge()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total))
    const { bytesRead } = await file.read(chunk)
    if (!bytesRead) break
    total += bytesRead
    if (total > limit) throw tooLarge()
    chunks.push(chunk.subarray(0, bytesRead))
  }
  return Buffer.concat(chunks, total).toString('utf8')
}
export async function readPlanText(path: string): Promise<string | undefined> {
  let file
  try {
    file = await open(path, 'r')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  }
  try {
    return await readBoundedPlanText(file)
  } finally {
    await file.close()
  }
}
