import { constants } from 'node:fs'
import { access, mkdir, open, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export interface PassportLocations {
  readonly portablePath: string
  readonly localPath: string
}

export type PassportLocationChooser = (
  locations: PassportLocations,
) => Promise<'portable' | 'local' | undefined>

export class PassportLocationCancelled extends Error {
  constructor() {
    super('Открытие паспорта отменено.')
  }
}

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

async function writableDatabase(directory: string, requireExisting = false): Promise<string> {
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
    if (requireExisting || !(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error
  }
  return path
}

/** Только недоступность записи допускает резервный путь; повреждение БД его не меняет. */
export async function passportLocation(
  executableDirectory: string,
  localDataDirectory: string,
  chooseLocation?: PassportLocationChooser,
): Promise<string> {
  const primary = join(executableDirectory, 'data')
  const fallback = join(localDataDirectory, 'editor-of-work')
  const portablePath = join(primary, 'passport.sqlite')
  const localPath = join(fallback, 'passport.sqlite')
  const primaryExists = await exists(portablePath).catch((error: unknown) => {
    if (unavailable(error)) return false
    throw error
  })
  const fallbackExists = await exists(localPath).catch((error: unknown) => {
    // При отсутствующей primary неизвестное состояние прежней локальной базы
    // не должно разрешать создание пустой базы рядом с программой.
    if (primaryExists && unavailable(error)) return false
    throw error
  })
  if (primaryExists && fallbackExists) {
    // Даже при общем inode журналы WAL/SHM у разных путей могут различаться.
    if (!chooseLocation)
      throw new Error('Найдены две базы паспорта. Перед открытием необходимо выбрать базу.')
    const choice = await chooseLocation(Object.freeze({ portablePath, localPath }))
    if (choice === undefined) throw new PassportLocationCancelled()
    // После явного выбора недоступность не должна открывать другую базу.
    return writableDatabase(choice === 'portable' ? primary : fallback, true)
  }
  // Восстановление прав не должно создавать пустую базу вместо уже используемой.
  if (!primaryExists && fallbackExists) return writableDatabase(fallback)
  try {
    return await writableDatabase(primary)
  } catch (error) {
    if (!unavailable(error)) throw error
    return writableDatabase(fallback)
  }
}
