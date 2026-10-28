import { randomUUID } from 'node:crypto'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { PassportBackup, PassportBackupReason } from '@eow/passport/application'

/** Сколько последних копий хранится в папке backups (ADR-0043). */
export const MAX_PASSPORT_BACKUPS = 10

const REASONS: readonly PassportBackupReason[] = ['migration', 'activation', 'restore']
const NAME =
  /^passport-(migration|activation|restore)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2}\.\d{3})Z-[0-9a-f-]{36}\.sqlite$/u

/** Имя новой копии: повод и время в UTC, двоеточия заменены — они недопустимы в Windows. */
export function backupName(reason: PassportBackupReason, now: Date): string {
  return `passport-${reason}-${now.toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`
}

/** Повод и время копии по имени файла; чужие файлы в папке не считаются копиями. */
export function parseBackupName(
  name: string,
): { readonly reason: PassportBackupReason; readonly createdAt: string } | undefined {
  const match = NAME.exec(name)
  if (!match) return undefined
  const [, reason, date, hours, minutes, seconds] = match
  const createdAt = `${date}T${hours}:${minutes}:${seconds}Z`
  if (Number.isNaN(Date.parse(createdAt))) return undefined
  return { reason: reason as (typeof REASONS)[number], createdAt }
}

/** Копии новые сначала: по времени из имени, затем по имени. */
async function backupFiles(directory: string): Promise<readonly string[]> {
  const names = await readdir(directory).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  })
  return names
    .filter((name) => parseBackupName(name))
    .toSorted((a, b) => {
      const left = parseBackupName(a)?.createdAt ?? ''
      const right = parseBackupName(b)?.createdAt ?? ''
      return right.localeCompare(left) || b.localeCompare(a)
    })
}

/**
 * Редакции копии и причина, по которой её нельзя восстановить. Копия открывается только
 * для чтения: список не меняет файлы и не запускает миграций.
 */
export function inspectBackup(
  path: string,
  migrations: number,
): Pick<PassportBackup, 'editions' | 'problem'> {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(path, { readOnly: true })
    const applied = database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as {
      count: number
    }
    if (applied.count > migrations)
      return { editions: [], problem: 'Копия создана более новой программой.' }
    const editions = database
      .prepare('SELECT number, date, label, status FROM edition ORDER BY number')
      .all() as unknown as PassportBackup['editions']
    return { editions }
  } catch {
    return { editions: [], problem: 'Файл копии повреждён или не является базой паспорта.' }
  } finally {
    database?.close()
  }
}

export async function listBackups(
  directory: string,
  migrations: number,
): Promise<readonly PassportBackup[]> {
  const result: PassportBackup[] = []
  for (const name of await backupFiles(directory)) {
    const parsed = parseBackupName(name)
    if (!parsed) continue
    const path = join(directory, name)
    const info = await stat(path).catch(() => undefined)
    if (!info?.isFile()) continue
    result.push({ id: name, ...parsed, bytes: info.size, ...inspectBackup(path, migrations) })
  }
  return result
}

/**
 * Оставляет MAX_PASSPORT_BACKUPS последних копий. Файлы из keep не удаляются никогда:
 * только что созданная копия и копия, которую восстанавливают.
 */
export async function pruneBackups(directory: string, keep: readonly string[]): Promise<void> {
  const files = await backupFiles(directory)
  const kept = new Set(keep)
  let remaining = MAX_PASSPORT_BACKUPS - kept.size
  for (const name of files) {
    if (kept.has(name)) continue
    if (remaining > 0) {
      remaining--
      continue
    }
    await rm(join(directory, name), { force: true })
  }
}
