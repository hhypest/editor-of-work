import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Result } from '@eow/shared/kernel'
import type { StationLayout, StationSchemeImport } from '@eow/passport/import-api'
import { openPassportDatabase, type PassportDatabase } from './sqlite-passport-store'

function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}

const layout: StationLayout = {
  version: 1,
  nodes: [
    { id: 'a', col: 0, row: 1, kind: 'end', end: 'open' },
    { id: 's', col: 4, row: 1, kind: 'switch' },
    { id: 'b', col: 20, row: 1, kind: 'end', end: 'open' },
    { id: 'c', col: 6, row: 0, kind: 'bend' },
    { id: 'd', col: 18, row: 0, kind: 'end', end: 'stop' },
  ],
  tracks: [
    {
      id: 't1',
      number: 'I',
      kind: 'main',
      state: 'normal',
      nodes: ['a', 's', 'b'],
      fullLength: 900,
      capacity: null,
    },
    {
      id: 't2',
      number: '3',
      kind: 'station',
      state: 'normal',
      nodes: ['s', 'c', 'd'],
      fullLength: null,
      capacity: '40',
    },
  ],
  switches: [{ id: 'w1', number: '1', node: 's', track: 't1', branch: 't2' }],
  derailers: [{ id: 'r1', number: '3со', track: 't2', col: 10 }],
  bridges: [{ id: 'g1', label: null, track: 't1', fromCol: 12, toCol: 14 }],
  crossings: [{ id: 'x1', label: 'переезд 5км', km: 5, pk: null, col: 16, fromRow: 0, toRow: 1 }],
}

describe('Раскладки схем станций в SQLite', () => {
  let root: string, db: DatabaseSync, store: PassportDatabase, id: number
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-schemes-'))
    const path = join(root, 'passport.sqlite')
    store = await openPassportDatabase(path, resolve(import.meta.dirname, '../../migrations'))
    id = value(await store.createDraft({ date: '2026-10-21', label: 'Учебная редакция' })).id
    db = new DatabaseSync(path)
    db.exec('PRAGMA foreign_keys=ON')
    db.prepare(
      "INSERT INTO station(edition_id,id,name,code,type) VALUES (?,'station','УЧЕБНАЯ','S','station')",
    ).run(id)
    db.prepare(
      "INSERT INTO station_track(edition_id,id,station_id,number,full_length_m) VALUES (?,'track','station','3',350)",
    ).run(id)
    db.prepare(
      "INSERT INTO station_switch(edition_id,id,station_id,number) VALUES (?,'switch','station','1')",
    ).run(id)
  })
  afterEach(async () => {
    db.close()
    await store.close()
    await rm(root, { recursive: true, force: true })
  })

  const command = (token: string, at = '2026-11-02T10:00:00.000Z'): StationSchemeImport => ({
    basisToken: token,
    files: [
      {
        id: `file-${at}`,
        name: 'Учебная.pdf',
        sha256: 'c'.repeat(64),
        importedAt: at,
        warnings: [{ text: 'проверьте путь 3' }],
      },
    ],
    layouts: [{ stationId: 'station', importFileId: `file-${at}`, layout }],
  })
  const rows = (sql: string) => db.prepare(sql).all(id)

  it('отдаёт станции, экспликации и записанные раскладки', async () => {
    const basis = value(await store.stationSchemeBasis(id))
    expect(basis.stations).toEqual([{ id: 'station', name: 'УЧЕБНАЯ' }])
    expect(basis.tracks).toEqual([{ stationId: 'station', number: '3', fullLength: 350 }])
    expect(basis.switches).toEqual([{ stationId: 'station', number: '1' }])
    expect(basis.layouts).toEqual([])
  })

  it('записывает раскладку и файл схемы', async () => {
    const basis = value(await store.stationSchemeBasis(id))
    value(await store.applyStationSchemeImport(id, command(basis.token)))
    const [row] = rows(
      'SELECT station_id, layout, import_file_id FROM station_layout WHERE edition_id = ?',
    ) as {
      layout: string
      import_file_id: string
    }[]
    expect(JSON.parse(row!.layout)).toEqual(layout)
    expect(rows('SELECT form, row_count FROM import_file WHERE edition_id = ?')).toEqual([
      { form: 'station-scheme', row_count: 2 },
    ])
    expect(value(await store.stationSchemeBasis(id)).layouts).toEqual(['station'])
  })

  it('заменяет раскладку станции и удаляет запись прежнего файла', async () => {
    value(
      await store.applyStationSchemeImport(
        id,
        command(value(await store.stationSchemeBasis(id)).token),
      ),
    )
    const again = command(
      value(await store.stationSchemeBasis(id)).token,
      '2026-11-03T10:00:00.000Z',
    )
    value(await store.applyStationSchemeImport(id, again))
    expect(rows('SELECT import_file_id FROM station_layout WHERE edition_id = ?')).toEqual([
      { import_file_id: 'file-2026-11-03T10:00:00.000Z' },
    ])
    expect(rows('SELECT id FROM import_file WHERE edition_id = ?')).toEqual([
      { id: 'file-2026-11-03T10:00:00.000Z' },
    ])
  })

  it('отклоняет запись после изменения экспликаций', async () => {
    const token = value(await store.stationSchemeBasis(id)).token
    db.prepare(
      "INSERT INTO station_track(edition_id,id,station_id,number) VALUES (?,'track2','station','5')",
    ).run(id)
    const result = await store.applyStationSchemeImport(id, command(token))
    expect(!result.ok && result.error.message).toContain('Повторите предпросмотр')
    expect(rows('SELECT id FROM station_layout WHERE edition_id = ?')).toEqual([])
  })

  it('не записывает раскладку с нарушенной привязкой стрелки', async () => {
    const token = value(await store.stationSchemeBasis(id)).token
    const bad = command(token)
    const broken = {
      ...bad,
      layouts: [
        {
          ...bad.layouts[0]!,
          layout: { ...layout, switches: [{ ...layout.switches[0]!, track: 't2' }] },
        },
      ],
    }
    const result = await store.applyStationSchemeImport(id, broken)
    expect(!result.ok && result.error.message).toContain('стрелки 1')
  })

  it('не меняет действующую редакцию', async () => {
    const token = value(await store.stationSchemeBasis(id)).token
    db.prepare("UPDATE edition SET status = 'active' WHERE id = ?").run(id)
    const result = await store.applyStationSchemeImport(id, command(token))
    expect(result.ok).toBe(false)
  })

  it('отдаёт станции с признаком раскладки и саму раскладку с версией', async () => {
    expect(value(await store.stationLayoutList(id))).toEqual([
      { id: 'station', name: 'УЧЕБНАЯ', hasLayout: false },
    ])
    expect(value(await store.stationLayout(id, 'station'))).toBeNull()
    value(
      await store.applyStationSchemeImport(
        id,
        command(value(await store.stationSchemeBasis(id)).token),
      ),
    )
    const stored = value(await store.stationLayout(id, 'station'))!
    expect(stored.layout).toEqual(layout)
    expect(stored.editable).toBe(true)
    expect(stored.version).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('сохраняет правку раскладки с новой версией и ссылкой на прежний файл схемы', async () => {
    value(
      await store.applyStationSchemeImport(
        id,
        command(value(await store.stationSchemeBasis(id)).token),
      ),
    )
    const stored = value(await store.stationLayout(id, 'station'))!
    const moved = {
      ...layout,
      nodes: layout.nodes.map((n) => (n.id === 'c' ? { ...n, col: 7 } : n)),
    }
    const saved = value(await store.saveStationLayout(id, 'station', moved, stored.version))
    expect(saved.version).not.toBe(stored.version)
    expect(value(await store.stationLayout(id, 'station'))!.layout).toEqual(moved)
    expect(rows('SELECT import_file_id FROM station_layout WHERE edition_id = ?')).toEqual([
      { import_file_id: 'file-2026-11-02T10:00:00.000Z' },
    ])
    const stale = await store.saveStationLayout(id, 'station', layout, stored.version)
    expect(!stale.ok && stale.error.message).toContain('изменили после открытия')
  })

  it('не сохраняет раскладку с нарушением правил и в действующей редакции', async () => {
    value(
      await store.applyStationSchemeImport(
        id,
        command(value(await store.stationSchemeBasis(id)).token),
      ),
    )
    const { version } = value(await store.stationLayout(id, 'station'))!
    const broken = { ...layout, switches: [{ ...layout.switches[0]!, node: 'c' }] }
    expect((await store.saveStationLayout(id, 'station', broken, version)).ok).toBe(false)
    db.prepare("UPDATE edition SET status = 'active' WHERE id = ?").run(id)
    expect(value(await store.stationLayout(id, 'station'))!.editable).toBe(false)
    expect((await store.saveStationLayout(id, 'station', layout, version)).ok).toBe(false)
  })
})
