import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ORG_FORMS, type OrgImport, type OrgImportRow } from '@eow/passport/import-api'
import type { Result } from '@eow/shared/kernel'
import { openPassportDatabase, type PassportDatabase } from './sqlite-passport-store'
import { lineExtents } from './org-import-storage'

const date = '2026-10-21'
const provenance = (form: string, id: string): OrgImportRow => ({
  id,
  importFileId: form,
  validFrom: '2026-01-01',
  validTo: '9999-12-31',
})
function fixture(): OrgImport {
  return {
    date,
    files: ORG_FORMS.map((form) => ({
      id: form,
      form,
      name: `${form}.xls`,
      sha256: 'a'.repeat(64),
      importedAt: '2026-10-21T06:00:00Z',
      rowCount: 3,
      warnings:
        form === 'boundaries'
          ? [{ text: 'Учебное замечание', at: { file: 'boundaries.xls', sheet: 'Лист1', row: 3 } }]
          : [],
    })),
    subdivisions: [
      {
        ...provenance('subdivisions', 'pchu'),
        code: 'ПЧУ-1',
        type: 'ПЧУ',
        parentId: null,
        activity: null,
        active: true,
      },
      {
        ...provenance('subdivisions', 'pd'),
        code: 'ПД-1',
        type: 'ПД',
        parentId: 'pchu',
        activity: null,
        active: true,
      },
      {
        ...provenance('subdivisions', 'old'),
        code: 'ПД-11',
        type: 'ПД',
        parentId: null,
        activity: null,
        active: false,
      },
      {
        ...provenance('subdivisions', 'zp'),
        code: 'ЗП-1',
        type: 'ЗП',
        parentId: null,
        activity: 'Земляное полотно',
        active: true,
      },
    ],
    boundaries: [
      {
        ...provenance('boundaries', 'boundary'),
        line: 'УЧЕБНЫЙ I',
        statedLength: 2045,
        subdivisionId: 'pd',
        from: { km: 10, m: 0 },
        to: { km: 11, m: 1045 },
      },
    ],
    stations: [
      { ...provenance('station-pd', 'station-binding'), station: 'УЧЕБНАЯ', subdivisionId: 'pd' },
    ],
    tracks: [
      {
        ...provenance('track-pd', 'whole'),
        station: 'УЧЕБНАЯ',
        track: '1',
        subdivisionId: 'pd',
        meters: null,
      },
      {
        ...provenance('track-pd', 'part'),
        station: 'УЧЕБНАЯ',
        track: '2',
        subdivisionId: 'pd',
        meters: { start: 10, end: 450 },
      },
    ],
  }
}
function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}

describe('Запись оргструктуры в черновик паспорта', () => {
  let root: string
  let path: string
  let store: PassportDatabase
  let db: DatabaseSync
  let id: number
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-org-'))
    path = join(root, 'passport.sqlite')
    store = await openPassportDatabase(path, resolve(import.meta.dirname, '../../migrations'))
    id = value(await store.createDraft({ date, label: 'Учебный паспорт' })).id
    db = new DatabaseSync(path)
    db.exec('PRAGMA foreign_keys = ON')
  })
  afterEach(async () => {
    db.close()
    await store.close()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  const rows = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY edition_id, id`).all()
  const snapshot = () =>
    Object.fromEntries(
      [
        'import_file',
        'subdivision',
        'subdivision_segment',
        'line',
        'line_extent',
        'station',
        'station_pd',
        'station_track',
        'station_track_pd',
      ].map((t) => [t, rows(t)]),
    )

  it('при записи границы нормализует -1 как отсутствие исходной длины', async () => {
    const data = fixture()
    value(
      await store.applyOrgImport(id, {
        ...data,
        boundaries: data.boundaries.map((b) => ({ ...b, statedLength: -1 })),
      }),
    )
    expect(db.prepare('SELECT stated_length_m FROM subdivision_segment').get()).toMatchObject({
      stated_length_m: null,
    })
  })

  it('сохраняет ПЧУ → ПД, прежний ПД, цех, нестандартные метры и оба вида привязки пути', async () => {
    value(await store.applyOrgImport(id, fixture()))
    expect(rows('subdivision')).toMatchObject([
      { id: 'old', active: 0 },
      { id: 'pchu', active: 1 },
      { id: 'pd', parent_id: 'pchu', active: 1 },
      { id: 'zp', type: 'ЗП', parent_id: null },
    ])
    expect(rows('subdivision_segment')).toMatchObject([
      { end_m: 1045, valid_to: '9999-12-31', import_file_id: 'boundaries' },
    ])
    expect(rows('station_track_pd')).toMatchObject([
      { whole_track: 0, start_m: 10, end_m: 450 },
      { whole_track: 1, start_m: null, end_m: null },
    ])
    expect(rows('station_pd')).toHaveLength(1)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('записывает протяжение направления по границам отмеченных ПД и заменяет его при повторном импорте', async () => {
    const input = fixture()
    value(await store.applyOrgImport(id, input))
    expect(rows('line_extent')).toMatchObject([
      {
        line_id: '["line","УЧЕБНЫЙ I"]',
        start_km: 10,
        start_m: 0,
        end_km: 11,
        end_m: 1045,
        import_file_id: 'boundaries',
        valid_from: null,
        valid_to: null,
      },
    ])
    value(
      await store.applyOrgImport(id, {
        ...input,
        boundaries: input.boundaries.map((b) => ({ ...b, to: { km: 12, m: 0 } })),
      }),
    )
    expect(rows('line_extent')).toMatchObject([{ start_km: 10, end_km: 12, end_m: 0 }])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('читает контрольную сумму, число исходных строк и замечания после повторного открытия', async () => {
    const input = fixture()
    value(await store.applyOrgImport(id, input))
    await store.close()
    store = await openPassportDatabase(path, resolve(import.meta.dirname, '../../migrations'))
    expect(value(await store.orgImportReport(id))).toEqual(
      input.files.toSorted((a, b) => a.id.localeCompare(b.id)),
    )
    expect(await store.orgImportReport(999)).toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    })
  })

  it('повторный импорт не дублирует строки, заменяет изменённые и удаляет исчезнувшие привязки', async () => {
    const input = fixture()
    value(await store.applyOrgImport(id, input))
    const before = snapshot()
    value(await store.applyOrgImport(id, input))
    expect(snapshot()).toEqual(before)
    value(
      await store.applyOrgImport(id, {
        ...input,
        tracks: input.tracks.slice(1),
        stations: [],
        boundaries: input.boundaries.map((b) => ({ ...b, to: { km: 12, m: 0 } })),
        files: input.files.map((f) => ({
          ...f,
          name: `новый-${f.name}`,
          sha256: 'b'.repeat(64),
          warnings: [],
        })),
      }),
    )
    expect(rows('station_track_pd')).toHaveLength(1)
    expect(rows('station_pd')).toEqual([])
    expect(rows('subdivision_segment')).toMatchObject([{ end_km: 12 }])
    expect(rows('import_file')).toHaveLength(4)
    expect(
      value(await store.orgImportReport(id)).every(
        (f) => f.sha256 === 'b'.repeat(64) && f.warnings.length === 0,
      ),
    ).toBe(true)
  })

  it('несколько частей одной формы записываются вместе и заменяются полным набором', async () => {
    const input = fixture()
    const part = { ...input.files[1]!, id: 'boundaries-part2', name: 'part2.xls' }
    value(
      await store.applyOrgImport(id, {
        ...input,
        files: [...input.files, part],
        boundaries: [
          ...input.boundaries,
          { ...input.boundaries[0]!, id: 'b2', importFileId: part.id, line: 'УЧЕБНЫЙ II' },
        ],
      }),
    )
    expect(rows('subdivision_segment')).toHaveLength(2)
    value(await store.applyOrgImport(id, input))
    expect(rows('subdivision_segment')).toHaveLength(1)
    expect(rows('import_file')).toHaveLength(4)
  })

  it('сохраняет код станции, длины путей, ручные данные и данные остальных форм', async () => {
    value(await store.applyOrgImport(id, fixture()))
    db.prepare("UPDATE station SET code = '123456', type = 'станция'").run()
    db.prepare("UPDATE station_track SET full_length_m = 1520, purpose = 'приёмоотправочный'").run()
    db.prepare(
      "INSERT INTO import_file VALUES (?, 'other', 'class.xls', 'class', '2026-10-21T06:00:00Z', ?, 1, '[]')",
    ).run(id, 'c'.repeat(64))
    db.prepare(
      "INSERT INTO tolerance(edition_id,id,code,name,value,unit) VALUES (?, 'manual','x','Учебный допуск',7,'м')",
    ).run(id)
    value(await store.applyOrgImport(id, fixture()))
    expect(rows('station')).toMatchObject([{ code: '123456', type: 'станция' }])
    expect(rows('station_track').every((r) => r['full_length_m'] === 1520)).toBe(true)
    expect(rows('tolerance')).toHaveLength(1)
    expect(rows('import_file')).toHaveLength(5)
  })

  it('ошибка последней вставки откатывает и удаление прежних строк, и новый журнал', async () => {
    value(await store.applyOrgImport(id, fixture()))
    const before = snapshot()
    db.exec(
      "CREATE TRIGGER fail_track BEFORE INSERT ON station_track_pd BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    )
    expect(await store.applyOrgImport(id, { ...fixture(), stations: [] })).toMatchObject({
      ok: false,
      error: { kind: 'storage' },
    })
    expect(snapshot()).toEqual(before)
  })

  it.each(['line', 'station', 'track-station'] as const)(
    'неоднозначное имя %s возвращает ошибку импорта до любой записи',
    async (kind) => {
      const input = fixture()
      value(await store.applyOrgImport(id, input))
      if (kind === 'line')
        db.prepare(
          "INSERT INTO line(edition_id,id,name,code) VALUES (?, 'duplicate', 'УЧЕБНЫЙ I', 'DUP')",
        ).run(id)
      else
        db.prepare(
          "INSERT INTO station(edition_id,id,name,code,type) VALUES (?, 'duplicate', 'УЧЕБНАЯ', 'DUP', '')",
        ).run(id)
      const before = snapshot()
      const result = await store.applyOrgImport(id, {
        ...input,
        // Новые справочники идут перед неоднозначной ссылкой: и они не должны появиться.
        boundaries: [
          { ...input.boundaries[0]!, id: 'new-boundary', line: 'НОВЫЙ УЧЕБНЫЙ' },
          ...input.boundaries,
        ],
        stations:
          kind === 'track-station'
            ? []
            : [
                { ...input.stations[0]!, id: 'new-station', station: 'НОВАЯ УЧЕБНАЯ' },
                ...input.stations,
              ],
        files: input.files.map((f) => ({ ...f, sha256: 'd'.repeat(64) })),
      })
      expect(result).toMatchObject({
        ok: false,
        error: {
          kind: 'invalid-import',
          message: expect.stringContaining(
            kind === 'line' ? 'Направление «УЧЕБНЫЙ I»' : 'Станция «УЧЕБНАЯ»',
          ),
        },
      })
      expect(snapshot()).toEqual(before)
      if (kind === 'line') db.prepare("DELETE FROM line WHERE id = 'duplicate'").run()
      else db.prepare("DELETE FROM station WHERE id = 'duplicate'").run()
      // Отказ не ломает очередь; после исправления справочника тот же импорт успешен.
      value(await store.applyOrgImport(id, input))
    },
  )

  it('ссылка из другого раздела на удаляемый ПД приводит к полному откату на COMMIT', async () => {
    value(await store.applyOrgImport(id, fixture()))
    const station = rows('station')[0]!['id']
    db.prepare(
      "INSERT INTO station_pd(edition_id,id,station_id,subdivision_id) VALUES (?, 'manual', ?, 'old')",
    ).run(id, station!)
    const before = snapshot()
    expect(
      await store.applyOrgImport(id, {
        ...fixture(),
        subdivisions: fixture().subdivisions.filter((s) => s.id !== 'old'),
      }),
    ).toMatchObject({ ok: false })
    expect(snapshot()).toEqual(before)
    // Ошибка COMMIT не оставляет открытую транзакцию и не ломает очередь.
    value(await store.applyOrgImport(id, fixture()))
  })

  it('отклоняет другую дату, отсутствующую, действующую и архивную редакции без записи', async () => {
    const input = fixture()
    expect(await store.applyOrgImport(999, input)).toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    })
    expect(await store.applyOrgImport(id, { ...input, date: '2026-10-22' })).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import' },
    })
    value(await store.applyOrgImport(id, input))
    value(await store.activate(id))
    expect(await store.applyOrgImport(id, input)).toMatchObject({
      ok: false,
      error: { kind: 'immutable' },
    })
    const next = value(await store.createDraft({ date, label: 'Вторая' }))
    value(await store.applyOrgImport(next.id, { ...input, stations: [] }))
    expect(rows('station_pd')).toHaveLength(1)
    value(await store.activate(next.id))
    expect(await store.applyOrgImport(id, input)).toMatchObject({
      ok: false,
      error: { kind: 'immutable' },
    })
  })

  it.each([
    (x: OrgImport) => ({ ...x, files: x.files.slice(1) }),
    (x: OrgImport) => ({ ...x, subdivisions: [...x.subdivisions, x.subdivisions[0]!] }),
    (x: OrgImport) => ({
      ...x,
      tracks: x.tracks.map((t) => ({ ...t, meters: { start: 20, end: 10 } })),
    }),
    (x: OrgImport) => ({
      ...x,
      boundaries: x.boundaries.map((b) => ({ ...b, subdivisionId: 'missing' })),
    }),
    (x: OrgImport) => ({
      ...x,
      stations: x.stations.map((s) => ({ ...s, importFileId: 'boundaries' })),
    }),
  ])('отклоняет неполный пакет, дубли и нарушения связей до записи', async (change) => {
    value(await store.applyOrgImport(id, fixture()))
    const before = snapshot()
    expect(await store.applyOrgImport(id, change(fixture()))).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import' },
    })
    expect(snapshot()).toEqual(before)
  })

  it('не сохраняет посторонние поля и ФИО корректировщика даже в лишних полях замечания', async () => {
    const marker = 'ВЫМЫШЛЕННЫЙ КОРРЕКТИРОВЩИК'
    const input = fixture()
    value(
      await store.applyOrgImport(id, {
        ...input,
        subdivisions: input.subdivisions.map((s) => ({ ...s, correctedBy: marker })),
        files: input.files.map((f) => ({
          ...f,
          correctedBy: marker,
          warnings: [{ text: 'Замечание', correctedBy: marker }],
        })),
      }),
    )
    expect(JSON.stringify(snapshot())).not.toContain(marker)
    await store.close()
    expect((await readFile(path)).includes(Buffer.from(marker))).toBe(false)
  })
})

describe('Протяжение направления по границам ПД', () => {
  const unit = (id: string, type: string, active = true) => ({
    ...provenance('subdivisions', id),
    code: id,
    type,
    parentId: null,
    activity: null,
    active,
  })
  const border = (
    id: string,
    subdivisionId: string,
    line: string,
    from: [number, number],
    to: [number, number],
  ) => ({
    ...provenance('boundaries', id),
    line,
    statedLength: null,
    subdivisionId,
    from: { km: from[0], m: from[1] },
    to: { km: to[0], m: to[1] },
  })

  it('сливает касающиеся и перекрытые границы, сохраняет разрыв и не берёт ЗП, ПЧУ и неотмеченные ПД', () => {
    expect(
      lineExtents({
        subdivisions: [
          unit('pd1', 'ПД'),
          unit('pd2', 'ПД'),
          unit('pd3', 'ПД'),
          unit('old', 'ПД', false),
          unit('zp', 'ЗП'),
          unit('pchu', 'ПЧУ'),
        ],
        boundaries: [
          border('c', 'pd2', 'L1', [30, 0], [45, 0]),
          border('a', 'pd1', 'L1', [10, 0], [18, 0]),
          border('b', 'pd2', 'L1', [18, 0], [25, 0]),
          border('d', 'pd3', 'L1', [44, 500], [60, 500]),
          border('e', 'pd3', 'L2', [100, 200], [131, 700]),
          border('f', 'old', 'L1', [25, 0], [30, 0]),
          border('g', 'zp', 'L1', [10, 0], [60, 500]),
          border('h', 'pchu', 'L2', [90, 0], [140, 0]),
        ],
      }),
    ).toEqual([
      { line: 'L1', from: { km: 10, m: 0 }, to: { km: 25, m: 0 }, importFileId: 'boundaries' },
      { line: 'L1', from: { km: 30, m: 0 }, to: { km: 60, m: 500 }, importFileId: 'boundaries' },
      {
        line: 'L2',
        from: { km: 100, m: 200 },
        to: { km: 131, m: 700 },
        importFileId: 'boundaries',
      },
    ])
  })

  it('граница внутри другой не укорачивает часть протяжения', () => {
    expect(
      lineExtents({
        subdivisions: [unit('pd1', 'ПД'), unit('pd2', 'ПД')],
        boundaries: [
          border('a', 'pd1', 'L1', [10, 0], [20, 0]),
          border('b', 'pd2', 'L1', [12, 0], [15, 0]),
        ],
      }),
    ).toEqual([
      { line: 'L1', from: { km: 10, m: 0 }, to: { km: 20, m: 0 }, importFileId: 'boundaries' },
    ])
  })
})
