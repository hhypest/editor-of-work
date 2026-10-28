import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFile, mkdir, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Result } from '@eow/shared/kernel'
import { openPassportDatabase, type PassportDatabase } from './sqlite-passport-store'
import { backupName, MAX_PASSPORT_BACKUPS, parseBackupName, pruneBackups } from './passport-backups'

const migrations = resolve(import.meta.dirname, '../../migrations')
function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

describe('Имена и число резервных копий', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-backups-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('имя копии читается обратно, чужие файлы копиями не считаются', () => {
    const name = backupName('restore', new Date('2026-10-28T07:05:09.123Z'))
    expect(name).not.toContain(':')
    expect(parseBackupName(name)).toEqual({
      reason: 'restore',
      createdAt: '2026-10-28T07:05:09.123Z',
    })
    for (const foreign of [
      'passport.sqlite',
      'passport-other-2026-10-28T07-05-09.123Z-00000000-0000-0000-0000-000000000000.sqlite',
      '../passport-restore-2026-10-28T07-05-09.123Z-00000000-0000-0000-0000-000000000000.sqlite',
      'заметки.txt',
    ])
      expect(parseBackupName(foreign)).toBeUndefined()
  })

  it(`оставляет ${MAX_PASSPORT_BACKUPS} последних копий и никогда не удаляет защищённые и чужие файлы`, async () => {
    const names = Array.from({ length: 14 }, (_, i) =>
      backupName('activation', new Date(Date.UTC(2026, 0, 1 + i))),
    )
    for (const name of names) await writeFile(join(root, name), '')
    await writeFile(join(root, 'заметки.txt'), 'не копия')
    // Самая старая копия защищена: её восстанавливают прямо сейчас.
    await pruneBackups(root, [names[0]!])
    const left = await readdir(root)
    expect(left).toContain('заметки.txt')
    expect(left).toContain(names[0])
    expect(left.filter((name) => name.endsWith('.sqlite')).toSorted()).toEqual(
      [names[0]!, ...names.slice(-(MAX_PASSPORT_BACKUPS - 1))].toSorted(),
    )
  })
})

describe('Восстановление базы паспорта из копии', () => {
  let root: string
  let path: string
  let store: PassportDatabase
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-restore-'))
    path = join(root, 'passport.sqlite')
    store = await openPassportDatabase(path, migrations)
  })
  afterEach(async () => {
    await store.close()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('показывает копию до ввода в действие с её редакциями и возвращает базу к ней', async () => {
    const first = value(await store.createDraft({ date: '2026-10-22', label: 'Первая' }))
    value(await store.activate(first.id))
    value(await store.createDraft({ date: '2027-01-01', label: 'Вторая' }))
    const [copy] = value(await store.backups())
    expect(copy).toMatchObject({
      reason: 'activation',
      editions: [{ number: 1, date: '2026-10-22', label: 'Первая', status: 'draft' }],
    })
    expect(copy?.problem).toBeUndefined()
    expect(copy?.bytes).toBeGreaterThan(0)

    value(await store.restoreBackup(copy!.id))
    expect(value(await store.list())).toMatchObject([{ label: 'Первая', status: 'draft' }])
    // Перед заменой сохранена текущая база: из неё можно вернуться обратно.
    const after = value(await store.backups())
    const before = after.find((b) => b.reason === 'restore')
    expect(before?.editions.map((e) => [e.label, e.status])).toEqual([
      ['Первая', 'active'],
      ['Вторая', 'draft'],
    ])
    value(await store.restoreBackup(before!.id))
    expect(value(await store.list()).map((e) => e.label)).toEqual(['Первая', 'Вторая'])
    // База остаётся рабочей после замены соединения.
    value(await store.createDraft({ date: '2027-02-01', label: 'Третья' }))
    await store.close()
    store = await openPassportDatabase(path, migrations)
    expect(value(await store.list()).map((e) => e.label)).toEqual(['Первая', 'Вторая', 'Третья'])
  })

  it('отклоняет неизвестную копию, путь вне папки, повреждённый файл и копию новой программы', async () => {
    const first = value(await store.createDraft({ date: '2026-10-22', label: 'Первая' }))
    value(await store.activate(first.id))
    const [copy] = value(await store.backups())
    const backups = join(root, 'backups')
    const missing = backupName('activation', new Date('2020-01-01T00:00:00Z'))
    for (const id of [missing, `../${copy!.id}`, 'passport.sqlite'])
      expect(await store.restoreBackup(id)).toMatchObject({
        ok: false,
        error: { message: 'Резервная копия не найдена.' },
      })

    const broken = backupName('migration', new Date('2026-01-01T00:00:00Z'))
    await writeFile(join(backups, broken), 'не база')
    const newer = backupName('migration', new Date('2026-01-02T00:00:00Z'))
    await copyFile(join(backups, copy!.id), join(backups, newer))
    const database = new DatabaseSync(join(backups, newer))
    database.exec(
      "INSERT INTO schema_migrations VALUES (999, '999_future.sql', 'x', '2030-01-01T00:00:00Z')",
    )
    database.close()

    const listed = value(await store.backups())
    expect(listed.find((b) => b.id === broken)?.problem).toMatch(/повреждён/u)
    expect(listed.find((b) => b.id === newer)?.problem).toMatch(/более новой программой/u)
    for (const id of [broken, newer])
      expect(await store.restoreBackup(id)).toMatchObject({ ok: false })
    // Отказ ничего не меняет: та же база, новых копий нет.
    expect(value(await store.list())).toMatchObject([{ label: 'Первая', status: 'active' }])
    expect((await readdir(backups)).filter((n) => n.includes('-restore-'))).toEqual([])
  })

  it('копия с повреждённой таблицей вне редакций не подменяет базу', async () => {
    const first = value(await store.createDraft({ date: '2026-10-22', label: 'Первая' }))
    value(await store.activate(first.id))
    const [copy] = value(await store.backups())
    const file = join(root, 'backups', copy!.id)
    // Портим корневую страницу таблицы line: редакции читаются, полная проверка — нет.
    const database = new DatabaseSync(file)
    const { rootpage } = database
      .prepare("SELECT rootpage FROM sqlite_master WHERE name = 'line'")
      .get() as { rootpage: number }
    const { page_size } = database.prepare('PRAGMA page_size').get() as { page_size: number }
    database.close()
    const handle = await open(file, 'r+')
    await handle.write(Buffer.alloc(page_size, 0xff), 0, page_size, (rootpage - 1) * page_size)
    await handle.close()
    expect(value(await store.backups()).find((b) => b.id === copy!.id)?.problem).toBeUndefined()
    expect(await store.restoreBackup(copy!.id)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('проверка целостности') },
    })
    expect(value(await store.list())).toMatchObject([{ label: 'Первая', status: 'active' }])
  })

  it('без папки копий список пуст', async () => {
    await mkdir(join(root, 'другая'))
    expect(value(await store.backups())).toEqual([])
  })
})
