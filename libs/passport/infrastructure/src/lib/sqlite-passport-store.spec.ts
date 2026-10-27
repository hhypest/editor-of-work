import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir, rename, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
import type { Result } from '@eow/shared/kernel'
import {
  openPassportDatabase,
  openPortablePassport,
  type PassportDatabase,
} from './sqlite-passport-store'
import { loadPassportMigrations, migratePassport } from './migrations'
import { editionTables } from './edition-tables'
import { seedPassport } from './testing/passport-fixture'
import { PassportLocationCancelled, type PassportLocationChooser } from './passport-location'

const migrations = resolve(import.meta.dirname, '../../migrations')
const input = { date: '2027-01-01', label: 'Учебный паспорт' }
function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error('Ожидался успешный результат')
  return result.value
}

describe('SQLite паспорта', () => {
  let root: string
  let path: string
  let stores: PassportDatabase[]
  let connections: DatabaseSync[]
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-passport-'))
    path = join(root, 'passport.sqlite')
    stores = []
    connections = []
  })
  afterEach(async () => {
    for (const database of connections) database.close()
    for (const store of stores) await store.close()
    await rm(root, { recursive: true, force: true })
  })
  async function open(): Promise<PassportDatabase> {
    const store = await openPassportDatabase(path, migrations)
    stores.push(store)
    return store
  }
  function inspect(file = path): DatabaseSync {
    const database = new DatabaseSync(file)
    database.exec('PRAGMA foreign_keys = ON')
    connections.push(database)
    return database
  }
  async function backups(): Promise<string[]> {
    return (await readdir(join(root, 'backups')))
      .filter((name) => name.endsWith('.sqlite'))
      .map((name) => join(root, 'backups', name))
  }

  it('создаёт все таблицы, WAL и сохраняет редакции при повторном открытии', async () => {
    const store = await open()
    expect(value(await store.list())).toEqual([])
    const draft = value(await store.createDraft(input))
    await store.close()
    const reopened = await open()
    expect(value(await reopened.list())).toEqual([draft])
    const database = inspect()
    expect(database.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' })
    expect(database.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toMatchObject({
      n: 7,
    })
    for (const table of editionTables)
      expect(database.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toMatchObject({ n: 0 })
    expect(await readdir(root)).not.toContain('backups')
  })

  it('копирует всю действующую редакцию, включая периоды, связи и нестандартные километры', async () => {
    const store = await open()
    const first = value(await store.createDraft(input))
    const database = inspect()
    seedPassport(database, first.id)
    value(await store.activate(first.id))
    const next = value(await store.createDraft({ ...input, label: 'Новая учебная редакция' }))
    for (const table of editionTables) {
      const original = database.prepare(`SELECT * FROM ${table} WHERE edition_id = ?`).get(first.id)
      expect(database.prepare(`SELECT * FROM ${table} WHERE edition_id = ?`).get(next.id)).toEqual({
        ...original,
        edition_id: next.id,
      })
    }
    database
      .prepare('UPDATE station SET name = ? WHERE edition_id = ?')
      .run('Исправленная учебная станция', next.id)
    expect(
      database.prepare('SELECT name FROM station WHERE edition_id = ?').get(first.id),
    ).toMatchObject({ name: 'Вымышленная станция' })
    value(await store.activate(next.id))
    expect(value(await store.list()).map((row) => row.status)).toEqual(['archived', 'active'])
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('запрещает вставку, изменение и удаление каждой таблицы действующей и архивной редакций', async () => {
    const store = await open()
    const draft = value(await store.createDraft(input))
    const database = inspect()
    seedPassport(database, draft.id)
    value(await store.activate(draft.id))
    const next = value(await store.createDraft(input))
    for (const archive of [false, true]) {
      if (archive) value(await store.activate(next.id))
      for (const table of editionTables) {
        expect(() =>
          database.prepare(`UPDATE ${table} SET id = 'changed' WHERE edition_id = ?`).run(draft.id),
        ).toThrow('immutable')
        expect(() =>
          database.prepare(`DELETE FROM ${table} WHERE edition_id = ?`).run(draft.id),
        ).toThrow('immutable')
        expect(() =>
          database
            .prepare(`INSERT INTO ${table} SELECT * FROM ${table} WHERE edition_id = ?`)
            .run(draft.id),
        ).toThrow('immutable')
      }
      expect(() =>
        database.prepare("UPDATE edition SET label = 'changed' WHERE id = ?").run(draft.id),
      ).toThrow('invalid edition transition')
      expect(() => database.prepare('DELETE FROM edition WHERE id = ?').run(draft.id)).toThrow(
        'immutable',
      )
    }
  })

  it('не разрешает перенести строки между черновиками или связать разные редакции', async () => {
    const store = await open()
    const first = value(await store.createDraft(input))
    const second = value(await store.createDraft(input))
    const database = inspect()
    seedPassport(database, first.id)
    expect(() => database.prepare('UPDATE line SET edition_id = ?').run(second.id)).toThrow(
      'immutable',
    )
    expect(() =>
      database
        .prepare(
          "INSERT INTO line_extent(edition_id,id,line_id,start_km,start_m,end_km,end_m) VALUES (?, 'x', 'row', 700,0,701,0)",
        )
        .run(second.id),
    ).toThrow('FOREIGN KEY')
    expect(() =>
      database
        .prepare(
          "INSERT INTO line_km(edition_id,id,line_id,km,length_m) VALUES (?, 'x', 'row', 700.5,1000)",
        )
        .run(first.id),
    ).toThrow('cannot store REAL value in INTEGER column')
  })

  it('создаёт полную копию WAL до каждой активации', async () => {
    const store = await open()
    const first = value(await store.createDraft(input))
    seedPassport(inspect(), first.id)
    value(await store.activate(first.id))
    const firstBackup = (await backups())[0]!
    expect(inspect(firstBackup).prepare('SELECT status FROM edition').get()).toMatchObject({
      status: 'draft',
    })
    expect(inspect(firstBackup).prepare('SELECT length_m FROM line_km').get()).toMatchObject({
      length_m: 1250,
    })
    const next = value(await store.createDraft(input))
    value(await store.activate(next.id))
    const files = await backups()
    expect(files).toHaveLength(2)
    const secondBackup = files.find((file) => file !== firstBackup)!
    expect(
      inspect(secondBackup).prepare('SELECT status FROM edition ORDER BY number').all(),
    ).toMatchObject([{ status: 'active' }, { status: 'draft' }])
  })

  it('не меняет редакции, если резервную копию записать нельзя', async () => {
    const store = await open()
    const draft = value(await store.createDraft(input))
    await writeFile(join(root, 'backups'), 'занято файлом')
    expect(await store.activate(draft.id)).toMatchObject({ ok: false, error: { kind: 'storage' } })
    expect(value(await store.list()).map((row) => row.status)).toEqual(['draft'])
  })

  it('откатывает архивирование, если новая редакция не введена', async () => {
    const store = await open()
    const first = value(await store.createDraft(input))
    value(await store.activate(first.id))
    const second = value(await store.createDraft(input))
    inspect().exec(
      `CREATE TRIGGER fail_activation BEFORE UPDATE ON edition WHEN NEW.id = ${second.id} AND NEW.status = 'active' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`,
    )
    expect(await store.activate(second.id)).toMatchObject({ ok: false, error: { kind: 'storage' } })
    expect(value(await store.list()).map((row) => row.status)).toEqual(['active', 'draft'])
  })

  it('сериализует параллельные вводы: после завершения действует ровно одна редакция', async () => {
    const store = await open()
    const [one, two] = await Promise.all([store.createDraft(input), store.createDraft(input)])
    expect(value(two).number).toBe(value(one).number + 1)
    const results = await Promise.all([
      store.activate(value(one).id),
      store.activate(value(two).id),
    ])
    expect(results.every((result) => result.ok)).toBe(true)
    expect(value(await store.list()).map((row) => row.status)).toEqual(['archived', 'active'])
    expect(await store.activate(value(one).id)).toMatchObject({
      ok: false,
      error: { kind: 'immutable' },
    })
    expect(await store.activate(999)).toMatchObject({ ok: false, error: { kind: 'not-found' } })
    expect(await backups()).toHaveLength(2)
  })

  it('отклоняет неверный черновик до записи и отказывает после закрытия', async () => {
    const store = await open()
    expect(await store.createDraft({ ...input, date: '2027-02-30' })).toMatchObject({
      ok: false,
      error: { kind: 'invalid-edition' },
    })
    expect(value(await store.list())).toEqual([])
    await store.close()
    expect(await store.list()).toMatchObject({ ok: false, error: { kind: 'storage' } })
  })

  it('переходит в LOCALAPPDATA, если data недоступна как каталог', async () => {
    const portable = join(root, 'portable')
    await mkdir(portable)
    await writeFile(join(portable, 'data'), 'это файл')
    const store = await openPortablePassport({
      executableDirectory: portable,
      localDataDirectory: join(root, 'local'),
      migrationsDirectory: migrations,
    })
    stores.push(store)
    expect(store.path).toBe(join(root, 'local', 'editor-of-work', 'passport.sqlite'))
    expect(value(await store.createDraft(input)).status).toBe('draft')
  })

  it('продолжает прежнюю резервную базу после восстановления доступа к папке программы', async () => {
    const portable = join(root, 'portable')
    await mkdir(portable)
    await writeFile(join(portable, 'data'), 'недоступный каталог')
    const options = {
      executableDirectory: portable,
      localDataDirectory: join(root, 'local'),
      migrationsDirectory: migrations,
    }
    const first = await openPortablePassport(options)
    stores.push(first)
    const edition = value(await first.createDraft(input))
    await first.close()
    await rm(join(portable, 'data'))
    const reopened = await openPortablePassport(options)
    stores.push(reopened)
    expect(reopened.path).toBe(first.path)
    expect(value(await reopened.list())).toEqual([edition])
    expect(await readdir(portable)).not.toContain('data')
  })

  it('не создаёт новую переносную базу вместо повреждённой существующей резервной', async () => {
    const fallback = join(root, 'local', 'editor-of-work')
    await mkdir(fallback, { recursive: true })
    await writeFile(join(fallback, 'passport.sqlite'), 'учебный повреждённый файл')
    await expect(
      openPortablePassport({
        executableDirectory: join(root, 'portable'),
        localDataDirectory: join(root, 'local'),
        migrationsDirectory: migrations,
      }),
    ).rejects.toThrow('file is not a database')
    expect(await readdir(root)).not.toContain('portable')
  })

  it.each(['portable', 'local'] as const)(
    'после возвращения переносной базы открывает только явно выбранную %s',
    async (choice) => {
      const options = {
        executableDirectory: join(root, 'portable'),
        localDataDirectory: join(root, 'local'),
        migrationsDirectory: migrations,
      }
      const primary = await openPortablePassport(options)
      stores.push(primary)
      const carried = value(
        await primary.createDraft({ ...input, label: 'Переносимая учебная редакция' }),
      )
      await primary.close()
      const primaryDirectory = join(options.executableDirectory, 'data')
      const parked = join(options.executableDirectory, 'temporarily-unavailable')
      await rename(primaryDirectory, parked)
      await writeFile(primaryDirectory, 'недоступный каталог')
      const chooseLocation = vi.fn<PassportLocationChooser>(async () => choice)
      const fallback = await openPortablePassport({ ...options, chooseLocation })
      stores.push(fallback)
      const localEdition = value(
        await fallback.createDraft({ ...input, label: 'Локальная учебная редакция' }),
      )
      await fallback.close()
      expect(chooseLocation).not.toHaveBeenCalled()
      await rm(primaryDirectory)
      await rename(parked, primaryDirectory)

      const unselected = choice === 'portable' ? fallback.path : primary.path
      const before = await readFile(unselected)
      const reopened = await openPortablePassport({ ...options, chooseLocation })
      stores.push(reopened)
      expect(chooseLocation).toHaveBeenCalledExactlyOnceWith({
        portablePath: primary.path,
        localPath: fallback.path,
      })
      expect(reopened.path).toBe(choice === 'portable' ? primary.path : fallback.path)
      expect(value(await reopened.list())).toEqual([choice === 'portable' ? carried : localEdition])
      value(await reopened.createDraft({ ...input, label: 'После явного выбора' }))
      await reopened.close()
      expect(await readFile(unselected)).toEqual(before)
      const again = await openPortablePassport({ ...options, chooseLocation })
      stores.push(again)
      expect(chooseLocation).toHaveBeenCalledTimes(2)
      expect(value(await again.list())).toHaveLength(2)
    },
  )

  it.each(['cancel', 'missing-handler'] as const)(
    'не открывает ни одну из двух баз при %s',
    async (mode) => {
      const portable = join(root, 'portable', 'data')
      const local = join(root, 'local', 'editor-of-work')
      await mkdir(portable, { recursive: true })
      await mkdir(local, { recursive: true })
      const files = [join(portable, 'passport.sqlite'), join(local, 'passport.sqlite')]
      await writeFile(files[0]!, 'Первая учебная база')
      await writeFile(files[1]!, 'Вторая учебная база')
      const before = await Promise.all(files.map((file) => readFile(file)))
      const chooseLocation = vi.fn<PassportLocationChooser>(async () => undefined)
      const opening = openPortablePassport({
        executableDirectory: join(root, 'portable'),
        localDataDirectory: join(root, 'local'),
        migrationsDirectory: join(root, 'missing-migrations'),
        ...(mode === 'cancel' ? { chooseLocation } : {}),
      })
      await expect(opening).rejects.toThrow(
        mode === 'cancel' ? new PassportLocationCancelled() : 'Найдены две базы паспорта',
      )
      expect(chooseLocation).toHaveBeenCalledTimes(mode === 'cancel' ? 1 : 0)
      expect(await Promise.all(files.map((file) => readFile(file)))).toEqual(before)
      expect(await readdir(portable)).toEqual(['passport.sqlite'])
      expect(await readdir(local)).toEqual(['passport.sqlite'])
    },
  )

  it.each(['portable', 'local'] as const)(
    'при повреждении выбранной %s не переключается и не меняет другую базу',
    async (choice) => {
      const portable = join(root, 'portable', 'data')
      const local = join(root, 'local', 'editor-of-work')
      await mkdir(portable, { recursive: true })
      await mkdir(local, { recursive: true })
      const portablePath = join(portable, 'passport.sqlite')
      const localPath = join(local, 'passport.sqlite')
      const chosen = choice === 'portable' ? portablePath : localPath
      const other = choice === 'portable' ? localPath : portablePath
      const valid = await openPassportDatabase(other, migrations)
      stores.push(valid)
      value(await valid.createDraft(input))
      await valid.close()
      await writeFile(chosen, 'Учебная повреждённая база')
      const before = await readFile(other)
      const damaged = await readFile(chosen)
      await expect(
        openPortablePassport({
          executableDirectory: join(root, 'portable'),
          localDataDirectory: join(root, 'local'),
          migrationsDirectory: migrations,
          chooseLocation: async () => choice,
        }),
      ).rejects.toThrow('file is not a database')
      expect(await readFile(other)).toEqual(before)
      expect(await readFile(chosen)).toEqual(damaged)
      expect(await readdir(portable)).toEqual(['passport.sqlite'])
      expect(await readdir(local)).toEqual(['passport.sqlite'])
    },
  )

  it('не создаёт пустую базу, если выбранный файл исчез во время диалога', async () => {
    const portable = join(root, 'portable', 'data')
    const local = join(root, 'local', 'editor-of-work')
    await mkdir(portable, { recursive: true })
    await mkdir(local, { recursive: true })
    await writeFile(join(portable, 'passport.sqlite'), 'Первая учебная база')
    await writeFile(join(local, 'passport.sqlite'), 'Вторая учебная база')
    await expect(
      openPortablePassport({
        executableDirectory: join(root, 'portable'),
        localDataDirectory: join(root, 'local'),
        migrationsDirectory: migrations,
        chooseLocation: async ({ portablePath }) => {
          await rm(portablePath)
          return 'portable'
        },
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(portable)).toEqual([])
    expect(await readFile(join(local, 'passport.sqlite'), 'utf8')).toBe('Вторая учебная база')
  })

  it('не переключается на локальную базу при потере доступа к выбранной переносной', async () => {
    const portable = join(root, 'portable', 'data')
    const local = join(root, 'local', 'editor-of-work')
    const parked = join(root, 'portable', 'temporarily-unavailable')
    await mkdir(portable, { recursive: true })
    await mkdir(local, { recursive: true })
    await writeFile(join(portable, 'passport.sqlite'), 'Первая учебная база')
    await writeFile(join(local, 'passport.sqlite'), 'Вторая учебная база')
    await expect(
      openPortablePassport({
        executableDirectory: join(root, 'portable'),
        localDataDirectory: join(root, 'local'),
        migrationsDirectory: migrations,
        chooseLocation: async () => {
          await rename(portable, parked)
          await writeFile(portable, 'недоступный каталог')
          return 'portable'
        },
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/EEXIST|ENOTDIR/) })
    expect(await readFile(join(parked, 'passport.sqlite'), 'utf8')).toBe('Первая учебная база')
    expect(await readFile(join(local, 'passport.sqlite'), 'utf8')).toBe('Вторая учебная база')
    expect(await readdir(local)).toEqual(['passport.sqlite'])
  })

  it('требует выбор пути к общему файлу и читает его WAL после аварийного завершения', async () => {
    const options = {
      executableDirectory: join(root, 'portable'),
      localDataDirectory: join(root, 'local'),
      migrationsDirectory: migrations,
    }
    const primary = await openPortablePassport(options)
    stores.push(primary)
    const edition = value(await primary.createDraft(input))
    await primary.close()
    const fallback = join(options.localDataDirectory, 'editor-of-work')
    await mkdir(fallback, { recursive: true })
    const localPath = join(fallback, 'passport.sqlite')
    await link(primary.path, localPath)
    const crashed = spawnSync(
      process.execPath,
      [
        '-e',
        `const { DatabaseSync } = require('node:sqlite')
         const db = new DatabaseSync(process.argv[1])
         db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0; INSERT INTO edition(number,date,label,status) VALUES(2,'2027-01-02','Учебные изменения в локальном WAL','draft')")
         process.exit(0)`,
        localPath,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    )
    expect(crashed.error).toBeUndefined()
    expect(crashed.status).toBe(0)
    const walBefore = await readFile(`${localPath}-wal`)
    const mainBefore = await readFile(primary.path)
    expect(walBefore.byteLength).toBeGreaterThan(0)
    await expect(
      openPortablePassport({ ...options, chooseLocation: async () => undefined }),
    ).rejects.toBeInstanceOf(PassportLocationCancelled)
    expect(await readFile(`${localPath}-wal`)).toEqual(walBefore)
    expect(await readFile(primary.path)).toEqual(mainBefore)
    const chooseLocation = vi.fn<PassportLocationChooser>(async () => 'local')
    const reopened = await openPortablePassport({ ...options, chooseLocation })
    stores.push(reopened)
    expect(chooseLocation).toHaveBeenCalledExactlyOnceWith({
      portablePath: primary.path,
      localPath,
    })
    expect(reopened.path).toBe(localPath)
    expect(value(await reopened.list())).toEqual([
      edition,
      {
        id: 2,
        number: 2,
        date: '2027-01-02',
        label: 'Учебные изменения в локальном WAL',
        status: 'draft',
      },
    ])
  })

  it('не подменяет повреждённую переносную базу пустой резервной', async () => {
    const portable = join(root, 'portable')
    await mkdir(join(portable, 'data'), { recursive: true })
    const damaged = join(portable, 'data', 'passport.sqlite')
    await writeFile(damaged, 'учебный повреждённый файл')
    const before = await readFile(damaged)
    await expect(
      openPortablePassport({
        executableDirectory: portable,
        localDataDirectory: join(root, 'local'),
        migrationsDirectory: migrations,
      }),
    ).rejects.toThrow('file is not a database')
    expect(await readFile(damaged)).toEqual(before)
    expect(await readdir(root)).not.toContain('local')
  })

  it('копирует существующую базу перед следующей миграцией', async () => {
    const initial = new DatabaseSync(path)
    const chain = await loadPassportMigrations(migrations)
    await migratePassport(initial, chain.slice(0, 1), async () => undefined)
    initial.exec(
      "INSERT INTO edition(number,date,label,status) VALUES (1,'2027-01-01','Учебная','draft')",
    )
    initial.close()
    const store = await open()
    expect(value(await store.list())).toHaveLength(1)
    const files = await backups()
    expect(files).toHaveLength(1)
    expect(inspect(files[0]).prepare('SELECT version FROM schema_migrations').all()).toMatchObject([
      { version: 1 },
    ])
    await store.close()
    await open()
    expect(await backups()).toHaveLength(1)
  })

  it('миграция 003 сохраняет строки действующей редакции и создаёт копию схемы 002', async () => {
    const initial = new DatabaseSync(path)
    initial.exec('PRAGMA foreign_keys = ON')
    const chain = await loadPassportMigrations(migrations)
    await migratePassport(initial, chain.slice(0, 2), async () => undefined)
    initial.exec(
      "INSERT INTO edition(id,number,date,label,status) VALUES (1,1,'2027-01-01','Учебная','draft')",
    )
    seedPassport(initial, 1)
    initial.exec("UPDATE edition SET status = 'active' WHERE id = 1")
    const before = initial.prepare('SELECT * FROM subdivision_segment').get()
    initial.close()
    const store = await open()
    expect(value(await store.list())[0]?.status).toBe('active')
    expect(inspect().prepare('SELECT * FROM subdivision_segment').get()).toEqual({
      ...before,
      stated_length_m: null,
    })
    const files = await backups()
    expect(files).toHaveLength(1)
    const saved = inspect(files[0])
    expect(saved.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toMatchObject({
      n: 2,
    })
    expect(saved.prepare('SELECT * FROM subdivision_segment').get()).toEqual(before)
    expect(() =>
      inspect().prepare('UPDATE subdivision_segment SET stated_length_m = 1').run(),
    ).toThrow('immutable')
  })

  it('миграция 004 сохраняет прежние характеристики и защищает новые поля активной редакции', async () => {
    const initial = new DatabaseSync(path)
    initial.exec('PRAGMA foreign_keys = ON')
    const chain = await loadPassportMigrations(migrations)
    await migratePassport(initial, chain.slice(0, 3), async () => undefined)
    initial.exec(
      "INSERT INTO edition(id,number,date,label,status) VALUES (1,1,'2027-01-01','Учебная','draft')",
    )
    seedPassport(initial, 1)
    initial.exec("UPDATE edition SET status = 'active' WHERE id = 1")
    const tables = ['seg_class', 'seg_load', 'seg_speed', 'seg_rail', 'seg_sleeper', 'seg_ballast']
    const original = new Map(tables.map((t) => [t, initial.prepare(`SELECT * FROM ${t}`).get()]))
    initial.close()
    await open()
    const current = inspect()
    for (const table of tables) {
      expect(current.prepare(`SELECT * FROM ${table}`).get()).toEqual({
        ...original.get(table),
        stated_length_m: null,
        details: null,
      })
      expect(() => current.prepare(`UPDATE ${table} SET details = '{}'`).run()).toThrow('immutable')
    }
    const saved = inspect((await backups())[0])
    expect(saved.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toMatchObject({
      n: 3,
    })
    for (const table of tables)
      expect(saved.prepare(`SELECT * FROM ${table}`).get()).toEqual(original.get(table))
  })

  it('миграция 005 сохраняет действующие станции, переезды и их ссылки, создаёт backup и восстанавливает защиту', async () => {
    const initial = new DatabaseSync(path)
    initial.exec('PRAGMA foreign_keys=ON')
    const chain = await loadPassportMigrations(migrations)
    await migratePassport(initial, chain.slice(0, 4), async () => undefined)
    initial.exec(
      "INSERT INTO edition(id,number,date,label,status) VALUES (1,1,'2027-01-01','Учебная','draft')",
    )
    seedPassport(initial, 1)
    initial.exec("UPDATE edition SET status='active' WHERE id=1")
    const tables = ['station_axis', 'station_track', 'station_switch', 'crossing', 'territory']
    const before = new Map(tables.map((t) => [t, initial.prepare(`SELECT * FROM ${t}`).get()]))
    initial.close()
    await open()
    const current = inspect()
    for (const table of tables) {
      expect(current.prepare(`SELECT * FROM ${table}`).get()).toEqual({
        ...before.get(table),
        details: null,
      })
      expect(() => current.prepare(`UPDATE ${table} SET details='{}'`).run()).toThrow('immutable')
    }
    expect(current.prepare('SELECT crossing_id,line_id FROM crossing_line').all()).toEqual([
      { crossing_id: 'row', line_id: 'row' },
    ])
    expect(() => current.prepare("UPDATE crossing_line SET line_id='changed'").run()).toThrow(
      'immutable',
    )
    expect(current.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    const saved = inspect((await backups())[0])
    expect(saved.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toMatchObject({
      n: 4,
    })
    for (const table of tables)
      expect(saved.prepare(`SELECT * FROM ${table}`).get()).toEqual(before.get(table))
  })

  it('миграция 006 сохраняет действующий паспорт 005 и защищает новый символ вида работ', async () => {
    const chain = await loadPassportMigrations(migrations)
    const old = inspect()
    await migratePassport(old, chain.slice(0, 5), async () => undefined)
    old.exec(
      "INSERT INTO edition(id,number,date,label,status) VALUES (1,1,'2027-01-01','Учебная','draft')",
    )
    seedPassport(old, 1)
    old.exec("UPDATE edition SET status='active' WHERE id=1")
    const before = old.prepare('SELECT * FROM work_kind').get()
    await open()
    const current = inspect()
    expect(current.prepare('SELECT * FROM work_kind').get()).toEqual({
      ...before,
      symbol: null,
      sort_order: null,
    })
    expect(() => current.exec("UPDATE work_kind SET symbol='X' WHERE edition_id=1")).toThrow(
      'immutable',
    )
    expect(current.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    const saved = inspect((await backups())[0])
    expect(saved.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 5 })
    expect(saved.prepare('SELECT * FROM work_kind').get()).toEqual(before)
  })

  it('миграция 007 сохраняет виды работ 006 без порядка и защищает его в действующей редакции', async () => {
    const chain = await loadPassportMigrations(migrations)
    const old = inspect()
    await migratePassport(old, chain.slice(0, 6), async () => undefined)
    old.exec(
      "INSERT INTO edition(id,number,date,label,status) VALUES (1,1,'2027-01-01','Учебная','draft')",
    )
    seedPassport(old, 1)
    old.exec("UPDATE edition SET status='active' WHERE id=1")
    const before = old.prepare('SELECT * FROM work_kind').get()
    await open()
    const current = inspect()
    expect(current.prepare('SELECT * FROM work_kind').get()).toEqual({
      ...before,
      sort_order: null,
    })
    expect(() => current.exec('UPDATE work_kind SET sort_order=0 WHERE edition_id=1')).toThrow(
      'immutable',
    )
    expect(current.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    const saved = inspect((await backups())[0])
    expect(saved.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toEqual({ n: 6 })
    expect(saved.prepare('SELECT * FROM work_kind').get()).toEqual(before)
  })

  it('отказывает новой программе при изменённой истории и старой — при новой схеме', async () => {
    const chain = await loadPassportMigrations(migrations)
    const database = inspect()
    await migratePassport(database, chain, async () => undefined)
    let copied = false
    const before = database.prepare('SELECT * FROM schema_migrations').all()
    await expect(
      migratePassport(
        database,
        chain.map((item) => ({ ...item, sql: `${item.sql}\n-- changed` })),
        async () => {
          copied = true
        },
      ),
    ).rejects.toThrow('не совпадает')
    expect(copied).toBe(false)
    expect(database.prepare('SELECT * FROM schema_migrations').all()).toEqual(before)
    await migratePassport(
      database,
      [
        ...chain,
        {
          version: chain.length + 1,
          name: '004_future.sql',
          sql: 'CREATE TABLE future (id INTEGER);',
        },
      ],
      async () => undefined,
    )
    await expect(open()).rejects.toThrow('более новой')
    expect(database.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toMatchObject({
      n: chain.length + 1,
    })
  })

  it('откатывает всю цепочку при ошибке миграции', async () => {
    const database = inspect()
    const chain = await loadPassportMigrations(migrations)
    await expect(
      migratePassport(
        database,
        [
          ...chain,
          {
            version: chain.length + 1,
            name: '004_broken.sql',
            sql: 'CREATE TABLE broken (id INTEGER); INSERT INTO absent VALUES (1);',
          },
        ],
        async () => undefined,
      ),
    ).rejects.toThrow('no such table: absent')
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all(),
    ).toEqual([])
  })

  it('сохраняет прежнюю схему при сбое следующей миграции и при отказе копирования', async () => {
    const database = inspect()
    const chain = await loadPassportMigrations(migrations)
    await migratePassport(database, chain, async () => undefined)
    database.exec(
      "INSERT INTO edition(number,date,label,status) VALUES (1,'2027-01-01','Учебная','draft')",
    )
    const history = database.prepare('SELECT * FROM schema_migrations').all()
    const next = [
      ...chain,
      {
        version: chain.length + 1,
        name: '004_broken.sql',
        sql: 'ALTER TABLE edition ADD COLUMN example TEXT; SELECT * FROM absent;',
      },
    ]
    await expect(
      migratePassport(database, next, async () => {
        throw new Error('Нет места для копии')
      }),
    ).rejects.toThrow('Нет места')
    await expect(migratePassport(database, next, async () => undefined)).rejects.toThrow(
      'no such table: absent',
    )
    expect(database.prepare('SELECT * FROM schema_migrations').all()).toEqual(history)
    expect(database.prepare('SELECT * FROM edition').all()).toHaveLength(1)
    expect(
      database
        .prepare('PRAGMA table_info(edition)')
        .all()
        .some((row) => row['name'] === 'example'),
    ).toBe(false)
  })

  it('не оставляет частичный черновик при сбое копирования строк', async () => {
    const store = await open()
    const first = value(await store.createDraft(input))
    const database = inspect()
    seedPassport(database, first.id)
    value(await store.activate(first.id))
    database.exec(
      `CREATE TRIGGER fail_clone BEFORE INSERT ON station WHEN NEW.edition_id <> ${first.id} BEGIN SELECT RAISE(ABORT, 'clone failure'); END;`,
    )
    expect(await store.createDraft(input)).toMatchObject({ ok: false, error: { kind: 'storage' } })
    expect(value(await store.list())).toHaveLength(1)
    expect(database.prepare('SELECT count(*) AS n FROM line').get()).toMatchObject({ n: 1 })
  })

  it('проверяет внешние ключи при копировании в соединении хранилища', async () => {
    const store = await open()
    const first = value(await store.createDraft(input))
    const database = inspect()
    seedPassport(database, first.id)
    value(await store.activate(first.id))
    database.exec('PRAGMA foreign_keys = OFF')
    // Имитация внешнего повреждения: в API паспорта доступа к SQL нет.
    database.exec('DROP TRIGGER station_update_guard')
    database
      .prepare("UPDATE station SET import_file_id = 'missing' WHERE edition_id = ?")
      .run(first.id)
    expect(await store.createDraft(input)).toMatchObject({ ok: false, error: { kind: 'storage' } })
    expect(value(await store.list())).toHaveLength(1)
  })

  it.each(['unknown', 'future', 'checksum'] as const)(
    'отказ открытия %s не меняет байты файла и режим DELETE',
    async (problem) => {
      const database = new DatabaseSync(path)
      const chain = await loadPassportMigrations(migrations)
      if (problem === 'unknown') database.exec('CREATE TABLE unrelated (id INTEGER)')
      else {
        await migratePassport(database, chain, async () => undefined)
        if (problem === 'future')
          await migratePassport(
            database,
            [
              ...chain,
              {
                version: chain.length + 1,
                name: '004_future.sql',
                sql: 'CREATE TABLE future (id INTEGER)',
              },
            ],
            async () => undefined,
          )
        else database.exec("UPDATE schema_migrations SET sha256 = 'changed' WHERE version = 1")
      }
      expect(database.prepare('PRAGMA journal_mode').get()).toMatchObject({
        journal_mode: 'delete',
      })
      database.close()
      const before = await readFile(path)
      await expect(open()).rejects.toThrow(
        problem === 'future'
          ? 'более новой'
          : problem === 'unknown'
            ? 'Неизвестная схема'
            : 'не совпадает',
      )
      expect(await readFile(path)).toEqual(before)
      expect(await readdir(root)).toEqual(['passport.sqlite'])
      expect(inspect().prepare('PRAGMA journal_mode').get()).toMatchObject({
        journal_mode: 'delete',
      })
    },
  )
})
