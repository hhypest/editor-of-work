import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openPassportDatabase, type PassportDatabase } from './sqlite-passport-store'
import { seedPassport } from './testing/passport-fixture'
import type { Result } from '@eow/shared/kernel'
function value<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}
describe('Срез паспорта для создания плана', () => {
  let root: string, store: PassportDatabase, db: DatabaseSync, id: number
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-planning-data-'))
    const path = join(root, 'passport.sqlite')
    store = await openPassportDatabase(path, resolve(import.meta.dirname, '../../migrations'))
    id = value(await store.createDraft({ date: '2027-01-01', label: 'Учебная редакция' })).id
    db = new DatabaseSync(path)
    seedPassport(db, id)
    db.prepare("UPDATE work_kind SET group_name = 'current' WHERE edition_id = ?").run(id)
  })
  afterEach(async () => {
    db.close()
    await store.close()
    await rm(root, { recursive: true, force: true })
  })
  it('читает номера путей и стрелок из таблиц, учитывает исключения и периоды', async () => {
    db.prepare(
      "INSERT INTO station(edition_id,id,name,code,type,valid_from) VALUES(?, 'future','Будущая','F','station','2028-01-01')",
    ).run(id)
    db.prepare(
      "INSERT INTO station(edition_id,id,name,code,type) VALUES(?, 'excluded','Исключённая','E','station')",
    ).run(id)
    db.prepare(
      "INSERT INTO station_track(edition_id,id,station_id,number,valid_to) VALUES(?, 'old','row','9','2026-12-31')",
    ).run(id)
    db.prepare(
      "INSERT INTO station_switch(edition_id,id,station_id,number,valid_from) VALUES(?, 'future-switch','row','99','2028-01-01')",
    ).run(id)
    const data = value(await store.planningData(id))
    expect(data.stations).toEqual([
      { id: 'row', name: 'Вымышленная станция', tracks: ['1'], switches: ['2'] },
    ])
    expect(data.lines[0]?.kmLengths).toEqual([[700, 1250]])
    expect(await store.planningData(999)).toMatchObject({ ok: false, error: { kind: 'not-found' } })
  })
  it('отбирает направления, протяжение и длины км на дату редакции, не меняя обычный просмотр', async () => {
    db.prepare(
      "INSERT INTO line(edition_id,id,name,code,valid_from) VALUES(?,'future','Будущее направление','F','2028-01-01')",
    ).run(id)
    db.prepare(
      "INSERT INTO line_extent(edition_id,id,line_id,start_km,start_m,end_km,end_m,valid_to) VALUES(?,'old','row',690,0,691,0,'2026-12-31')",
    ).run(id)
    db.prepare(
      "INSERT INTO line_km(edition_id,id,line_id,km,length_m,valid_from) VALUES(?,'future','row',701,1100,'2028-01-01')",
    ).run(id)
    const data = value(await store.planningData(id))
    expect(data.lines).toHaveLength(1)
    expect(data.lines[0]?.extents).toEqual([{ from: { km: 700, m: 0 }, to: { km: 701, m: 0 } }])
    expect(data.lines[0]?.kmLengths).toEqual([[700, 1250]])
    const all = value(await store.editionData(id))
    expect(all.lines).toHaveLength(2)
    expect(all.lines.find((l) => l.id === 'row')?.extents).toHaveLength(2)
    expect(all.lines.find((l) => l.id === 'row')?.kmLengths).toHaveLength(2)
  })
})
