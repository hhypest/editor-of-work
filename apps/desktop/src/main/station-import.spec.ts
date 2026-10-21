import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { importStationExports } from '@eow/import/infrastructure'
import { openPassportDatabase, type PassportDatabase } from '@eow/passport/infrastructure'
import type { Result } from '@eow/shared/kernel'
function value<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}
const marker = 'ВЫМЫШЛЕННЫЙ КОРРЕКТИРОВЩИК'
const tr = (cells: readonly (string | number)[]) =>
  '<tr>' + cells.map((c) => '<td>' + String(c) + '</td>').join('') + '</tr>'
function form(name: string, cells: Readonly<Record<string, string | number>>) {
  const data = { ...cells, Скорректировал: marker }
  return {
    name,
    bytes: new TextEncoder().encode(
      '<table>' + tr(Object.keys(data)) + tr(Object.values(data)) + '</table>',
    ),
  }
}
const title = 'Переезд на станции НЕВЕРНАЯ № 1 10км10пк'
const files = () => [
  form('axes.xls', {
    Станция: 'УЧЕБНАЯ',
    Путь: 'Главный путь УЧЕБНЫЙ, 1',
    'Ось, км': 10,
    'Ось, м': 100,
    'Граница начала, км': '',
    'Граница начала, м': '',
    'Граница конца, км': '',
    'Граница конца, м': '',
    'Участок пути': 'учебный',
  }),
  form('tracks.xls', {
    Станция: 'УЧЕБНАЯ',
    'Назначение путей по ТРА': 'приёмо-отправочный',
    Номер: 'I',
    'Граница / От': '7',
    'Граница / До': 'упор',
    'Длина, м / Полн.': 1200,
    'Длина, м / Полезная': 1100,
  }),
  form('switches.xls', {
    Станция: 'УЧЕБНАЯ',
    '№ стр. перевода': '7',
    Путь: 'I',
    'Крестовины / марка': '1/9',
    'Дата укладки стрелочного перевода': '01.02.2006',
  }),
  form('general.xls', {
    Переезд: title,
    Номер: '1',
    'Категория переезда': '3',
    'Тип переезда': 'общего пользования',
    Направление: 'УЧЕБНЫЙ',
    Станция: '-',
  }),
  form('technical.xls', {
    Переезд: title,
    'Вид регулирования': 'Регулируемый',
    'Вид шлагбаума': 'автоматический',
  }),
  form('operational.xls', {
    Переезд: title,
    'Число поездов в сутки': 14,
    'Число автомобилей в сутки': 20,
    'Макс ск-ть пасс четных поездов': 90,
  }),
  form('okato.xls', {
    ОКАТО: 'УЧЕБНАЯ ОБЛАСТЬ',
    Тип: 'область',
    'Верхний ОКАТО': '',
    'Тип верхнего ОКАТО': '',
  }),
]
describe('Станционные выгрузки → SQLite', () => {
  let root: string | undefined, store: PassportDatabase | undefined, db: DatabaseSync | undefined
  afterEach(async () => {
    db?.close()
    await store?.close()
    if (root) await rm(root, { recursive: true, force: true })
  })
  it('читает семь форм, сохраняет многозначную привязку, отчёт и исключения; повтор не создаёт дублей', async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-station-flow-'))
    const path = join(root, 'passport.sqlite')
    const passport = await openPassportDatabase(
      path,
      resolve(import.meta.dirname, '../../../../libs/passport/infrastructure/migrations'),
    )
    store = passport
    const id = value(
      await passport.createDraft({ date: '2026-10-21', label: 'Учебная редакция' }),
    ).id
    const database = new DatabaseSync(path)
    db = database
    database.exec('PRAGMA foreign_keys=ON')
    for (const n of [1, 2])
      database
        .prepare('INSERT INTO line(edition_id,id,name,code) VALUES (?,?,?,?)')
        .run(id, 'line' + n, 'Главный путь УЧЕБНЫЙ, ' + n, 'L' + n)
    for (const n of [1, 2])
      database
        .prepare(
          'INSERT INTO line_extent(edition_id,id,line_id,start_km,start_m,end_km,end_m) VALUES (?,?,?,10,0,11,0)',
        )
        .run(id, 'extent' + n, 'line' + n)
    const request = { editionId: id, files: files(), importedAt: '2026-10-21T06:00:00Z' }
    const first = value(await importStationExports(passport, request))
    expect(first.command.rows).toHaveLength(5)
    expect(first.remarks.map((r) => r.text)).toContain(
      'Переезд № 1: станции НЕВЕРНАЯ из названия нет в осях станций',
    )
    expect(value(await passport.stationData(id))).toEqual(
      [...first.command.rows].sort((a, b) => a.id.localeCompare(b.id)),
    )
    expect(database.prepare('SELECT line_id,station_id,m FROM crossing').get()).toMatchObject({
      line_id: null,
      station_id: null,
      m: 900,
    })
    expect(database.prepare('SELECT count(*) AS n FROM crossing_line').get()).toMatchObject({
      n: 2,
    })
    expect(database.prepare('SELECT start_km,end_km FROM station_axis').get()).toMatchObject({
      start_km: null,
      end_km: null,
    })
    const report = value(await passport.stationImportReport(id))
    expect(report).toHaveLength(7)
    expect(report.flatMap((f) => f.warnings)).toEqual(first.remarks)
    expect(JSON.stringify(value(await passport.stationData(id)))).not.toContain(marker)
    value(
      await importStationExports(passport, {
        ...request,
        files: request.files.map((f) => ({ ...f, name: 'new-' + f.name })),
      }),
    )
    expect(value(await passport.stationData(id))).toHaveLength(5)
    expect(database.prepare('SELECT count(*) AS n FROM station').get()).toMatchObject({ n: 1 })
    expect(database.prepare('SELECT count(*) AS n FROM crossing_line').get()).toMatchObject({
      n: 2,
    })
    const before = value(await passport.stationImportReport(id))
    expect(
      (await importStationExports(passport, { ...request, files: request.files.slice(1) })).ok,
    ).toBe(false)
    expect(value(await passport.stationImportReport(id))).toEqual(before)
    value(
      await passport.setStationExclusions(id, [
        { name: 'УЧЕБНАЯ', reason: 'Исключено составителем' },
      ]),
    )
    const excluded = value(await importStationExports(passport, request))
    expect(excluded.command.rows.some((r) => 'station' in r.values)).toBe(false)
    expect(value(await passport.stationData(id))).toHaveLength(2)
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
})
