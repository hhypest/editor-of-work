import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  STATION_FORMS,
  type PassportStationImport,
  type StationBasis,
  type StationImport,
} from '@eow/passport/import-api'
import { err, ok } from '@eow/shared/kernel'
import { generatePassportFixtures } from '../testing/passport/generate'
import { LINES, EDITORS } from '../testing/passport/model'
import { importStationExports } from './import-station-exports'

const basis: StationBasis = {
  date: '2026-10-21',
  token: 'a'.repeat(64),
  lines: LINES.map((l, i) => ({ id: String(i), name: l.name, kmLengths: l.kmLengths })),
  stations: [],
  tracks: [],
  excludedStations: [],
}
const importedAt = '2026-10-21T06:00:00Z'
let files: { name: string; bytes: Uint8Array }[]
beforeAll(async () => {
  files = (await generatePassportFixtures())
    .filter((f) => !f.path.startsWith('frameset/') && STATION_FORMS.some((form) => form === f.form))
    .map((f) => ({ name: f.path, bytes: f.bytes }))
})
function setup(current = basis) {
  let saved: StationImport | undefined
  const store: PassportStationImport = {
    stationBasis: vi.fn<PassportStationImport['stationBasis']>(async () => ok(current)),
    applyStationImport: vi.fn<PassportStationImport['applyStationImport']>(async (_id, input) => {
      saved = input
      return ok(undefined)
    }),
    stationData: vi.fn<PassportStationImport['stationData']>(async () => ok([])),
    stationImportReport: vi.fn<PassportStationImport['stationImportReport']>(async () => ok([])),
    setStationExclusions: vi.fn<PassportStationImport['setStationExclusions']>(async () =>
      ok(undefined),
    ),
  }
  return {
    store,
    data: () => {
      if (!saved) throw new Error('записи не было')
      return saved
    },
  }
}
describe('Станционные выгрузки → опубликованный API Паспорта', () => {
  it('семь форм, исходные суммы, полный набор данных без корректировщиков и служебных листов', async () => {
    const { store, data } = setup()
    expect(files).toHaveLength(7)
    const result = await importStationExports(store, { editionId: 1, files, importedAt })
    if (!result.ok) throw new Error(result.error.message)
    expect(data().files).toHaveLength(7)
    expect(data().rows.filter((r) => r.form === 'station-tracks')).toHaveLength(20)
    expect(data().rows.filter((r) => r.form === 'switches')).toHaveLength(30)
    expect(data().rows.filter((r) => r.form === 'okato')).toHaveLength(4)
    expect(result.value.exclusionCandidates).toEqual(['ЗАРЕЧЬЕ'])
    expect(result.value.remarks.map((r) => r.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('перевода № 11'),
        expect.stringContaining('вне её границ'),
      ]),
    )
    expect(
      data().rows.some(
        (r) =>
          r.form === 'crossings-general' &&
          r.values.trainsPerDay === 14 &&
          r.values.trainSpeed === 90,
      ),
    ).toBe(true)
    for (const f of files)
      expect(data().files.find((x) => x.name === f.name)?.sha256).toBe(
        createHash('sha256').update(f.bytes).digest('hex'),
      )
    for (const f of data().files)
      expect(f.warnings.every((r) => !r.at || r.at.file === f.name)).toBe(true)
    for (const editor of EDITORS.filter(Boolean))
      expect(JSON.stringify(data())).not.toContain(editor)
    expect(JSON.stringify(data())).not.toMatch(/BExRepositorySheet|Скорректировал/u)
    expect(store.setStationExclusions).not.toHaveBeenCalled()
  })
  it('явный список исключений убирает станции из осей и экспликаций, сохраняя переезды', async () => {
    const { store, data } = setup({
      ...basis,
      excludedStations: [{ name: 'ЗАРЕЧЬЕ', reason: 'Учебное исключение' }],
    })
    const result = await importStationExports(store, { editionId: 1, files, importedAt })
    expect(result.ok).toBe(true)
    expect(data().rows.some((r) => 'station' in r.values && r.values.station === 'ЗАРЕЧЬЕ')).toBe(
      false,
    )
    expect(
      data().rows.some(
        (r) => r.form === 'crossings-general' && r.values.titleStation === 'ЗАРЕЧЬЕ',
      ),
    ).toBe(true)
  })
  it('неполный пакет, повтор имени и неизвестное направление не вызывают запись', async () => {
    const { store } = setup({ ...basis, lines: [] })
    for (const input of [files, files.slice(1), [...files, files[0]!]]) {
      expect(
        (await importStationExports(store, { editionId: 1, files: input, importedAt })).ok,
      ).toBe(false)
    }
    expect(store.applyStationImport).not.toHaveBeenCalled()
  })
  it('возвращает отказ Паспорта, не объявляя импорт успешным', async () => {
    const { store } = setup()
    vi.mocked(store.applyStationImport).mockResolvedValue(
      err({ kind: 'immutable', message: 'Только черновик.' }),
    )
    expect(await importStationExports(store, { editionId: 1, files, importedAt })).toEqual(
      err({ kind: 'immutable', message: 'Только черновик.' }),
    )
  })
})
