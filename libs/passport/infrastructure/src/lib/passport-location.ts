import { constants } from 'node:fs'
import { access, mkdir, open, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

function unavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ['EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'EEXIST'].includes(String(error.code))
  )
}

async function writableDatabase(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true })
  const probe = join(directory, `.write-${randomUUID()}`)
  const file = await open(probe, 'wx')
  try {
    await file.close()
  } finally {
    await rm(probe, { force: true })
  }
  const path = join(directory, 'passport.sqlite')
  try {
    await access(path, constants.R_OK | constants.W_OK)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  return path
}

/** Только недоступность записи допускает резервный путь; повреждение БД его не меняет. */
export async function passportLocation(
  executableDirectory: string,
  localDataDirectory: string,
): Promise<string> {
  try {
    return await writableDatabase(join(executableDirectory, 'data'))
  } catch (error) {
    if (!unavailable(error)) throw error
    return writableDatabase(join(localDataDirectory, 'editor-of-work'))
  }
}
