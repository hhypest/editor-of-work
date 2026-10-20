import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'

export interface PassportMigration {
  readonly version: number
  readonly name: string
  readonly sql: string
}

const appliedSchema = z.array(
  z.object({ version: z.number().int(), name: z.string(), sha256: z.string() }),
)
const checksum = (source: string): string => createHash('sha256').update(source).digest('hex')

export async function loadPassportMigrations(
  directory: string,
): Promise<readonly PassportMigration[]> {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).toSorted()
  return Promise.all(
    files.map(async (name) => {
      const match = /^(\d{3})_[a-z_]+\.sql$/.exec(name)
      if (!match) throw new Error('Неверное имя миграции паспорта.')
      return { version: Number(match[1]), name, sql: await readFile(join(directory, name), 'utf8') }
    }),
  )
}

/** Проверка истории выполняется до любой записи. Вся цепочка откатывается при ошибке. */
export async function migratePassport(
  database: DatabaseSync,
  migrations: readonly PassportMigration[],
  beforeMigration: () => Promise<void>,
): Promise<void> {
  if (
    migrations.length === 0 ||
    migrations.some((migration, index) => migration.version !== index + 1)
  )
    throw new Error('Неполная последовательность миграций паспорта.')
  const exists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get()
  const applied = exists
    ? appliedSchema.parse(
        database
          .prepare('SELECT version, name, sha256 FROM schema_migrations ORDER BY version')
          .all(),
      )
    : []
  if (
    !exists &&
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .get()
  )
    throw new Error('Неизвестная схема паспорта: история миграций отсутствует.')
  if (applied.length > migrations.length)
    throw new Error('База паспорта создана более новой программой. Обновите программу.')
  for (const [index, row] of applied.entries()) {
    const expected = migrations[index]
    if (
      !expected ||
      row.version !== expected.version ||
      row.name !== expected.name ||
      row.sha256 !== checksum(expected.sql)
    )
      throw new Error('История миграций паспорта не совпадает с программой. База не изменена.')
  }
  const pending = migrations.slice(applied.length)
  if (!pending.length) return
  await beforeMigration()
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT',
    )
    for (const migration of pending) {
      database.exec(migration.sql)
      database
        .prepare(
          'INSERT INTO schema_migrations(version, name, sha256, applied_at) VALUES (?, ?, ?, ?)',
        )
        .run(migration.version, migration.name, checksum(migration.sql), new Date().toISOString())
    }
    const violations = database.prepare('PRAGMA foreign_key_check').all()
    if (violations.length) throw new Error('Миграция нарушает связи данных паспорта.')
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
