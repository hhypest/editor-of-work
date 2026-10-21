import ExcelJS from 'exceljs'
import { generatePassportFixtures, type FixtureFile } from './generate'
import { CROSSINGS, EDITORS, ENTERPRISE, LINES, STATIONS, distance, L1 } from './model'

const FORMS = [
  'subdivisions',
  'boundaries',
  'station-pd',
  'track-pd',
  'station-axes',
  'okato',
  'class',
  'load',
  'speeds',
  'rails',
  'sleepers',
  'ballast',
  'crossings-general',
  'crossings-technical',
  'crossings-operational',
  'station-tracks',
  'switches',
]

let files: FixtureFile[]

beforeAll(async () => {
  files = await generatePassportFixtures()
})

function file(form: string): FixtureFile {
  const f = files.find((x) => x.form === form && !x.path.startsWith('frameset/'))
  if (!f) throw new Error(`нет формы ${form}`)
  return f
}

const text = (f: FixtureFile): string => new TextDecoder().decode(f.bytes)

/** Строки web-xls: ячейки без разметки, переносы `<br>` — как «|». */
function webRows(f: FixtureFile): string[][] {
  return [...text(f).matchAll(/<tr>(.*?)<\/tr>/gsu)].map((tr) =>
    [...(tr[1] ?? '').matchAll(/<td[^>]*>(.*?)<\/td>/gsu)].map((td) =>
      (td[1] ?? '').replaceAll('<br>', '|').replaceAll('&amp;', '&').trim(),
    ),
  )
}

function column(f: FixtureFile, header: string): string[] {
  const [head, ...rows] = webRows(f)
  const i = head?.indexOf(header) ?? -1
  if (i < 0) throw new Error(`нет столбца «${header}»`)
  return rows.map((r) => r[i] ?? '')
}

async function sheetRows(f: FixtureFile, sheet?: string): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Uint8Array.from(f.bytes).buffer)
  const ws = sheet ? wb.getWorksheet(sheet) : wb.worksheets[0]
  if (!ws) throw new Error(`нет листа ${sheet ?? '1'}`)
  const rows: unknown[][] = []
  ws.eachRow({ includeEmpty: true }, (row) => {
    rows.push(Array.isArray(row.values) ? row.values.slice(1) : [])
  })
  return rows
}

describe('Фикстуры выгрузок паспорта', () => {
  it('есть все 17 форм и вариант frameset с папкой .files', () => {
    expect([...new Set(files.map((f) => f.form))].toSorted()).toEqual(FORMS.toSorted())
    expect(files.filter((f) => f.path.startsWith('frameset/')).map((f) => f.path)).toEqual([
      'frameset/90000199.xls',
      'frameset/90000199.files/sheet001.htm',
      'frameset/90000199.files/filelist.xml',
      'frameset/90000199.files/tabstrip.htm',
    ])
  })

  it('имена файлов web-xls — номера, форма узнаётся только по шапке', () => {
    for (const f of files.filter((x) => x.path.endsWith('.xls') && !x.path.startsWith('frameset/')))
      expect(f.path).toMatch(/^\d{8}\.xls$/u)
  })

  it('в каждой строке web-xls столько ячеек, сколько столбцов в шапке', () => {
    // Главный файл frameset таблицы не содержит: она лежит в sheet001.htm.
    const tables = files.filter(
      (x) =>
        /\.(xls|htm)$/u.test(x.path) &&
        !text(x).includes('<frameset') &&
        !x.path.endsWith('tabstrip.htm'),
    )
    expect(tables.length).toBe(13)
    for (const f of tables) {
      const [head, ...rows] = webRows(f)
      expect(rows.length).toBeGreaterThan(0)
      for (const r of rows) expect(r).toHaveLength(head?.length ?? 0)
    }
  })

  it('числа записаны как «37.0», даты — с align="right" без пробела перед x:num', () => {
    expect(column(file('class'), 'Км|нач')[0]).toBe('10.0')
    expect(text(file('subdivisions'))).toContain('<td align="right"x:num>31.12.9999</td>')
  })

  it('пустые значения: «Нет данных», «-1», «-----»', () => {
    expect(column(file('ballast'), 'Высота|георешетки')).toContain('Нет данных')
    expect(column(file('ballast'), 'Толщина|защитного|слоя')).toContain('-1')
    expect(column(file('station-axes'), 'Привязка, м')).toContain('-----')
  })

  it('прежние и новые коды ПД открыты одновременно', () => {
    const f = file('subdivisions')
    const open = column(f, 'Подразделение').filter(
      (_, i) => column(f, 'Конец|действия')[i] === '31.12.9999',
    )
    expect(open).toEqual(expect.arrayContaining(['ПД-1', 'ПД-4', 'ПД-11', 'ПД-14']))
    expect(open).not.toContain('ПД-15')
    // В характеристиках по отрезкам — только прежние коды.
    expect(new Set(column(file('rails'), 'ПД'))).toEqual(
      new Set(['ПД-11', 'ПД-12', 'ПД-13', 'ПД-14']),
    )
  })

  it('длины границ посчитаны по нестандартным километрам', () => {
    const f = file('boundaries')
    const row = webRows(f).find((r) => r[0] === 'ПД-2' && r[2] === '18.0')
    expect(row?.[6]).toBe(String(distance(L1, { km: 18, m: 0 }, { km: 25, m: 0 })))
    expect(row?.[6]).toBe('6964')
  })

  it('одна длина отрезка не сходится с координатами — повод для замечания сверки', () => {
    const rows = webRows(file('class')).slice(1)
    const mismatched = rows.filter((r) => {
      const line = LINES.find((l) => l.name === r[0])
      if (!line) return false
      const [fk, fm, tk, tm] = [r[1], r[2], r[3], r[4]].map(Number)
      return (
        distance(line, { km: fk ?? 0, m: fm ?? 0 }, { km: tk ?? 0, m: tm ?? 0 }) !== Number(r[5])
      )
    })
    expect(mismatched).toHaveLength(1)
  })

  it('ликвидированная станция осталась в осях, привязке к ПД и названии переезда', async () => {
    expect(column(file('station-axes'), 'Станция')).toContain('ЗАРЕЧЬЕ')
    expect(column(file('station-pd'), 'Станция')).toContain('ЗАРЕЧЬЕ')
    const crossings = (await sheetRows(file('crossings-general'))).map((r) => String(r[0]))
    expect(crossings).toContain('Переезд на станции ЗАРЕЧЬЕ № 3 22 км4пк')
  })

  it('у переезда на перегоне в названии стоит станция, далёкая от его километра', () => {
    const c = CROSSINGS.find((x) => x.number === 2)
    const station = STATIONS.find((s) => s.name === c?.station)
    const km = Number(c?.place.match(/^\d+/u)?.[0])
    const axis = station?.axes[0]
    expect(axis && (km < axis.from.km || km > axis.to.km)).toBe(true)
  })

  it('книги переездов: один лист, шапка в первой строке, число поездов в сутки', async () => {
    const rows = await sheetRows(file('crossings-operational'))
    const head = rows[0] ?? []
    const trains = head.indexOf('Число поездов в сутки')
    expect(trains).toBeGreaterThan(0)
    expect(rows.slice(1).map((r) => r[trains])).toEqual(CROSSINGS.map((c) => c.trains))
  })

  it('отчёты BEx: шапка в строках 3–6, номера столбцов, строки итогов и служебные листы', async () => {
    const tracks = await sheetRows(file('station-tracks'), 'Экспликация стан путей')
    expect(tracks[6]?.slice(0, 3)).toEqual([1, 2, 3])
    expect(tracks.some((r) => String(r[1]).startsWith('Итого по типу'))).toBe(true)
    const switches = await sheetRows(file('switches'), 'Экспликация СТП')
    expect(switches[5]?.slice(1, 4)).toEqual(['1', '2', '3'])
    const wb = new ExcelJS.Workbook()
    const bytes = file('switches').bytes
    await wb.xlsx.load(Uint8Array.from(bytes).buffer)
    expect(wb.getWorksheet('BExRepositorySheet')?.state).toBe('veryHidden')
    expect(wb.getWorksheet('VARS')?.state).toBe('hidden')
  })
})

describe('Фикстуры не содержат настоящих данных (ADR-0008)', () => {
  const allowedStations = new Set(STATIONS.map((s) => s.name))
  const allowedEditors = new Set<string>(EDITORS)
  const allowedLines = new Set(LINES.map((l) => l.name))

  it('станции, люди и направления — только из вымышленной модели', () => {
    for (const f of files.filter((x) => x.path.endsWith('.xls'))) {
      const [head] = webRows(f)
      for (const h of [
        'Станция',
        'Cкорректировал',
        'Скорректировал',
        'Главный путь',
        'Главный|путь',
      ]) {
        if (!head?.includes(h)) continue
        const allowed =
          h === 'Станция'
            ? allowedStations
            : h.startsWith('Главный')
              ? allowedLines
              : allowedEditors
        for (const v of column(f, h)) expect(allowed.has(v)).toBe(true)
      }
      for (const v of head?.includes('Предприятие') ? column(f, 'Предприятие') : [])
        expect([ENTERPRISE, 'ПД-11', 'ПД-12', 'ПД-13', 'ПД-14']).toContain(v)
    }
  })

  it('данные не зависят от времени запуска', async () => {
    const again = await generatePassportFixtures()
    for (const f of files.filter((x) => !x.path.toLowerCase().endsWith('.xlsx'))) {
      expect(text(again.find((x) => x.path === f.path) ?? f)).toBe(text(f))
    }
    expect(
      await sheetRows(
        again.find((x) => x.form === 'switches') ?? file('switches'),
        'Экспликация СТП',
      ),
    ).toEqual(await sheetRows(file('switches'), 'Экспликация СТП'))
  })
})
