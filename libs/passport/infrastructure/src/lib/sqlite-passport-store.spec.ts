import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Result } from '@eow/shared/kernel'
import {
  openPassportDatabase,
  openPortablePassport,
  type PassportDatabase,
} from './sqlite-passport-store'
import { loadPassportMigrations, migratePassport } from './migrations'
import { editionTables } from './edition-tables'
import { seedPassport } from './testing/passport-fixture'

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
      n: 2,
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
      [...chain, { version: 3, name: '003_future.sql', sql: 'CREATE TABLE future (id INTEGER);' }],
      async () => undefined,
    )
    await expect(open()).rejects.toThrow('более новой')
    expect(database.prepare('SELECT count(*) AS n FROM schema_migrations').get()).toMatchObject({
      n: 3,
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
            version: 3,
            name: '003_broken.sql',
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
        version: 3,
        name: '003_broken.sql',
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
})
