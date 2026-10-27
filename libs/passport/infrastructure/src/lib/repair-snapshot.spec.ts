import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { repairReports } from '@eow/passport/application'
import type { Result } from '@eow/shared/kernel'
import { openPassportDatabase, type PassportDatabase } from './sqlite-passport-store'
import { seedPassport } from './testing/passport-fixture'
import { stationFixture } from './testing/station-import-fixture'

function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
describe('Согласованный срез SQLite для расчёта ремонтов', () => {
  let root: string, db: DatabaseSync, store: PassportDatabase, id: number
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-repair-'))
    const path = join(root, 'passport.sqlite')
    store = await openPassportDatabase(path, resolve(import.meta.dirname, '../../migrations'))
    id = value(await store.createDraft({ date: '2027-01-01', label: 'Учебная редакция' })).id
    db = new DatabaseSync(path)
    seedPassport(db, id)
    const rails = {
      railType: 'Р65',
      layingSign: 'о',
      linkLength: null,
      hardening: null,
      purpose: null,
      plant: null,
      railClass: null,
      railGroup: null,
      laidDate: '2000-01-01',
      reducedWear: null,
      sideWear: null,
      waveWear: null,
      tonnageBefore: 999,
      tonnageAfter: 80,
    }
    db.prepare(
      "UPDATE seg_rail SET details=?, import_file_id='row', valid_to='9999-12-31' WHERE edition_id=?",
    ).run(JSON.stringify(rails), id)
    db.prepare('UPDATE repair_norm SET million_tons=100 WHERE edition_id=?').run(id)
    const track = stationFixture('token').rows.find((r) => r.form === 'station-tracks')!
    const details = {
      ...track,
      values: { ...track.values, station: 'Вымышленная станция', number: '1' },
    }
    db.prepare('UPDATE station_track SET details=? WHERE edition_id=?').run(
      JSON.stringify(details),
      id,
    )
  })
  afterEach(async () => {
    db.close()
    await store.close()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  it('читает нестандартный км, любой признак укладки и только тоннаж после неё; не пишет результаты', async () => {
    const before = db.prepare('PRAGMA data_version').get()
    const report = value(await repairReports(store).report(id))
    expect(report.rows).toHaveLength(2)
    expect(report.rows[0]).toMatchObject({
      location: { lengthM: 1250 },
      lastRepairYear: 2000,
      tonnageAfter: 80,
    })
    expect(report.rows[0]!.assessments[0]).toMatchObject({
      status: 'due',
      dueYear: 2007,
      overdueYears: 20,
      overdueMillionTons: 0,
    })
    expect(report.rows[1]).toMatchObject({
      location: { kind: 'station', station: 'Вымышленная станция', track: '1' },
      lastRepairYear: 2006,
      tonnageAfter: null,
    })
    expect(db.prepare('PRAGMA data_version').get()).toEqual(before)
    expect(value(await repairReports(store).report(id))).toEqual(report)
  })
  it('сохраняет расчёт архивной редакции после изменения норм в новой', async () => {
    value(await store.activate(id))
    const original = value(await repairReports(store).report(id))
    const next = value(
      await store.createDraft({ date: '2028-01-01', label: 'Следующая учебная' }),
    ).id
    db.prepare('UPDATE repair_norm SET years=99 WHERE edition_id=?').run(next)
    value(await store.activate(next))
    expect(value(await repairReports(store).report(id))).toEqual(original)
    expect(value(await repairReports(store).report(next)).rows[0]!.assessments[0]).toMatchObject({
      status: 'planned',
      dueYear: 2099,
    })
  })
  it('учитывает период вида работ и исключения станций', async () => {
    db.prepare('UPDATE work_kind SET valid_to=? WHERE edition_id=?').run('2026-12-31', id)
    db.prepare('UPDATE excluded_object SET object_id=? WHERE edition_id=?').run('row', id)
    const report = value(await repairReports(store).report(id))
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]!.assessments[0]!.status).toBe('no-norm')
  })
  it('возвращает not-found для отсутствующей редакции', async () => {
    expect(await repairReports(store).report(9999)).toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    })
  })
  it('не использует истёкшие длины км и родительские станции после переноса даты редакции', async () => {
    db.prepare('UPDATE line_km SET valid_to=? WHERE edition_id=?').run('2026-12-31', id)
    db.prepare("UPDATE station SET valid_from='2020-01-01', valid_to=? WHERE edition_id=?").run(
      '2026-12-31',
      id,
    )
    const report = value(await repairReports(store).report(id))
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]!.location).toMatchObject({ lengthM: 1000 })
    db.prepare('UPDATE line_extent SET valid_to=? WHERE edition_id=?').run('2026-12-31', id)
    expect(value(await repairReports(store).report(id)).rows).toHaveLength(0)
  })
})
