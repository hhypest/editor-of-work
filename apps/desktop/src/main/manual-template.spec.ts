import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import ExcelJS from 'exceljs'
import { strToU8, zipSync } from 'fflate'
import {
  XlsxManualDataTemplate,
  exportManualTemplate,
  importManualTemplate,
  prepareManualTemplate,
} from '@eow/import/infrastructure'
import { openPassportDatabase, type PassportDatabase } from '@eow/passport/infrastructure'
import type { ManualData, ManualImport } from '@eow/passport/import-api'
import type { Result } from '@eow/shared/kernel'
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
const period = { validFrom: null, validTo: null }
const data: ManualData = {
  workKinds: [
    {
      ...period,
      id: 'kind',
      code: 'УЧ',
      name: 'Учебная работа',
      unit: 'км',
      group: 'capital',
      symbol: 'У',
      includedIn: null,
    },
  ],
  repairNorms: [
    {
      ...period,
      id: 'norm',
      workCode: 'УЧ',
      trackClass: 'УЧЕБНЫЙ',
      trackGroup: null,
      trackCategory: null,
      railType: 'Учебные рельсы',
      sleeperType: null,
      years: 7.5,
      millionTons: 3.25,
    },
  ],
  tolerances: [
    {
      ...period,
      id: 'tol',
      code: 'ДОП',
      name: 'Учебная справка',
      unit: 'мм',
      value: 2.25,
      conditions: 'Вымышленное условие',
    },
  ],
  trainPairs: [
    {
      ...period,
      id: 'pair',
      line: 'УЧЕБНОЕ',
      from: { km: 10, m: 0 },
      to: { km: 11, m: 0 },
      freight: 2.5,
      passenger: 0,
      suburban: null,
    },
  ],
  kilometres: [{ ...period, id: 'km', line: 'УЧЕБНОЕ', km: 10, length: 1045 }],
}
const adapter = new XlsxManualDataTemplate()
const importedAt = '2026-10-21T00:00:00Z'
describe('Ручные данные: SQLite → xlsx → SQLite', () => {
  let root: string, store: PassportDatabase, db: DatabaseSync, id: number
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-manual-'))
    const path = join(root, 'passport.sqlite')
    store = await openPassportDatabase(
      path,
      resolve(import.meta.dirname, '../../../../libs/passport/infrastructure/migrations'),
    )
    id = value(await store.createDraft({ date: '2026-10-21', label: 'Учебная редакция' })).id
    db = new DatabaseSync(path)
    db.exec('PRAGMA foreign_keys=ON')
    db.prepare("INSERT INTO line(edition_id,id,name,code) VALUES (?,'line','УЧЕБНОЕ','L')").run(id)
    db.prepare(
      "INSERT INTO line_extent(edition_id,id,line_id,start_km,start_m,end_km,end_m) VALUES (?,'extent','line',10,0,15,0)",
    ).run(id)
    db.prepare(
      "INSERT INTO seg_class(edition_id,id,line_id,start_km,start_m,end_km,end_m,class) VALUES (?,'class','line',10,0,15,0,'УЧЕБНЫЙ')",
    ).run(id)
  })
  afterEach(async () => {
    db.close()
    await store.close()
    await rm(root, { recursive: true, force: true })
  })
  const input = async (current = data): Promise<ManualImport> => {
    const basis = value(await store.manualBasis(id))
    return {
      basisToken: basis.token,
      date: basis.date,
      data: current,
      file: {
        id: 'manual',
        form: 'manual-data',
        name: 'учебный.xlsx',
        importedAt,
        sha256: 'a'.repeat(64),
        rowCount: 5,
        warnings: [],
      },
    }
  }
  const snapshot = () =>
    Object.fromEntries(
      ['work_kind', 'repair_norm', 'tolerance', 'seg_train_pairs', 'line_km', 'import_file'].map(
        (t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY edition_id,id`).all()],
      ),
    )
  async function edit(
    bytes: Uint8Array,
    change: (wb: ExcelJS.Workbook) => void,
  ): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(bytes).buffer)
    change(wb)
    return new Uint8Array(await wb.xlsx.writeBuffer())
  }
  it('огромный заявленный XML отклоняется до записи ручных данных и журнала', async () => {
    value(await store.applyManualData(id, await input()))
    const before = snapshot()
    const bytes = zipSync({ 'xl/workbook.xml': strToU8('<workbook/>') })
    const view = new DataView(bytes.buffer)
    for (let i = 0; i + 46 <= bytes.length; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 33 * 1024 * 1024, true)
        break
      }
    }
    expect(
      await importManualTemplate(store, adapter, {
        editionId: id,
        file: { name: 'учебный-лимит.xlsx', bytes },
        importedAt,
      }),
    ).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import', message: expect.stringContaining('лимит 32 МиБ') },
    })
    expect(snapshot()).toEqual(before)
  })
  it('выдача и немедленная загрузка пустого или заполненного шаблона не меняют данные и журнал', async () => {
    for (const populated of [false, true]) {
      if (populated) value(await store.applyManualData(id, await input()))
      const before = snapshot()
      const { bytes } = value(await exportManualTemplate(store, adapter, id))
      const preview = value(
        await importManualTemplate(store, adapter, {
          editionId: id,
          file: { name: 'другое-имя.xlsx', bytes },
          importedAt,
        }),
      )
      expect(preview.changes.every((r) => r.added + r.changed + r.removed === 0)).toBe(true)
      expect(snapshot()).toEqual(before)
    }
    expect(value(await store.manualBasis(id)).data).toEqual(data)
  })
  it('меняет пороги и пары поездов, сохраняет условный знак и периоды, журнал содержит SHA-256', async () => {
    value(await store.applyManualData(id, await input()))
    const basis = value(await store.manualBasis(id))
    const bytes = await edit(value(await adapter.write(basis)), (wb) => {
      wb.getWorksheet('Периодичность ремонтов')!.getCell('G2').value = 9.25
      wb.getWorksheet('Пары поездов')!.getCell('F2').value = 4.5
      wb.getWorksheet('Виды работ')!.getCell('G2').value = '01.01.2020'
    })
    const preview = value(
      await importManualTemplate(store, adapter, {
        editionId: id,
        file: { name: 'изменение.xlsx', bytes },
        importedAt,
      }),
    )
    expect(preview.changes.filter((r) => r.changed === 1)).toHaveLength(3)
    const saved = value(await store.manualBasis(id)).data
    expect(saved.repairNorms[0]?.years).toBe(9.25)
    expect(saved.trainPairs[0]?.freight).toBe(4.5)
    expect(saved.workKinds[0]).toMatchObject({ id: 'kind', symbol: 'У', validFrom: '2020-01-01' })
    expect(
      db.prepare("SELECT sha256,row_count,name FROM import_file WHERE form='manual-data'").get(),
    ).toMatchObject({
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      row_count: 5,
      name: 'изменение.xlsx',
    })
    expect(value(await store.manualImportReport(id))).toHaveLength(1)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
  it('неполный лист и ошибка заполнения не меняют паспорт', async () => {
    value(await store.applyManualData(id, await input()))
    const before = snapshot(),
      { bytes } = value(await exportManualTemplate(store, adapter, id))
    for (const change of [
      (wb: ExcelJS.Workbook) => {
        wb.removeWorksheet('Допуски')
      },
      (wb: ExcelJS.Workbook) => {
        wb.getWorksheet('Периодичность ремонтов')!.getCell('G2').value = 'ошибка'
      },
      (wb: ExcelJS.Workbook) => {
        wb.getWorksheet('Пары поездов')!.getCell('B2').value = 16
      },
    ]) {
      expect(
        await importManualTemplate(store, adapter, {
          editionId: id,
          file: { name: 'ошибка.xlsx', bytes: await edit(bytes, change) },
          importedAt,
        }),
      ).toMatchObject({ ok: false, error: { kind: 'invalid-import' } })
      expect(snapshot()).toEqual(before)
    }
  })
  it('устаревший шаблон не перезаписывает изменения, включая между предпросмотром и записью', async () => {
    value(await store.applyManualData(id, await input()))
    const basis = value(await store.manualBasis(id)),
      bytes = value(await adapter.write(basis))
    const preview = value(
      await prepareManualTemplate(adapter, basis, { name: 'старый.xlsx', bytes }, importedAt),
    )
    const next = { ...data, tolerances: data.tolerances.map((r) => ({ ...r, value: 5 })) }
    value(await store.applyManualData(id, await input(next)))
    const before = snapshot()
    expect(await store.applyManualData(id, preview.command)).toMatchObject({
      ok: false,
      error: { kind: 'invalid-import' },
    })
    expect(
      await importManualTemplate(store, adapter, {
        editionId: id,
        file: { name: 'старый.xlsx', bytes },
        importedAt,
      }),
    ).toMatchObject({ ok: false, error: { kind: 'invalid-import' } })
    expect(snapshot()).toEqual(before)
  })
  it('сокращение км не делает ранее импортированные координаты недопустимыми', async () => {
    value(await store.applyManualData(id, await input()))
    db.exec('UPDATE seg_class SET start_m=1020')
    const before = snapshot(),
      shorter = { ...data, kilometres: data.kilometres.map((r) => ({ ...r, length: 964 })) }
    expect(await store.applyManualData(id, await input(shorter))).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('1020') },
    })
    expect(snapshot()).toEqual(before)
  })
  it('ошибка последней записи откатывает все пять разделов и журнал', async () => {
    value(await store.applyManualData(id, await input()))
    const before = snapshot()
    db.exec(
      "CREATE TRIGGER fail_manual BEFORE INSERT ON line_km BEGIN SELECT RAISE(ABORT,'test failure'); END",
    )
    const changed = {
      ...data,
      workKinds: data.workKinds.map((r) => ({ ...r, name: 'Другое имя' })),
    }
    expect(await store.applyManualData(id, await input(changed))).toMatchObject({
      ok: false,
      error: { kind: 'storage' },
    })
    expect(snapshot()).toEqual(before)
  })
  it('действующая и архивная редакции защищены; новая редакция копирует все ручные данные', async () => {
    value(await store.applyManualData(id, await input()))
    const command = await input()
    value(await store.activate(id))
    expect(await store.applyManualData(id, command)).toMatchObject({
      ok: false,
      error: { kind: 'immutable' },
    })
    expect(() => db.exec("UPDATE work_kind SET symbol='другой'")).toThrow('immutable')
    const next = value(await store.createDraft({ date: '2026-10-21', label: 'Копия' }))
    expect(value(await store.manualBasis(next.id)).data).toEqual(data)
    value(await store.activate(next.id))
    expect(await store.applyManualData(id, command)).toMatchObject({
      ok: false,
      error: { kind: 'immutable' },
    })
    expect(await store.manualImportReport(999)).toMatchObject({
      ok: false,
      error: { kind: 'not-found' },
    })
    expect(await store.manualBasis(999)).toMatchObject({ ok: false, error: { kind: 'not-found' } })
  })
})
