import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SEGMENT_FORMS, type SegmentRow, type SegmentImport } from '@eow/passport/import-api'
import type { Result } from '@eow/shared/kernel'
import { openPassportDatabase, type PassportDatabase } from './sqlite-passport-store'

const date = '2026-10-21'
function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
const base = {
  lineId: 'line',
  from: { km: 10, m: 0 },
  to: { km: 11, m: 0 },
  statedLength: 964,
  validFrom: null,
  validTo: '9999-12-31',
}
function fixture(token: string): SegmentImport {
  const rows: SegmentRow[] = [
    {
      ...base,
      id: 'class-row',
      importFileId: 'class',
      form: 'class',
      values: { trackClass: '3', group: 'Г', category: '2' },
    },
    {
      ...base,
      id: 'load-row',
      importFileId: 'load',
      form: 'load',
      values: { grossMillionTonKm: 37.5, axleLoad: 0 },
    },
    {
      ...base,
      id: 'speeds-row',
      importFileId: 'speeds',
      form: 'speeds',
      values: {
        passenger: 80,
        freight: 60,
        suburban: null,
        empty: null,
        express: null,
        highSpeed: null,
        restrictionReason: null,
      },
    },
    {
      ...base,
      id: 'rails-row',
      importFileId: 'rails',
      form: 'rails',
      values: {
        railType: 'Р65',
        layingSign: 'о',
        linkLength: 'б/с',
        hardening: null,
        purpose: null,
        plant: null,
        railClass: null,
        railGroup: null,
        laidDate: '2006-02-01',
        reducedWear: '0-12',
        sideWear: null,
        waveWear: null,
        tonnageBefore: null,
        tonnageAfter: 241.3,
      },
    },
    {
      ...base,
      id: 'sleepers-row',
      importFileId: 'sleepers',
      form: 'sleepers',
      values: {
        structure: null,
        baseType: 'БПЖ',
        sleeperType: null,
        density: 1840,
        manufactureYear: null,
        fasteningType: null,
        fasteningDefective: null,
        laidFlag: null,
        padType: null,
        trackSection: null,
        upperAbsorberDate: '2020-01-01',
        upperRepair: null,
        upperPlant: null,
        upperDefective: null,
        lowerAbsorberDate: null,
        lowerRepair: null,
        lowerPlant: null,
        lowerDefective: null,
        secondarySleeperType: 'ЖБ',
        tonnageBefore: null,
        tonnageAfter: null,
        tonnage: 120,
        sidingFlag: null,
      },
    },
    {
      ...base,
      id: 'ballast-row',
      importFileId: 'ballast',
      form: 'ballast',
      values: {
        ballastType: 'щеб',
        thickness: '35-50',
        contamination: 'Д',
        separatingLayer: null,
        geogridType: null,
        geogridHeight: null,
        protectiveThickness: null,
        protectiveType: null,
        prismShortageRight: 0,
        prismShortageLeft: 2.5,
        shoulderShortageRight: null,
        shoulderShortageLeft: null,
        monolithicFlag: null,
        monolithicType: null,
      },
    },
  ]
  return {
    date,
    basisToken: token,
    rows,
    files: SEGMENT_FORMS.map((form) => ({
      id: form,
      form,
      name: `${form}.xls`,
      sha256: 'a'.repeat(64),
      importedAt: '2026-10-21T06:00:00Z',
      rowCount: 1,
      warnings: [{ text: 'Проверьте длину км 10' }],
    })),
  }
}

describe('Характеристики в SQLite', () => {
  let directory: string
  let store: PassportDatabase
  let db: DatabaseSync
  let id: number
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'eow-segments-'))
    const path = join(directory, 'passport.sqlite')
    store = await openPassportDatabase(path, resolve(import.meta.dirname, '../../migrations'))
    id = value(await store.createDraft({ date, label: 'Учебная редакция' })).id
    db = new DatabaseSync(path)
    db.exec('PRAGMA foreign_keys = ON')
    db.prepare(
      "INSERT INTO line(edition_id,id,name,code) VALUES (?, 'line', 'УЧЕБНЫЙ I', 'L1')",
    ).run(id)
  })
  afterEach(async () => {
    db.close()
    await store.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  async function input(): Promise<SegmentImport> {
    return fixture(value(await store.segmentBasis(id)).token)
  }
  const snapshot = () =>
    Object.fromEntries(
      [
        'line',
        'line_km',
        'import_file',
        'seg_class',
        'seg_load',
        'seg_speed',
        'seg_rail',
        'seg_sleeper',
        'seg_ballast',
      ].map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY edition_id, id`).all()]),
    )

  it('сохраняет все шесть форм и читает без потери диапазонов, сторон, дат и нуля', async () => {
    const data = await input()
    value(await store.applySegmentImport(id, data))
    expect(value(await store.segmentData(id))).toEqual(data.rows)
    expect(value(await store.segmentImportReport(id))).toHaveLength(6)
    expect(db.prepare('SELECT * FROM seg_rail').get()).toMatchObject({
      wear_mm: null,
      continuous_welded: 1,
      laid_date: '2006-02-01',
    })
    expect(db.prepare('SELECT * FROM seg_ballast').get()).toMatchObject({
      thickness_cm: null,
      contamination: null,
      stated_length_m: 964,
    })
    expect(db.prepare('SELECT count(*) AS n FROM line_km').get()).toMatchObject({ n: 0 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it.each(['б.п.', 'Б.П.', 'б/с', 'б / с'])(
    'бесстыковой путь «%s» сохраняется с признаком',
    async (linkLength) => {
      const data = await input()
      value(
        await store.applySegmentImport(id, {
          ...data,
          rows: data.rows.map((r) =>
            r.form === 'rails' ? { ...r, values: { ...r.values, linkLength } } : r,
          ),
        }),
      )
      expect(
        db.prepare('SELECT continuous_welded, link_length_m FROM seg_rail').get(),
      ).toMatchObject({
        continuous_welded: 1,
        link_length_m: null,
      })
      expect(
        value(await store.segmentData(id)).find((r) => r.form === 'rails')?.values.linkLength,
      ).toBe(linkLength)
    },
  )

  it('повторная загрузка заменяет строки без дублей, а одна форма не меняет остальные', async () => {
    const data = await input()
    value(await store.applySegmentImport(id, data))
    const before = snapshot()
    value(await store.applySegmentImport(id, data))
    expect(snapshot()).toEqual(before)
    const classRow = data.rows.find((r) => r.form === 'class')!
    value(
      await store.applySegmentImport(id, {
        ...data,
        files: data.files
          .filter((f) => f.form === 'class')
          .map((f) => ({ ...f, id: 'new-file', name: 'новый-номер.xls', warnings: [] })),
        rows: [
          {
            ...classRow,
            importFileId: 'new-file',
            values: { trackClass: '4', group: 'V', category: '3' },
          },
        ],
      }),
    )
    expect(db.prepare('SELECT class FROM seg_class').get()).toMatchObject({ class: '4' })
    expect(db.prepare('SELECT * FROM seg_rail').all()).toEqual(before['seg_rail'])
    expect(value(await store.segmentImportReport(id))).toHaveLength(6)
    value(
      await store.applySegmentImport(id, {
        ...data,
        rows: [],
        files: data.files.filter((f) => f.form === 'class').map((f) => ({ ...f, rowCount: 0 })),
      }),
    )
    expect(db.prepare('SELECT count(*) AS n FROM seg_class').get()).toMatchObject({ n: 0 })
    expect(value(await store.segmentData(id))).toHaveLength(5)
  })

  it('откатывает весь пакет при сбое последней вставки и сохраняет прежний отчёт', async () => {
    const data = await input()
    value(await store.applySegmentImport(id, data))
    const before = snapshot()
    db.exec(
      "CREATE TRIGGER fail_ballast BEFORE INSERT ON seg_ballast BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    )
    expect(
      await store.applySegmentImport(id, {
        ...data,
        files: data.files.map((f) => ({ ...f, sha256: 'b'.repeat(64) })),
      }),
    ).toMatchObject({ ok: false, error: { kind: 'storage' } })
    expect(snapshot()).toEqual(before)
  })

  it('изменение ручного километража или границ после предпросмотра требует повторной сверки', async () => {
    const data = await input()
    db.prepare(
      "INSERT INTO line_km(edition_id,id,line_id,km,length_m) VALUES (?, 'manual-km','line',10,964)",
    ).run(id)
    const before = snapshot()
    expect(await store.applySegmentImport(id, data)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import', message: expect.stringContaining('Повторите предпросмотр') },
    })
    expect(snapshot()).toEqual(before)
    value(await store.applySegmentImport(id, await input()))
    const next = await input()
    db.prepare(
      "INSERT INTO subdivision(edition_id,id,name,code,type,active) VALUES (?, 'pd','ПД-1','ПД-1','ПД',1)",
    ).run(id)
    db.prepare(
      "INSERT INTO subdivision_segment(edition_id,id,line_id,start_km,start_m,end_km,end_m,subdivision_id) VALUES (?, 'pd-span','line',10,0,11,0,'pd')",
    ).run(id)
    expect(await store.applySegmentImport(id, next)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import' },
    })
  })

  it('защищает действующую и архивную редакции; копия сохраняет новые данные и отчёт', async () => {
    const data = await input()
    value(await store.applySegmentImport(id, data))
    value(await store.activate(id))
    expect(await store.applySegmentImport(id, data)).toMatchObject({
      ok: false,
      error: { kind: 'immutable' },
    })
    const draft = value(await store.createDraft({ date, label: 'Новая учебная' }))
    expect(value(await store.segmentData(draft.id))).toEqual(data.rows)
    value(await store.activate(draft.id))
    expect(await store.applySegmentImport(id, data)).toMatchObject({
      ok: false,
      error: { kind: 'immutable' },
    })
    expect(await store.segmentBasis(999)).toMatchObject({ ok: false, error: { kind: 'not-found' } })
    expect(await store.segmentData(999)).toMatchObject({ ok: false, error: { kind: 'not-found' } })
  })

  it('не меняет ручные данные, оргструктуру и строки других форм', async () => {
    const data = await input()
    db.prepare(
      "INSERT INTO import_file VALUES (?, 'org', 'org.xls', 'subdivisions', '2026-10-21T06:00:00Z', ?, 1, '[]')",
    ).run(id, 'c'.repeat(64))
    db.prepare(
      "INSERT INTO seg_class(edition_id,id,line_id,start_km,start_m,end_km,end_m,class) VALUES (?, 'manual','line',20,0,21,0,'5')",
    ).run(id)
    value(await store.applySegmentImport(id, data))
    value(await store.applySegmentImport(id, data))
    expect(db.prepare("SELECT class FROM seg_class WHERE id = 'manual'").get()).toMatchObject({
      class: '5',
    })
    expect(
      db.prepare("SELECT count(*) AS n FROM import_file WHERE id = 'org'").get(),
    ).toMatchObject({ n: 1 })
  })

  it('проверяет ссылки и геометрию, выбирает только разрешённые поля перед JSON-записью', async () => {
    const data = await input()
    expect(
      await store.applySegmentImport(id, {
        ...data,
        rows: data.rows.map((r) => ({ ...r, lineId: 'missing' })),
      }),
    ).toMatchObject({ ok: false, error: { kind: 'invalid-import' } })
    expect(
      await store.applySegmentImport(id, {
        ...data,
        rows: data.rows.map((r) => ({ ...r, to: { km: 9, m: 0 } })),
      }),
    ).toMatchObject({ ok: false, error: { kind: 'invalid-import' } })
    const marker = 'ВЫМЫШЛЕННЫЙ КОРРЕКТИРОВЩИК'
    const contaminated = structuredClone(data)
    for (const row of contaminated.rows) {
      Object.assign(row, { correctedBy: marker })
      Object.assign(row.values, { correctedBy: marker })
    }
    value(await store.applySegmentImport(id, contaminated))
    expect(JSON.stringify(snapshot())).not.toContain(marker)
  })
})
