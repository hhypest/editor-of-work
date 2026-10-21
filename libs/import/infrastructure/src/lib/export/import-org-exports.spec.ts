import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { OrgImport, PassportOrgImport } from '@eow/passport/import-api'
import { err, ok } from '@eow/shared/kernel'
import { generatePassportFixtures } from '../testing/passport/generate'
import { EDITORS } from '../testing/passport/model'
import { importOrgExports } from './import-org-exports'

const selected = new Set(['ПЧУ-1', 'ПЧУ-2', 'ПД-1', 'ПД-2', 'ПД-3', 'ПД-4'])
const date = '2026-10-21'
const importedAt = '2026-10-21T06:00:00Z'
async function files() {
  return (await generatePassportFixtures())
    .filter((f) => ['subdivisions', 'boundaries', 'station-pd', 'track-pd'].includes(f.form))
    .map((f) => ({ name: f.path, bytes: f.bytes }))
}
function setup() {
  let command: OrgImport | undefined
  const store: PassportOrgImport = {
    applyOrgImport: vi.fn<PassportOrgImport['applyOrgImport']>(async (_id, input) => {
      command = input
      return ok(undefined)
    }),
    orgImportReport: vi.fn<PassportOrgImport['orgImportReport']>(async () => ok([])),
  }
  return { store, command: () => command! }
}

describe('Выгрузки оргструктуры → сценарий Паспорта', () => {
  it('передаёт четыре формы, контрольные суммы, периоды и отмеченные ПД', async () => {
    const { store, command } = setup()
    const input = await files()
    expect(input).toHaveLength(4)
    const result = await importOrgExports(store, input, date, selected, importedAt, 7)
    expect(result.ok).toBe(true)
    expect(store.applyOrgImport).toHaveBeenCalledOnce()
    expect(vi.mocked(store.applyOrgImport).mock.calls[0]![0]).toBe(7)
    const data = command()
    expect(data.files).toHaveLength(4)
    for (const file of input) {
      expect(data.files.find((f) => f.name === file.name)).toMatchObject({
        sha256: createHash('sha256').update(file.bytes).digest('hex'),
        importedAt,
      })
    }
    expect(data.subdivisions.filter((s) => s.type === 'ПД' && s.active)).toHaveLength(4)
    expect(data.subdivisions.filter((s) => s.type === 'ПД' && !s.active)).toHaveLength(4)
    expect(data.subdivisions.filter((s) => s.type === 'ЗП')).toHaveLength(1)
    expect(data.boundaries.every((b) => b.importFileId.length > 0 && b.validTo >= date)).toBe(true)
    expect(data.files.flatMap((f) => f.warnings)).toEqual([])
    expect(data.stations.length).toBeGreaterThan(0)
    expect(data.tracks.length).toBeGreaterThan(0)
    expect(JSON.stringify(data)).not.toContain('Скорректировал')
    for (const editor of EDITORS.filter(Boolean)) expect(JSON.stringify(data)).not.toContain(editor)
  })

  it('прежние ПД дают замечания с исходным файлом и строкой, которые идут в журнал', async () => {
    const { store, command } = setup()
    const input = await files()
    const result = await importOrgExports(
      store,
      input,
      date,
      new Set([...selected, 'ПД-11']),
      importedAt,
      7,
    )
    expect(result.ok).toBe(true)
    expect(command().files.flatMap((f) => f.warnings)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining('перекрываются'),
          at: expect.objectContaining({ row: expect.any(Number) }),
        }),
      ]),
    )
  })

  it('не вызывает запись, если не передана одна из четырёх форм', async () => {
    const { store } = setup()
    const result = await importOrgExports(
      store,
      (await files()).slice(1),
      date,
      selected,
      importedAt,
      7,
    )
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-import' } })
    expect(store.applyOrgImport).not.toHaveBeenCalled()
  })

  it('не вызывает запись для повреждённого файла и повторяющегося имени', async () => {
    const { store } = setup()
    const file = (await files())[0]!
    expect(
      (
        await importOrgExports(
          store,
          [{ name: 'broken.xls', bytes: new Uint8Array([0]) }],
          date,
          selected,
          importedAt,
          7,
        )
      ).ok,
    ).toBe(false)
    expect((await importOrgExports(store, [file, file], date, selected, importedAt, 7)).ok).toBe(
      false,
    )
    expect(store.applyOrgImport).not.toHaveBeenCalled()
  })

  it('не объявляет импорт успешным, если сценарий Паспорта отклонил запись', async () => {
    const { store } = setup()
    vi.mocked(store.applyOrgImport).mockResolvedValue(
      err({ kind: 'immutable', message: 'Только черновик.' }),
    )
    expect(await importOrgExports(store, await files(), date, selected, importedAt, 7)).toEqual(
      err({ kind: 'immutable', message: 'Только черновик.' }),
    )
  })
})
