import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  SEGMENT_FORMS,
  type PassportSegmentImport,
  type SegmentBasis,
  type SegmentImport,
} from '@eow/passport/import-api'
import { err, ok } from '@eow/shared/kernel'
import { generatePassportFixtures } from '../testing/passport/generate'
import { EDITORS, LINES } from '../testing/passport/model'
import { importSegmentExports } from './import-segment-exports'

const basis: SegmentBasis = {
  token: 'a'.repeat(64),
  date: '2026-10-21',
  boundaries: [],
  lines: LINES.map((l, i) => ({ id: String(i), name: l.name, kmLengths: l.kmLengths })),
}
const importedAt = '2026-10-21T06:00:00Z'
async function files() {
  return (await generatePassportFixtures())
    .filter((f) => SEGMENT_FORMS.some((form) => form === f.form))
    .map((f) => ({ name: f.path, bytes: f.bytes }))
}
function setup(current = basis) {
  let command: SegmentImport | undefined
  const store: PassportSegmentImport = {
    segmentBasis: vi.fn<PassportSegmentImport['segmentBasis']>(async () => ok(current)),
    applySegmentImport: vi.fn<PassportSegmentImport['applySegmentImport']>(async (_id, data) => {
      command = data
      return ok(undefined)
    }),
    segmentImportReport: vi.fn<PassportSegmentImport['segmentImportReport']>(async () => ok([])),
    segmentData: vi.fn<PassportSegmentImport['segmentData']>(async () => ok([])),
  }
  return { store, command: () => command! }
}

describe('Выгрузки характеристик → сценарий Паспорта', () => {
  it('читает все шесть форм и сохраняет диапазоны, даты и признаки без ФИО и прежних ПД', async () => {
    const { store, command } = setup()
    const input = await files()
    expect(input).toHaveLength(6)
    const result = await importSegmentExports(store, { editionId: 1, files: input, importedAt })
    expect(result.ok).toBe(true)
    const data = command()
    expect(new Set(data.rows.map((r) => r.form))).toEqual(new Set(SEGMENT_FORMS))
    expect(data.files).toHaveLength(6)
    for (const f of input)
      expect(data.files.find((x) => x.name === f.name)?.sha256).toBe(
        createHash('sha256').update(f.bytes).digest('hex'),
      )
    const rail = data.rows.find((r) => r.form === 'rails')!
    expect(rail.values).toMatchObject({ reducedWear: '0-12', linkLength: 'б.п.', plant: 'ЗСМК' })
    expect(data.rows.filter((r) => r.form === 'rails').map((r) => r.values.layingSign)).toEqual(
      expect.arrayContaining(['Н', 'П', 'о']),
    )
    const ballast = data.rows.find((r) => r.form === 'ballast')!
    expect(ballast.values).toMatchObject({
      thickness: '35-50',
      protectiveThickness: null,
      prismShortageRight: 0,
    })
    const sleeper = data.rows.find((r) => r.form === 'sleepers')!
    expect(sleeper.values).toMatchObject({
      manufactureYear: null,
      density: 1840,
      secondarySleeperType: null,
    })
    expect(JSON.stringify(data.rows)).not.toMatch(/ПД-\d+/u)
    for (const editor of EDITORS.filter(Boolean)) expect(JSON.stringify(data)).not.toContain(editor)
    const remarks = data.files.flatMap((f) => f.warnings)
    expect(remarks).toHaveLength(1)
    expect(remarks[0]?.text).toContain('разница 7 м')
    expect(remarks[0]?.at).toMatchObject({ file: input[0]!.name, row: expect.any(Number) })
  })

  it('без ручной таблицы показывает кандидатов, но не добавляет длины километров', async () => {
    const current = { ...basis, lines: basis.lines.map((l) => ({ ...l, kmLengths: [] })) }
    const before = JSON.stringify(current)
    const { store, command } = setup(current)
    expect(
      (await importSegmentExports(store, { editionId: 1, files: await files(), importedAt })).ok,
    ).toBe(true)
    expect(
      command()
        .files.flatMap((f) => f.warnings)
        .some((r) => r.text.includes('нестандартный километр')),
    ).toBe(true)
    expect(JSON.stringify(current)).toBe(before)
  })

  it('изменение столбцов старого ПД не влияет на нормализованные характеристики', async () => {
    const input = await files()
    const { store, command } = setup()
    await importSegmentExports(store, { editionId: 1, files: input, importedAt })
    const before = command().rows
    const changed = input.map((f) => ({
      ...f,
      bytes: new TextEncoder().encode(
        new TextDecoder().decode(f.bytes).replaceAll(/ПД-\d+/gu, 'ПД-999'),
      ),
    }))
    expect(
      (await importSegmentExports(store, { editionId: 1, files: changed, importedAt })).ok,
    ).toBe(true)
    expect(command().rows).toEqual(before)
  })

  it('ошибка файла или отсутствие направления не вызывают запись', async () => {
    const { store } = setup({ ...basis, lines: [] })
    expect(
      (await importSegmentExports(store, { editionId: 1, files: await files(), importedAt })).ok,
    ).toBe(false)
    expect(store.applySegmentImport).not.toHaveBeenCalled()
    expect(
      (
        await importSegmentExports(store, {
          editionId: 1,
          files: [{ name: 'broken.xls', bytes: new Uint8Array([0]) }],
          importedAt,
        })
      ).ok,
    ).toBe(false)
    expect(store.applySegmentImport).not.toHaveBeenCalled()
  })

  it('передаёт отказ сохранения, не объявляя импорт успешным', async () => {
    const { store } = setup()
    vi.mocked(store.applySegmentImport).mockResolvedValue(
      err({ kind: 'immutable', message: 'Только черновик.' }),
    )
    expect(
      await importSegmentExports(store, { editionId: 1, files: await files(), importedAt }),
    ).toEqual(err({ kind: 'immutable', message: 'Только черновик.' }))
  })
})
