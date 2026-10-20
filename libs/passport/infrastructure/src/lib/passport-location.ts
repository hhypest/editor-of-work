import { constants } from 'node:fs'
import { access, mkdir, open, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

function unavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ['EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'EEXIST'].includes(String(error.code))
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR'].includes(String(error.code))
    )
      return false
    throw error
  }
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
  const primary = join(executableDirectory, 'data')
  const fallback = join(localDataDirectory, 'editor-of-work')
  const primaryExists = await exists(join(primary, 'passport.sqlite')).catch((error: unknown) => {
    if (unavailable(error)) return false
    throw error
  })
  // Восстановление прав не должно создавать пустую базу вместо уже используемой.
  if (!primaryExists && (await exists(join(fallback, 'passport.sqlite'))))
    return writableDatabase(fallback)
  try {
    return await writableDatabase(primary)
  } catch (error) {
    if (!unavailable(error)) throw error
    return writableDatabase(fallback)
  }
}
