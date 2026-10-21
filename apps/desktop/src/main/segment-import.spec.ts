import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { importSegmentExports } from '@eow/import/infrastructure'
import { openPassportDatabase, type PassportDatabase } from '@eow/passport/infrastructure'
import type { Result } from '@eow/shared/kernel'

function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
const tr = (cells: readonly string[]) => `<tr>${cells.map((x) => `<td>${x}</td>`).join('')}</tr>`
/** Вымышленные формы генерируются в памяти; реальные выгрузки не используются. */
function exportFile(name: string, columns: readonly string[], row: readonly string[]) {
  return { name, bytes: new TextEncoder().encode(`<table>${tr(columns)}${tr(row)}</table>`) }
}
const files = () => [
  exportFile(
    'class.xls',
    [
      'Главный путь',
      'Км нач',
      'М нач',
      'Км кон',
      'М кон',
      'Длина',
      'Класс',
      'Группа',
      'Категория',
      'Скорректировал',
    ],
    ['УЧЕБНЫЙ I', '10', '0', '11', '0', '964', '3', 'Г', '2', 'ВЫМЫШЛЕННЫЙ КОРРЕКТИРОВЩИК'],
  ),
  exportFile(
    'rails.xls',
    [
      'Главный путь',
      'КМ н.',
      'М н.',
      'КМ к.',
      'М к.',
      'Длина, м',
      'Признак укладки',
      'Дата укладки',
      'Закалка',
      'Тип',
      'Длина',
      'Износ прив.',
      'ПД',
    ],
    [
      'УЧЕБНЫЙ I',
      '10',
      '0',
      '11',
      '0',
      '964',
      'о',
      '01.02.2006',
      'Т1',
      'Р65',
      'б/с',
      '0-12',
      'ПД-999',
    ],
  ),
]

describe('Выгрузки характеристик → SQLite', () => {
  let root: string | undefined
  let store: PassportDatabase | undefined
  let db: DatabaseSync | undefined
  afterEach(async () => {
    db?.close()
    await store?.close()
    if (root) await rm(root, { recursive: true, force: true })
  })
  it('сверяет, сохраняет и повторно читает данные; ручное подтверждение км устраняет замечание', async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-segment-flow-'))
    const path = join(root, 'passport.sqlite')
    store = await openPassportDatabase(
      path,
      resolve(import.meta.dirname, '../../../../libs/passport/infrastructure/migrations'),
    )
    const edition = value(
      await store.createDraft({ date: '2026-10-21', label: 'Учебная редакция' }),
    )
    db = new DatabaseSync(path)
    db.exec('PRAGMA foreign_keys = ON')
    db.prepare("INSERT INTO line(edition_id,id,name,code) VALUES (?, 'line','УЧЕБНЫЙ I','L1')").run(
      edition.id,
    )
    db.prepare(
      "INSERT INTO subdivision(edition_id,id,name,code,type,active) VALUES (?, 'pd','ПД-1','ПД-1','ПД',1)",
    ).run(edition.id)
    db.prepare(
      "INSERT INTO subdivision_segment(edition_id,id,line_id,start_km,start_m,end_km,end_m,subdivision_id,stated_length_m) VALUES (?, 'old-boundary','line',10,0,11,0,'pd',-1)",
    ).run(edition.id)
    expect(value(await store.segmentBasis(edition.id)).boundaries[0]?.statedLength).toBeNull()
    const request = { editionId: edition.id, files: files(), importedAt: '2026-10-21T06:00:00Z' }
    const first = value(await importSegmentExports(store, request))
    expect(first.remarks).toHaveLength(4)
    expect(db.prepare('SELECT count(*) AS n FROM line_km').get()).toMatchObject({ n: 0 })
    expect(value(await store.segmentData(edition.id))).toEqual(first.command.rows)
    expect(
      value(await store.segmentImportReport(edition.id)).flatMap((f) => f.warnings),
    ).toHaveLength(4)
    expect(JSON.stringify(value(await store.segmentData(edition.id)))).not.toMatch(
      /КОРРЕКТИРОВЩИК|ПД-999/u,
    )
    db.prepare(
      "INSERT INTO line_km(edition_id,id,line_id,km,length_m) VALUES (?, 'confirmed','line',10,964)",
    ).run(edition.id)
    const second = value(await importSegmentExports(store, request))
    expect(second.remarks).toEqual([])
    expect(value(await store.segmentImportReport(edition.id)).flatMap((f) => f.warnings)).toEqual(
      [],
    )
    expect(value(await store.segmentData(edition.id))).toHaveLength(2)
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
