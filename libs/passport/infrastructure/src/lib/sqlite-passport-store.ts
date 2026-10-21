import { backup, DatabaseSync } from 'node:sqlite'
import { mkdir, stat, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sql, type Kysely } from 'kysely'
import { z } from 'zod'
import { err, ok, type Result } from '@eow/shared/kernel'
import { canActivate, validateEdition } from '@eow/passport/domain'
import type {
  EditionInput,
  PassportEdition,
  PassportError,
  PassportStore,
} from '@eow/passport/application'
import type { PassportOrgImport, OrgImport, OrgImportFile } from '@eow/passport/import-api'
import { sqliteQueries } from './sqlite-dialect'
import { editionTables } from './edition-tables'
import { loadPassportMigrations, migratePassport } from './migrations'
import { passportLocation } from './passport-location'
import { orgFileSchema, orgImportSchema } from './org-import-schema'
import { writeOrgImport, type PassportSchema as Schema } from './org-import-storage'
const editionSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  date: z.string(),
  label: z.string(),
  status: z.enum(['draft', 'active', 'archived']),
})
const storageError = (): PassportError => ({
  kind: 'storage',
  message:
    'Не удалось сохранить паспорт. Проверьте доступ к папке и свободное место. Исходные редакции сохранены.',
})
const absent = (): PassportError => ({
  kind: 'not-found',
  message: 'Редакция паспорта не найдена.',
})

export interface PassportDatabase extends PassportStore, PassportOrgImport {
  readonly path: string
  close(): Promise<void>
}

async function copyDatabase(database: DatabaseSync, path: string, reason: string): Promise<void> {
  const directory = join(dirname(path), 'backups')
  await mkdir(directory, { recursive: true })
  const timestamp = new Date().toISOString().replaceAll(':', '-')
  const destination = join(directory, `passport-${reason}-${timestamp}-${randomUUID()}.sqlite`)
  try {
    await backup(database, destination)
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined)
    throw error
  }
}

class SqlitePassportStore implements PassportDatabase {
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false
  private closed: Promise<void> | undefined

  constructor(
    readonly path: string,
    private readonly database: DatabaseSync,
    private readonly queries: Kysely<Schema>,
  ) {}

  /** Backup API асинхронен: очередь не даёт другому запросу изменить его исходное состояние. */
  private operation<T>(
    work: () => Promise<Result<T, PassportError>>,
  ): Promise<Result<T, PassportError>> {
    if (this.closing) return Promise.resolve(err(storageError()))
    const result = this.tail.then(work).catch(() => err(storageError()))
    this.tail = result
    return result
  }

  list(): Promise<Result<readonly PassportEdition[], PassportError>> {
    return this.operation(async () => {
      const rows = await this.queries.selectFrom('edition').selectAll().orderBy('number').execute()
      return ok(Object.freeze(rows.map((row) => Object.freeze(editionSchema.parse(row)))))
    })
  }

  applyOrgImport(id: number, input: OrgImport): Promise<Result<void, PassportError>> {
    // Отделяем команду от изменяемого объекта вызывающего до ожидания очереди.
    const parsed = orgImportSchema.safeParse(input)
    if (!parsed.success)
      return Promise.resolve(
        err({
          kind: 'invalid-import',
          message:
            parsed.error.issues.find((issue) => issue.code === 'custom')?.message ??
            'Неверные данные импорта. Проверьте даты, контрольные суммы и обязательные поля.',
        }),
      )
    const data = parsed.data
    return this.operation(() =>
      this.queries.transaction().execute(async (transaction) => {
        const edition = await transaction
          .selectFrom('edition')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()
        if (!edition) return err(absent())
        if (edition.status !== 'draft')
          return err({ kind: 'immutable', message: 'Импорт разрешён только в черновик редакции.' })
        if (edition.date !== data.date)
          return err({
            kind: 'invalid-import',
            message: 'Дата импорта не совпадает с датой редакции. Повторите отбор строк.',
          })
        await writeOrgImport(transaction, id, data)
        return ok(undefined)
      }),
    )
  }

  orgImportReport(id: number): Promise<Result<readonly OrgImportFile[], PassportError>> {
    return this.operation(async () => {
      const edition = await this.queries
        .selectFrom('edition')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst()
      if (!edition) return err(absent())
      const files = await this.queries
        .selectFrom('import_file')
        .selectAll()
        .where('edition_id', '=', id)
        .where('form', 'in', ['subdivisions', 'boundaries', 'station-pd', 'track-pd'])
        .orderBy('id')
        .execute()
      return ok(
        files.map((f) =>
          orgFileSchema.parse({
            id: f.id,
            name: f.name,
            form: f.form,
            sha256: f.sha256,
            importedAt: f.imported_at,
            rowCount: f.row_count,
            warnings: JSON.parse(f.warnings),
          }),
        ),
      )
    })
  }

  createDraft(input: EditionInput): Promise<Result<PassportEdition, PassportError>> {
    const validated = validateEdition(input)
    if (!validated.ok) return Promise.resolve(validated)
    return this.operation(() =>
      this.queries.transaction().execute(async (transaction) => {
        const latest = await transaction
          .selectFrom('edition')
          .select('number')
          .orderBy('number', 'desc')
          .executeTakeFirst()
        const active = await transaction
          .selectFrom('edition')
          .select('id')
          .where('status', '=', 'active')
          .executeTakeFirst()
        const created = await transaction
          .insertInto('edition')
          .values({ ...validated.value, number: (latest?.number ?? 0) + 1, status: 'draft' })
          .returningAll()
          .executeTakeFirstOrThrow()
        if (active) {
          for (const table of editionTables) {
            // Имена берутся только из встроенного списка и схемы, не из IPC или файла пользователя.
            const columns = z
              .array(z.object({ name: z.string() }))
              .parse(this.database.prepare(`PRAGMA table_info("${table}")`).all())
              .map((column) => column.name)
              .filter((name) => name !== 'edition_id')
            const names = columns.map((name) => sql.id(name))
            await sql`INSERT INTO ${sql.table(table)} (edition_id, ${sql.join(names)}) SELECT ${created.id}, ${sql.join(names)} FROM ${sql.table(table)} WHERE edition_id = ${active.id}`.execute(
              transaction,
            )
          }
        }
        return ok(Object.freeze(editionSchema.parse(created)))
      }),
    )
  }

  activate(id: number): Promise<Result<PassportEdition, PassportError>> {
    return this.operation(async () => {
      const row = await this.queries
        .selectFrom('edition')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()
      if (!row) return err(absent())
      const edition = editionSchema.parse(row)
      const allowed = canActivate(edition)
      if (!allowed.ok) return allowed
      await copyDatabase(this.database, this.path, 'activation')
      return this.queries.transaction().execute(async (transaction) => {
        await transaction
          .updateTable('edition')
          .set({ status: 'archived' })
          .where('status', '=', 'active')
          .execute()
        const activated = await transaction
          .updateTable('edition')
          .set({ status: 'active' })
          .where('id', '=', id)
          .where('status', '=', 'draft')
          .returningAll()
          .executeTakeFirstOrThrow()
        return ok(Object.freeze(editionSchema.parse(activated)))
      })
    })
  }

  close(): Promise<void> {
    this.closing = true
    this.closed ??= this.tail.then(() => this.queries.destroy())
    return this.closed
  }
}

/** Открывает выбранный main путь. Ошибка схемы или копирования останавливает открытие. */
export async function openPassportDatabase(
  path: string,
  migrationsDirectory: string,
): Promise<PassportDatabase> {
  const existing = await stat(path)
    .then(() => true)
    .catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
      throw error
    })
  const migrations = await loadPassportMigrations(migrationsDirectory)
  const database = new DatabaseSync(path)
  try {
    database.exec(
      'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;',
    )
    await migratePassport(database, migrations, async () => {
      if (existing) await copyDatabase(database, path, 'migration')
    })
    // Режим журнала меняет файл: только после проверки совместимости и копии до миграции.
    database.exec('PRAGMA journal_mode = WAL')
    const queries = sqliteQueries<Schema>(database)
    // Инициализируем драйвер до передачи владения close() адаптеру.
    await sql`SELECT 1`.execute(queries)
    return new SqlitePassportStore(path, database, queries)
  } catch (error) {
    database.close()
    throw error
  }
}

export async function openPortablePassport(options: {
  readonly executableDirectory: string
  readonly localDataDirectory: string
  readonly migrationsDirectory: string
}): Promise<PassportDatabase> {
  const path = await passportLocation(options.executableDirectory, options.localDataDirectory)
  return openPassportDatabase(path, options.migrationsDirectory)
}
