/** Отдельная тестовая точка входа: production build её не включает. */
import { app } from 'electron'
import assert from 'node:assert/strict'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  openPassportDatabase,
  openPortablePassport,
  type PassportDatabase,
} from '@eow/passport/infrastructure'
import type { Result } from '@eow/shared/kernel'

function value<T>(result: Result<T, unknown>): T {
  assert.ok(result.ok, 'Операция публичного адаптера паспорта отклонена')
  return result.value
}

async function check(): Promise<void> {
  assert.equal(process.type, 'browser', 'Проверка требует настоящий main-процесс Electron')
  assert.ok(process.versions.electron, 'Версия Electron отсутствует')
  assert.ok(!process.env['ELECTRON_RUN_AS_NODE'], 'ELECTRON_RUN_AS_NODE запрещён')
  // __dirname — новая временная папка, созданная только для этого запуска.
  await mkdir(join(__dirname, 'user-data'))
  app.setPath('userData', join(__dirname, 'user-data'))
  await app.whenReady()
  const migrationsDirectory = join(__dirname, 'migrations')
  const databasePath = join(__dirname, 'data', 'passport.sqlite')
  const stores: PassportDatabase[] = []
  const checks: string[] = []
  const open = async (): Promise<PassportDatabase> => {
    const store = await openPortablePassport({
      executableDirectory: __dirname,
      localDataDirectory: join(__dirname, 'local-data'),
      migrationsDirectory,
    })
    stores.push(store)
    assert.equal(store.path, databasePath, 'База должна создаваться рядом с программой')
    return store
  }
  try {
    const store = await open()
    assert.deepEqual(value(await store.list()), [])
    checks.push('create')
    const inspect = new DatabaseSync(databasePath, { readOnly: true })
    let sqlite: string
    try {
      assert.equal(inspect.prepare('PRAGMA journal_mode').get()?.['journal_mode'], 'wal')
      const migrationCount = (await readdir(migrationsDirectory)).filter((n) =>
        n.endsWith('.sql'),
      ).length
      assert.ok(migrationCount > 0)
      assert.equal(
        inspect.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.['n'],
        migrationCount,
      )
      sqlite = String(inspect.prepare('SELECT sqlite_version() AS version').get()?.['version'])
      checks.push('migrations-and-wal')
    } finally {
      inspect.close()
    }
    const first = value(await store.createDraft({ date: '2027-01-01', label: 'Учебная редакция' }))
    const active = value(await store.activate(first.id))
    assert.equal(active.status, 'active')
    const second = value(
      await store.createDraft({ date: '2027-02-01', label: 'Вторая учебная редакция' }),
    )
    assert.equal(second.number, first.number + 1)
    value(await store.activate(second.id))
    const expected = [
      { ...first, status: 'archived' },
      { ...second, status: 'active' },
    ]
    assert.deepEqual(value(await store.list()), expected)
    checks.push('activate-and-archive')

    const backups = (await readdir(join(__dirname, 'data', 'backups'))).filter((n) =>
      n.endsWith('.sqlite'),
    )
    assert.equal(backups.length, 2, 'Каждая активация должна создавать резервную копию')
    const snapshots = []
    for (const name of backups) {
      const path = join(__dirname, 'data', 'backups', name)
      const database = new DatabaseSync(path, {
        readOnly: true,
      })
      try {
        assert.deepEqual(
          database
            .prepare('PRAGMA integrity_check')
            .all()
            .map((r) => ({ ...r })),
          [{ integrity_check: 'ok' }],
        )
        assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
      } finally {
        database.close()
      }
      const copy = await openPassportDatabase(path, migrationsDirectory)
      stores.push(copy)
      snapshots.push(value(await copy.list()))
      await copy.close()
    }
    assert.deepEqual(
      snapshots.toSorted((a, b) => a.length - b.length),
      [[first], [active, second]],
    )
    checks.push('backup-before-activation')
    await store.close()
    const reopened = await open()
    assert.deepEqual(value(await reopened.list()), expected)
    checks.push('reopen')
    await reopened.close()
    await writeFile(
      join(__dirname, 'report.json'),
      JSON.stringify(
        {
          status: 'passed',
          processType: process.type,
          electron: process.versions.electron,
          node: process.versions.node,
          sqlite,
          checks,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    for (const store of stores) await store.close()
  }
}

void check().then(
  () => app.exit(0),
  (error: unknown) => {
    console.error(error)
    if (app) app.exit(1)
    else process.exitCode = 1
  },
)
