import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ORG_FORMS, type OrgImport, type OrgImportRow } from '@eow/passport/import-api'
import type { Result } from '@eow/shared/kernel'
import { openPassportDatabase, type PassportDatabase } from './sqlite-passport-store'

const provenance = (form: string, id: string): OrgImportRow => ({
  id,
  importFileId: form,
  validFrom: '2026-01-01',
  validTo: '9999-12-31',
})
function orgFixture(): OrgImport {
  return {
    date: '2027-01-01',
    files: ORG_FORMS.map((form) => ({
      id: form,
      form,
      name: `${form}.xls`,
      sha256: 'a'.repeat(64),
      importedAt: '2026-10-21T06:00:00Z',
      rowCount: 1,
      warnings: [],
    })),
    subdivisions: [
      {
        ...provenance('subdivisions', 'pd'),
        code: 'ПД-1',
        type: 'ПД',
        parentId: null,
        activity: null,
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
    stations: [{ ...provenance('station-pd', 'binding'), station: 'УЧЕБНАЯ', subdivisionId: 'pd' }],
    tracks: [
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

describe('Данные редакции для просмотра', () => {
  let root: string
  let store: PassportDatabase
  let id: number
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-edition-data-'))
    store = await openPassportDatabase(
      join(root, 'passport.sqlite'),
      resolve(import.meta.dirname, '../../migrations'),
    )
    id = value(await store.createDraft({ date: '2027-01-01', label: 'Учебный паспорт' })).id
  })
  afterEach(async () => {
    await store.close()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })

  it('сообщает об отсутствующей редакции', async () => {
    expect(await store.editionData(999)).toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    })
  })

  it('возвращает пустые разделы свежего черновика', async () => {
    const data = value(await store.editionData(id))
    expect(data.edition).toMatchObject({ id, status: 'draft' })
    expect(data.lines).toEqual([])
    expect(data.segments).toEqual([])
    expect(data.stations).toEqual([])
    expect(data.manual).toEqual({
      workKinds: [],
      repairNorms: [],
      tolerances: [],
      trainPairs: [],
      kilometres: [],
    })
    expect(data.org).toEqual({ subdivisions: [], boundaries: [], stations: [], tracks: [] })
  })

  it('читает оргструктуру с названиями вместо внутренних ссылок', async () => {
    value(await store.applyOrgImport(id, orgFixture()))
    const data = value(await store.editionData(id))
    expect(data.org.subdivisions).toEqual([
      {
        id: 'pd',
        importFileId: 'subdivisions',
        validFrom: '2026-01-01',
        validTo: '9999-12-31',
        code: 'ПД-1',
        type: 'ПД',
        parentId: null,
        activity: null,
        active: true,
      },
    ])
    expect(data.org.boundaries[0]).toMatchObject({
      line: 'УЧЕБНЫЙ I',
      subdivisionId: 'pd',
      from: { km: 10, m: 0 },
      to: { km: 11, m: 1045 },
    })
    expect(data.org.stations[0]).toMatchObject({ station: 'УЧЕБНАЯ', subdivisionId: 'pd' })
    expect(data.org.tracks[0]).toMatchObject({
      station: 'УЧЕБНАЯ',
      track: '2',
      meters: { start: 10, end: 450 },
    })
    expect(data.lines[0]).toMatchObject({ name: 'УЧЕБНЫЙ I' })
  })
})
