import { zipSync, strToU8 } from 'fflate'
import {
  columnIndex,
  describeExportError,
  describeLocation,
  numberAt,
  type ExportError,
  type ExportFile,
  type ExportTable,
} from '@eow/import/application'
import type { Result } from '@eow/shared/kernel'
import { generatePassportFixtures, type FixtureFile } from '../testing/passport/generate'
import { PassportExportSource } from './passport-export-source'

let fixtures: FixtureFile[]
const source = new PassportExportSource()

beforeAll(async () => {
  fixtures = await generatePassportFixtures()
})

function asFile(f: FixtureFile): ExportFile {
  const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : ''
  return {
    name: f.path.slice(dir.length),
    bytes: f.bytes,
    sibling: (relative) =>
      Promise.resolve(fixtures.find((x) => x.path === `${dir}${relative}`)?.bytes),
  }
}

async function tables(form: string, frameset = false): Promise<readonly ExportTable[]> {
  const f = fixtures.find(
    (x) =>
      x.form === form &&
      x.path.startsWith('frameset/') === frameset &&
      /\.(xls|xlsx)$/iu.test(x.path),
  )
  if (!f) throw new Error(`нет фикстуры ${form}`)
  const r = await source.read(asFile(f))
  if (!r.ok) throw new Error(describeExportError(r.error))
  return r.value
}

async function single(form: string): Promise<ExportTable> {
  const [t] = await tables(form)
  if (!t) throw new Error('нет таблицы')
  return t
}

function failure<T>(r: Result<T, ExportError>): ExportError {
  if (r.ok) throw new Error('ожидалась ошибка')
  return r.error
}

const names = (t: ExportTable): string[] => t.columns.map((c) => c.name)

describe('ExportSource: распознавание форм', () => {
  it('каждая из 17 форм узнаётся на своей фикстуре, служебные листы пропускаются', async () => {
    const forms = [...new Set(fixtures.map((f) => f.form))]
    expect(forms).toHaveLength(17)
    for (const form of forms) {
      const found = await tables(form)
      expect(found.map((t) => t.form)).toEqual([form])
    }
  })

  it('форма frameset читается из папки .files', async () => {
    const [t] = await tables('okato', true)
    expect(t?.form).toBe('okato')
    expect(t?.sheet).toBe('Список Области, районы, города')
    expect(t?.rows).toHaveLength(4)
  })

  it('frameset без папки .files — понятная ошибка', async () => {
    const main = fixtures.find((f) => f.path === 'frameset/90000199.xls')
    if (!main) throw new Error('нет frameset')
    const e = failure(await source.read({ name: '90000199.xls', bytes: main.bytes }))
    expect(describeExportError(e)).toContain('выберите вместе с файлом его папку «.files»')
  })
})

describe('ExportSource: web-xls', () => {
  it('заголовки нормализованы: переносы — пробел, латинская C — кириллица', async () => {
    const t = await single('class')
    expect(names(t)).toEqual([
      'Главный путь',
      'Км нач',
      'М нач',
      'Км кон',
      'М кон',
      'Длина',
      'Класс',
      'Группа',
      'Категория',
      'Предприятие',
      'Скорректировал',
    ])
    expect(t.rows[0]).toEqual({
      line: 2,
      cells: [
        'Главный путь Северная-Южная, 1',
        '10.0',
        '0.0',
        '12.0',
        '350.0',
        '2350',
        '3',
        'V',
        '2',
        'ИЧ-0 УЧЕБНАЯ П',
        'Иванов Иван Иванович',
      ],
    })
  })

  it('повтор заголовка получает номер: второй «Предприятие» в шпалах — код ПД', async () => {
    const t = await single('sleepers')
    const i = columnIndex(t, 'Предприятие (2)')
    expect(i).toBeGreaterThan(0)
    expect(t.rows[0]?.cells[i]).toBe('ПД-11')
    expect(names(t)).toContain('Тип шпал (2)')
  })
})

describe('ExportSource: xlsx', () => {
  it('книга переездов: даты — ГГГГ-ММ-ДД, числа — числами', async () => {
    const t = await single('crossings-general')
    const row = t.rows[0]
    expect(row?.line).toBe(2)
    expect(row?.cells[columnIndex(t, 'Номер')]).toBe(1)
    expect(row?.cells[columnIndex(t, 'Дата создания')]).toBe('1965-01-01')
    expect(row?.cells[columnIndex(t, 'Дата закрытия')]).toBe('9999-12-31')
  })

  it('отчёт BEx: шапка собирается по уровням над строкой номеров столбцов', async () => {
    const t = await single('station-tracks')
    expect(t.columns).toHaveLength(37)
    expect(names(t).slice(0, 8)).toEqual([
      'Станция',
      'Назначение путей по ТРА',
      'Парк',
      'Номер',
      'Граница / От',
      'Граница / Через',
      'Граница / До',
      'Длина, м / Полн.',
    ])
    expect(names(t)).toContain('Шпалы / Наличие, шт. / ЖБ')
    expect(names(t)).toContain('Последний ремонт капитального характера / год')
    expect(t.rows[0]?.line).toBe(8)
    expect(t.rows[0]?.cells.slice(0, 4)).toEqual(['ОЗЕРНАЯ', 'главный', '-', 'I'])
  })

  it('экспликация стрелок: столбцы с B, три уровня шапки', async () => {
    const t = await single('switches')
    expect(t.columns[0]).toEqual({ name: 'Станция', letter: 'B' })
    expect(names(t)).toContain('Крестовины / Пропущенный тоннаж / до укладки')
    expect(names(t)).toContain('Пропущенный тоннаж / после укладки')
    expect(t.rows[0]?.line).toBe(7)
  })
})

describe('ExportSource: ошибки', () => {
  it('двоичный xls — просьба пересохранить в xlsx', async () => {
    const bytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0])
    const e = failure(await source.read({ name: '90000001.xls', bytes }))
    expect(e.kind).toBe('binary-xls')
    expect(describeExportError(e)).toContain('пересохраните в xlsx')
  })

  it('оборванная выгрузка без конца таблицы — ошибка, а не неполные данные', async () => {
    const f = fixtures.find((x) => x.form === 'sleepers')
    if (!f) throw new Error('нет фикстуры')
    const text = new TextDecoder().decode(f.bytes)
    // Обрыв посреди третьей строки данных, как у настоящей длинной выгрузки.
    const cut = text.slice(
      0,
      text.indexOf(
        '<tr>',
        text.indexOf('<tr>', text.indexOf('<tr>', text.indexOf('<tr>') + 1) + 1) + 1,
      ) + 40,
    )
    const e = failure(await source.read({ name: '90000111.xls', bytes: strToU8(cut) }))
    expect(e).toMatchObject({ kind: 'truncated', rows: 2 })
    expect(describeExportError(e)).toContain('Выгрузите форму частями')
  })

  it('не выгрузка и повреждённая книга', async () => {
    expect(failure(await source.read({ name: 'a.txt', bytes: strToU8('привет') })).kind).toBe(
      'unknown-file',
    )
    const broken = zipSync({ 'readme.txt': strToU8('x') })
    expect(failure(await source.read({ name: 'b.xlsx', bytes: broken })).kind).toBe('broken-file')
  })

  it('незнакомая форма — ошибка с файлом, листом и заголовками', async () => {
    const html =
      '<html><body><table><tr><td>Колонка А</td><td>Колонка Б</td></tr><tr><td>1</td><td>2</td></tr></table></body></html>'
    const e = failure(await source.read({ name: 'c.xls', bytes: strToU8(html) }))
    expect(describeExportError(e)).toBe(
      'Не удалось определить форму: файл «c.xls», лист «Лист1». Заголовки: Колонка А; Колонка Б',
    )
  })

  it('ошибка значения указывает файл, лист, строку и столбец', async () => {
    const t = await single('station-axes')
    const row = t.rows[1]
    if (!row) throw new Error('нет строки')
    const r = numberAt(t, row, 'Привязка, м')
    // «-----» — пустое значение, а не ошибка.
    expect(r).toEqual({ ok: true, value: null })
    const bad = failure(numberAt(t, row, 'Станция'))
    expect(bad.kind === 'bad-value' ? describeLocation(bad.at) : bad.kind).toBe(
      'файл «90000105.xls», лист «Список Границы станций», строка 3, столбец A («Станция»)',
    )
  })
})
