import { backup, DatabaseSync } from 'node:sqlite'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { sql, type Kysely } from 'kysely'
import { z } from 'zod'
import { err, ok, type Result } from '@eow/shared/kernel'
import { canActivate, validateEdition } from '@eow/passport/domain'
import type {
  EditionData,
  EditionInput,
  PassportEdition,
  PassportEditionData,
  PassportError,
  PassportStore,
  PassportBackup,
  PassportBackupReason,
  PassportBackups,
  RepairReportSource,
  RepairSnapshot,
  PassportPlanningSource,
  PlanningEditionData,
} from '@eow/passport/application'
import {
  SEGMENT_FORMS,
  STATION_FORMS,
  type PassportStationImport,
  type StationBasis,
  type StationImport,
  type StationImportFile,
  type StationRow,
  type StationExclusion,
  type PassportOrgImport,
  type OrgImport,
  type OrgImportFile,
  type PassportSegmentImport,
  type SegmentBasis,
  type SegmentImport,
  type SegmentImportFile,
  type SegmentRow,
} from '@eow/passport/import-api'
import { sqliteQueries } from './sqlite-dialect'
import { editionTables } from './edition-tables'
import { loadPassportMigrations, migratePassport, type PassportMigration } from './migrations'
import { backupName, listBackups, parseBackupName, pruneBackups } from './passport-backups'
import { passportLocation, type PassportLocationChooser } from './passport-location'
import { orgFileSchema, orgImportSchema } from './org-import-schema'
import { writeOrgImport, type PassportSchema as Schema } from './org-import-storage'
import { segmentFileSchema, segmentImportSchema } from './segment-import-schema'
import { readSegmentBasis, readSegmentData, writeSegmentImport } from './segment-import-storage'
import {
  stationExclusionsSchema,
  stationFileSchema,
  stationImportSchema,
} from './station-import-schema'
import {
  readStationBasis,
  readStationData,
  writeStationImport,
  writeStationExclusions,
} from './station-import-storage'
import { manualFileSchema, manualImportSchema } from './manual-data-schema'
import { readManualBasis, writeManualData } from './manual-data-storage'
import { readEditionData, readPlanningData, editionTokenMatches } from './edition-data'
import { readRepairSnapshot } from './repair-snapshot'
import type {
  ManualBasis,
  ManualImport,
  ManualImportFile,
  PassportManualData,
} from '@eow/passport/import-api'
const editionSchema = z.object({
  id: z.number().int().positive(),
  number: z.number().int().positive(),
  date: z.string(),
  label: z.string(),
  status: z.enum(['draft', 'active', 'archived']),
})
const stalePreview = (): PassportError => ({
  kind: 'invalid-import',
  message: 'Паспорт изменился после предпросмотра. Подготовьте импорт заново.',
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

export interface PassportDatabase
  extends
    PassportStore,
    PassportEditionData,
    PassportPlanningSource,
    RepairReportSource,
    PassportOrgImport,
    PassportSegmentImport,
    PassportStationImport,
    PassportManualData,
    PassportBackups {
  readonly path: string
  close(): Promise<void>
}

/** Копия базы в backups рядом с ней; затем лишние старые копии удаляются (ADR-0043). */
async function copyDatabase(
  database: DatabaseSync,
  path: string,
  reason: PassportBackupReason,
  protect: readonly string[] = [],
): Promise<string> {
  const directory = join(dirname(path), 'backups')
  await mkdir(directory, { recursive: true })
  const name = backupName(reason, new Date())
  const destination = join(directory, name)
  try {
    await backup(database, destination)
  } catch (error) {
    await rm(destination, { force: true }).catch(() => undefined)
    throw error
  }
  // Очистка не должна срывать изменение, ради которого сделана копия.
  await pruneBackups(directory, [name, ...protect]).catch(() => undefined)
  return name
}

/** Открытие файла базы: настройки, миграции с копией до них, WAL, адаптер Kysely. */
async function connect(
  path: string,
  migrations: readonly PassportMigration[],
  existing: boolean,
): Promise<{ readonly database: DatabaseSync; readonly queries: Kysely<Schema> }> {
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
    return { database, queries }
  } catch (error) {
    database.close()
    throw error
  }
}

const backupError = (message: string): PassportError => ({ kind: 'not-found', message })

class SqlitePassportStore implements PassportDatabase {
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false
  private closed: Promise<void> | undefined

  // Восстановление копии заменяет соединение; остальные операции ждут его в общей очереди.
  private database: DatabaseSync
  private queries: Kysely<Schema>

  constructor(
    readonly path: string,
    connection: { readonly database: DatabaseSync; readonly queries: Kysely<Schema> },
    private readonly migrations: readonly PassportMigration[],
  ) {
    this.database = connection.database
    this.queries = connection.queries
  }

  private get backupDirectory(): string {
    return join(dirname(this.path), 'backups')
  }

  backups(): Promise<Result<readonly PassportBackup[], PassportError>> {
    return this.operation(async () =>
      ok(await listBackups(this.backupDirectory, this.migrations.length)),
    )
  }

  /**
   * Замена базы копией: сначала копия текущей базы (повод restore), затем файл копии
   * подменяет базу и открывается с миграциями. При сбое возвращается прежняя база.
   */
  restoreBackup(id: string): Promise<Result<void, PassportError>> {
    return this.operation(async () => {
      if (basename(id) !== id || !parseBackupName(id))
        return err(backupError('Резервная копия не найдена.'))
      const listed = (await listBackups(this.backupDirectory, this.migrations.length)).find(
        (backup) => backup.id === id,
      )
      if (!listed) return err(backupError('Резервная копия не найдена.'))
      if (listed.problem) return err({ kind: 'invalid-edition', message: listed.problem })
      const current = await copyDatabase(this.database, this.path, 'restore', [id])
      const staged = `${this.path}.restoring`
      await copyFile(join(this.backupDirectory, id), staged)
      await this.queries.destroy()
      try {
        await rm(`${this.path}-wal`, { force: true })
        await rm(`${this.path}-shm`, { force: true })
        await rename(staged, this.path)
        this.replace(await connect(this.path, this.migrations, true))
        return ok(undefined)
      } catch {
        await rm(staged, { force: true }).catch(() => undefined)
        await copyFile(join(this.backupDirectory, current), this.path)
        this.replace(await connect(this.path, this.migrations, true))
        return err({
          kind: 'storage',
          message: 'Не удалось восстановить копию. Прежняя база паспорта оставлена без изменений.',
        })
      }
    })
  }

  private replace(connection: {
    readonly database: DatabaseSync
    readonly queries: Kysely<Schema>
  }): void {
    this.database = connection.database
    this.queries = connection.queries
  }

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
        if (!(await editionTokenMatches(transaction, id, data.expectedEditionToken)))
          return err(stalePreview())
        return writeOrgImport(transaction, id, data)
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

  segmentBasis(id: number): Promise<Result<SegmentBasis, PassportError>> {
    return this.operation(() =>
      this.queries.transaction().execute(async (transaction) => {
        const basis = await readSegmentBasis(transaction, id)
        return basis ? ok(basis) : err(absent())
      }),
    )
  }

  editionData(id: number): Promise<Result<EditionData, PassportError>> {
    return this.operation(() =>
      this.queries.transaction().execute(async (db) => {
        const data = await readEditionData(db, id)
        return data ? ok(data) : err(absent())
      }),
    )
  }

  repairSnapshot(id: number): Promise<Result<RepairSnapshot, PassportError>> {
    return this.operation(() =>
      this.queries.transaction().execute(async (db) => {
        const snapshot = await readRepairSnapshot(db, id)
        return snapshot ? ok(snapshot) : err(absent())
      }),
    )
  }

  planningData(id: number): Promise<Result<PlanningEditionData, PassportError>> {
    return this.operation(() =>
      this.queries.transaction().execute(async (db) => {
        const data = await readPlanningData(db, id)
        return data ? ok(data) : err(absent())
      }),
    )
  }

  applySegmentImport(id: number, input: SegmentImport): Promise<Result<void, PassportError>> {
    const parsed = segmentImportSchema.safeParse(input)
    if (!parsed.success)
      return Promise.resolve(
        err({
          kind: 'invalid-import',
          message:
            parsed.error.issues.find((i) => i.code === 'custom')?.message ??
            'Неверные данные характеристик. Проверьте поля, даты и контрольные суммы.',
        }),
      )
    return this.operation(() =>
      this.queries.transaction().execute(async (transaction) => {
        const edition = await transaction
          .selectFrom('edition')
          .select('status')
          .where('id', '=', id)
          .executeTakeFirst()
        if (!edition) return err(absent())
        if (edition.status !== 'draft')
          return err({ kind: 'immutable', message: 'Импорт разрешён только в черновик редакции.' })
        if (!(await editionTokenMatches(transaction, id, parsed.data.expectedEditionToken)))
          return err(stalePreview())
        return writeSegmentImport(transaction, id, parsed.data)
      }),
    )
  }

  segmentImportReport(id: number): Promise<Result<readonly SegmentImportFile[], PassportError>> {
    return this.operation(async () => {
      if (
        !(await this.queries
          .selectFrom('edition')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst())
      )
        return err(absent())
      const files = await this.queries
        .selectFrom('import_file')
        .selectAll()
        .where('edition_id', '=', id)
        .where('form', 'in', SEGMENT_FORMS)
        .orderBy('id')
        .execute()
      return ok(
        files.map((f) =>
          segmentFileSchema.parse({
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

  segmentData(id: number): Promise<Result<readonly SegmentRow[], PassportError>> {
    return this.operation(async () => {
      if (
        !(await this.queries
          .selectFrom('edition')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst())
      )
        return err(absent())
      return ok(await readSegmentData(this.queries, id))
    })
  }

  manualImportReport(id: number): Promise<Result<readonly ManualImportFile[], PassportError>> {
    return this.operation(async () => {
      if (
        !(await this.queries
          .selectFrom('edition')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst())
      )
        return err(absent())
      const files = await this.queries
        .selectFrom('import_file')
        .selectAll()
        .where('edition_id', '=', id)
        .where('form', '=', 'manual-data')
        .orderBy('id')
        .execute()
      return ok(
        files.map((f) =>
          manualFileSchema.parse({
            id: f.id,
            form: f.form,
            name: f.name,
            importedAt: f.imported_at,
            sha256: f.sha256,
            rowCount: f.row_count,
            warnings: JSON.parse(f.warnings),
          }),
        ),
      )
    })
  }
  manualBasis(id: number): Promise<Result<ManualBasis, PassportError>> {
    return this.operation(() =>
      this.queries.transaction().execute(async (db) => {
        const basis = await readManualBasis(db, id)
        return basis ? ok(basis) : err(absent())
      }),
    )
  }
  applyManualData(id: number, input: ManualImport): Promise<Result<void, PassportError>> {
    const parsed = manualImportSchema.safeParse(input)
    if (!parsed.success)
      return Promise.resolve(
        err({
          kind: 'invalid-import',
          message: 'Неверные ручные данные, даты или описание файла.',
        }),
      )
    return this.operation(() =>
      this.queries.transaction().execute(async (db) => {
        const edition = await db
          .selectFrom('edition')
          .select('status')
          .where('id', '=', id)
          .executeTakeFirst()
        if (!edition) return err(absent())
        if (edition.status !== 'draft')
          return err({
            kind: 'immutable',
            message: 'Ручные данные меняются только в черновике редакции.',
          })
        return writeManualData(db, id, parsed.data)
      }),
    )
  }
  stationBasis(id: number): Promise<Result<StationBasis, PassportError>> {
    return this.operation(() =>
      this.queries.transaction().execute(async (db) => {
        const basis = await readStationBasis(db, id)
        return basis ? ok(basis) : err(absent())
      }),
    )
  }
  applyStationImport(id: number, input: StationImport): Promise<Result<void, PassportError>> {
    const parsed = stationImportSchema.safeParse(input)
    if (!parsed.success)
      return Promise.resolve(
        err({
          kind: 'invalid-import',
          message:
            parsed.error.issues.find((i) => i.code === 'custom')?.message ??
            'Неверные станционные данные. Проверьте координаты, даты и поля.',
        }),
      )
    return this.stationDraft(id, async (db) => {
      if (!(await editionTokenMatches(db, id, parsed.data.expectedEditionToken)))
        return err(stalePreview())
      return writeStationImport(db, id, parsed.data)
    })
  }
  setStationExclusions(
    id: number,
    input: readonly StationExclusion[],
  ): Promise<Result<void, PassportError>> {
    const parsed = stationExclusionsSchema.safeParse(input)
    if (!parsed.success)
      return Promise.resolve(
        err({
          kind: 'invalid-import',
          message: 'Укажите уникальные названия исключённых станций и причины.',
        }),
      )
    return this.stationDraft(id, (db) => writeStationExclusions(db, id, parsed.data))
  }
  private stationDraft(
    id: number,
    write: (db: Kysely<Schema>) => Promise<Result<void, PassportError>>,
  ): Promise<Result<void, PassportError>> {
    return this.operation(() =>
      this.queries.transaction().execute(async (db) => {
        const edition = await db
          .selectFrom('edition')
          .select('status')
          .where('id', '=', id)
          .executeTakeFirst()
        if (!edition) return err(absent())
        if (edition.status !== 'draft')
          return err({
            kind: 'immutable',
            message: 'Станционный импорт и исключения разрешены только в черновике редакции.',
          })
        return write(db)
      }),
    )
  }
  stationImportReport(id: number): Promise<Result<readonly StationImportFile[], PassportError>> {
    return this.operation(async () => {
      if (
        !(await this.queries
          .selectFrom('edition')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst())
      )
        return err(absent())
      const files = await this.queries
        .selectFrom('import_file')
        .selectAll()
        .where('edition_id', '=', id)
        .where('form', 'in', STATION_FORMS)
        .orderBy('id')
        .execute()
      return ok(
        files.map((f) =>
          stationFileSchema.parse({
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
  stationData(id: number): Promise<Result<readonly StationRow[], PassportError>> {
    return this.operation(async () => {
      if (
        !(await this.queries
          .selectFrom('edition')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst())
      )
        return err(absent())
      return ok(await readStationData(this.queries, id))
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
  return new SqlitePassportStore(path, await connect(path, migrations, existing), migrations)
}

export async function openPortablePassport(options: {
  readonly executableDirectory: string
  readonly localDataDirectory: string
  readonly migrationsDirectory: string
  readonly chooseLocation?: PassportLocationChooser
}): Promise<PassportDatabase> {
  const path = await passportLocation(
    options.executableDirectory,
    options.localDataDirectory,
    options.chooseLocation,
  )
  return openPassportDatabase(path, options.migrationsDirectory)
}
