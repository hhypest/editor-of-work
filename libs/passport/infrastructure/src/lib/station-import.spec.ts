import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Result } from '@eow/shared/kernel'
import { openPassportDatabase, type PassportDatabase } from './sqlite-passport-store'
import { stationFixture } from './testing/station-import-fixture'

function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
const sorted = <T extends { id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a.id.localeCompare(b.id))
describe('Станционные данные в SQLite', () => {
  let root: string, db: DatabaseSync, store: PassportDatabase, id: number
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-stations-'))
    const path = join(root, 'passport.sqlite')
    store = await openPassportDatabase(path, resolve(import.meta.dirname, '../../migrations'))
    id = value(await store.createDraft({ date: '2026-10-21', label: 'Учебная редакция' })).id
    db = new DatabaseSync(path)
    db.exec('PRAGMA foreign_keys=ON')
    for (const n of [1, 2])
      db.prepare('INSERT INTO line(edition_id,id,name,code) VALUES (?,?,?,?)').run(
        id,
        'line' + n,
        'УЧЕБНЫЙ, ' + n,
        'L' + n,
      )
    db.prepare(
      "INSERT INTO station(edition_id,id,name,code,type) VALUES (?,'station','УЧЕБНАЯ','S','station')",
    ).run(id)
    db.prepare(
      "INSERT INTO station_track(edition_id,id,station_id,number,capacity) VALUES (?,'track','station','I',12)",
    ).run(id)
    db.prepare(
      "INSERT INTO station_switch(edition_id,id,station_id,number,track_id,last_repair_year) VALUES (?,'switch','station','7','track',2020)",
    ).run(id)
  })
  afterEach(async () => {
    db.close()
    await store.close()
    await rm(root, { recursive: true, force: true })
  })
  const input = async () => stationFixture(value(await store.stationBasis(id)).token)
  const snapshot = () =>
    Object.fromEntries(
      [
        'station',
        'station_axis',
        'station_track',
        'station_switch',
        'crossing',
        'crossing_line',
        'territory',
        'excluded_object',
        'import_file',
      ].map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY edition_id,id`).all()]),
    )
  it('сохраняет все объекты, неизвестные границы и несколько направлений без вымышленных ссылок', async () => {
    const data = await input()
    value(await store.applyStationImport(id, data))
    expect(value(await store.stationData(id))).toEqual(sorted(data.rows))
    expect(value(await store.stationImportReport(id))).toHaveLength(7)
    expect(db.prepare('SELECT start_km,end_km,station_id FROM station_axis').get()).toMatchObject({
      start_km: null,
      end_km: null,
      station_id: 'station',
    })
    expect(
      db.prepare('SELECT id,capacity,last_repair_year FROM station_track').get(),
    ).toMatchObject({ id: 'track', capacity: 12, last_repair_year: 2006 })
    expect(
      db.prepare('SELECT id,track_id,last_repair_year FROM station_switch').get(),
    ).toMatchObject({
      id: 'switch',
      track_id: 'track',
      last_repair_year: 2020,
    })
    expect(db.prepare('SELECT line_id,station_id,km,m FROM crossing').get()).toMatchObject({
      line_id: null,
      station_id: null,
      km: 10,
      m: 900,
    })
    expect(db.prepare('SELECT line_id FROM crossing_line ORDER BY line_id').all()).toEqual([
      { line_id: 'line1' },
      { line_id: 'line2' },
    ])
    expect(db.prepare('SELECT count(*) AS n FROM station').get()).toMatchObject({ n: 1 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
  it('повторный пакет и смена имён не дублируют записи, пустой пакет сохраняет ключи и ручные поля', async () => {
    const data = await input()
    value(await store.applyStationImport(id, data))
    const before = snapshot()
    value(await store.applyStationImport(id, await input()))
    expect(snapshot()).toEqual(before)
    value(
      await store.applyStationImport(id, {
        ...(await input()),
        files: data.files.map((f) => ({ ...f, name: 'новый-' + f.name })),
      }),
    )
    expect(value(await store.stationData(id))).toHaveLength(5)
    value(
      await store.applyStationImport(id, {
        ...(await input()),
        rows: [],
        files: data.files.map((f) => ({ ...f, rowCount: 0, warnings: [] })),
      }),
    )
    expect(value(await store.stationData(id))).toEqual([])
    expect(
      db.prepare('SELECT id,capacity,details,import_file_id FROM station_track').get(),
    ).toMatchObject({ id: 'track', capacity: 12, details: null, import_file_id: null })
    expect(
      db.prepare('SELECT id,track_id,last_repair_year FROM station_switch').get(),
    ).toMatchObject({
      id: 'switch',
      track_id: 'track',
      last_repair_year: 2020,
    })
    expect(db.prepare('SELECT count(*) AS n FROM crossing_line').get()).toMatchObject({ n: 0 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
  it('сбой последней записи откатывает данные, справочники и отчёт целиком', async () => {
    value(await store.applyStationImport(id, await input()))
    const before = snapshot()
    db.exec(
      "CREATE TRIGGER fail_territory BEFORE UPDATE ON territory WHEN NEW.details IS NOT NULL BEGIN SELECT RAISE(ABORT,'test failure'); END",
    )
    const data = await input()
    expect(
      await store.applyStationImport(id, {
        ...data,
        files: data.files.map((f) => ({ ...f, sha256: 'b'.repeat(64) })),
      }),
    ).toMatchObject({ ok: false, error: { kind: 'storage' } })
    expect(snapshot()).toEqual(before)
  })
  it('изменение исключений или справочника после предпросмотра требует повторной сверки', async () => {
    const data = await input()
    value(await store.setStationExclusions(id, [{ name: 'ДРУГАЯ', reason: 'Учебное исключение' }]))
    expect(await store.applyStationImport(id, data)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import', message: expect.stringContaining('Повторите предпросмотр') },
    })
    const next = await input()
    db.prepare("UPDATE line SET name='ИЗМЕНЁННОЕ' WHERE id='line1'").run()
    expect(await store.applyStationImport(id, next)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import' },
    })
  })
  it('список исключений действует в представлении и не удаляет справочники; отмена возвращает данные', async () => {
    value(await store.applyStationImport(id, await input()))
    value(
      await store.setStationExclusions(id, [
        { name: 'УЧЕБНАЯ', reason: 'Подтверждено составителем' },
      ]),
    )
    expect(value(await store.stationData(id)).some((r) => 'station' in r.values)).toBe(false)
    expect(db.prepare('SELECT count(*) AS n FROM station_track').get()).toMatchObject({ n: 1 })
    expect(await store.applyStationImport(id, await input())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import' },
    })
    value(await store.setStationExclusions(id, []))
    expect(value(await store.stationData(id))).toHaveLength(5)
  })
  it('действующая и архивная редакции неизменяемы; копия сохраняет данные, связи, исключения и отчёт', async () => {
    value(await store.setStationExclusions(id, [{ name: 'ДРУГАЯ', reason: 'Учебное исключение' }]))
    const data = await input()
    value(await store.applyStationImport(id, data))
    value(await store.activate(id))
    expect(await store.applyStationImport(id, data)).toMatchObject({
      ok: false,
      error: { kind: 'immutable' },
    })
    expect(await store.setStationExclusions(id, [])).toMatchObject({
      ok: false,
      error: { kind: 'immutable' },
    })
    const next = value(await store.createDraft({ date: data.date, label: 'Копия' }))
    expect(value(await store.stationData(next.id))).toEqual(sorted(data.rows))
    expect(value(await store.stationImportReport(next.id))).toHaveLength(7)
    expect(value(await store.stationBasis(next.id)).excludedStations).toEqual([
      { name: 'ДРУГАЯ', reason: 'Учебное исключение' },
    ])
    expect(
      db.prepare('SELECT count(*) AS n FROM crossing_line WHERE edition_id=?').get(next.id),
    ).toMatchObject({ n: 2 })
    value(await store.activate(next.id))
    expect(await store.applyStationImport(id, data)).toMatchObject({
      ok: false,
      error: { kind: 'immutable' },
    })
  })
  it('ошибочные ссылки, повтор сущности и цикл ОКАТО отклоняются до записи', async () => {
    const data = await input(),
      before = snapshot()
    const missing = {
      ...data,
      rows: data.rows.map((r) =>
        r.form === 'station-axes' ? { ...r, values: { ...r.values, line: 'НЕТ НАПРАВЛЕНИЯ' } } : r,
      ),
    }
    expect(await store.applyStationImport(id, missing)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import' },
    })
    expect(
      await store.applyStationImport(id, {
        ...data,
        rows: [...data.rows, { ...data.rows[0]!, id: 'повтор' }],
      }),
    ).toMatchObject({ ok: false, error: { kind: 'invalid-import' } })
    const cycle = {
      ...data,
      rows: data.rows.map((r) =>
        r.form === 'okato'
          ? { ...r, values: { ...r.values, parent: r.values.name, parentType: r.values.type } }
          : r,
      ),
    }
    expect(await store.applyStationImport(id, cycle)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import' },
    })
    expect(snapshot()).toEqual(before)
  })
  it('не сохраняет неизвестные поля и отвергает неполный пакет или несуществующую редакцию', async () => {
    const data = await input(),
      marker = 'ВЫМЫШЛЕННЫЙ КОРРЕКТИРОВЩИК'
    const unsafe = structuredClone(data)
    for (const row of unsafe.rows) {
      Object.assign(row, { correctedBy: marker })
      Object.assign(row.values, { correctedBy: marker })
    }
    value(await store.applyStationImport(id, unsafe))
    expect(JSON.stringify(snapshot())).not.toContain(marker)
    expect(
      await store.applyStationImport(id, { ...(await input()), files: data.files.slice(1) }),
    ).toMatchObject({ ok: false, error: { kind: 'invalid-import' } })
    expect(await store.stationBasis(999)).toMatchObject({ ok: false, error: { kind: 'not-found' } })
    expect(await store.stationData(999)).toMatchObject({ ok: false, error: { kind: 'not-found' } })
    expect(await store.stationImportReport(999)).toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    })
  })
  it('не выбирает первую из одноимённых станций и проверяет причины исключений', async () => {
    db.prepare(
      "INSERT INTO station(edition_id,id,name,code,type) VALUES (?,'duplicate','УЧЕБНАЯ','X','station')",
    ).run(id)
    const before = snapshot()
    expect(await store.applyStationImport(id, await input())).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import', message: expect.stringContaining('неоднозначна') },
    })
    expect(
      await store.setStationExclusions(id, [{ name: 'УЧЕБНАЯ', reason: 'Исключить' }]),
    ).toMatchObject({ ok: false, error: { kind: 'invalid-import' } })
    expect(await store.setStationExclusions(id, [{ name: 'ДРУГАЯ', reason: '' }])).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import' },
    })
    expect(snapshot()).toEqual(before)
  })
})
