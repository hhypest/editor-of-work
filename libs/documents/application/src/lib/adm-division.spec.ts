import { ADM_SHEETS, buildAdmDivision, type AdmDivisionSource } from './adm-division'
import { evaluateWorkbook } from './testing/workbook-evaluator'
import { columnName, formulaText, sheetRef, type WorkbookCell } from './workbook-model'

/** Вымышленная дистанция: два ПЧУ, три ПД, нестандартный км, станция примыкания. */
function fictionalSource(): AdmDivisionSource {
  const track = (station: string, number: string, purpose: string, fullLength: number | null) => ({
    station,
    number,
    purpose,
    fullLength,
    usefulLength: fullLength === null ? null : fullLength - 100,
  })
  const switchRow = (station: string, number: string) => ({
    station,
    number,
    purpose: 'приемо-отправочный',
    frogMark: '1/11',
    railType: 'Р65',
  })
  return {
    edition: { date: '2027-01-01' },
    district: 'Учебная дистанция инфраструктуры',
    lines: [
      { name: 'Северная — Южная', kmLengths: [[120, 964]] },
      { name: 'Озёрная — Ключи', kmLengths: [] },
    ],
    units: [
      { code: 'ПЧУ-2', kind: 'ПЧУ', head: 'Макетный З.З.' },
      { code: 'ПЧУ-1', kind: 'ПЧУ', head: 'Тестовый Ж.Ж.' },
      { code: 'ПД-10', kind: 'ПД', head: 'Образцов Д.Д.', pchu: 'ПЧУ-2' },
      { code: 'ПД-2', kind: 'ПД', head: 'Пробный Б.Б.', pchu: 'ПЧУ-1' },
      { code: 'ПД-1', kind: 'ПД', head: 'Учебный А.А.', pchu: 'ПЧУ-1' },
    ],
    boundaries: [
      {
        pd: 'ПД-1',
        line: 'Северная — Южная',
        from: { km: 100, m: 0 },
        to: { km: 121, m: 0 },
        statedLength: 20_964,
      },
      {
        pd: 'ПД-2',
        line: 'Северная — Южная',
        from: { km: 121, m: 0 },
        to: { km: 140, m: 500 },
        statedLength: 19_000,
      },
      {
        pd: 'ПД-10',
        line: 'Озёрная — Ключи',
        from: { km: 10, m: 0 },
        to: { km: 30, m: 0 },
        statedLength: null,
      },
    ],
    bindings: [
      { station: 'Озёрная', pd: 'ПД-1' },
      { station: 'Берёзовка', pd: 'ПД-1' },
      { station: 'Каменка', pd: 'ПД-2' },
      { station: 'Каменка', pd: 'ПД-10' },
      { station: 'Ключи', pd: 'ПД-10' },
    ],
    axes: [
      { station: 'Берёзовка', line: 'Северная — Южная', at: { km: 115, m: 200 } },
      { station: 'Озёрная', line: 'Северная — Южная', at: { km: 101, m: 300 } },
      { station: 'Озёрная', line: 'Озёрная — Ключи', at: { km: 10, m: 400 } },
      { station: 'Каменка', line: 'Северная — Южная', at: { km: 130, m: 0 } },
    ],
    tracks: [
      track('Озёрная', '1', 'главный', 1200),
      track('Озёрная', '3', 'приемо-отправочный', 1050),
      track('ОЗЁРНАЯ', '5', 'Вытяжной', 400),
      track('Берёзовка', '2', 'Главный', 900),
      track('Берёзовка', '4', 'приемо-отправочный', null),
      track('Каменка', '3', 'приемо-отправочный', 850),
      track('Ключи', '3', 'подъездной', 640),
      track('Разъезд 7 км', '1', 'приемо-отправочный', 700),
    ],
    switches: [
      switchRow('Озёрная', '1'),
      switchRow('Озёрная', '2'),
      switchRow('Каменка', '1'),
      switchRow('Ключи', '1'),
      switchRow('Разъезд 7 км', '1'),
    ],
    warnings: [],
  }
}
const cellText = (cell: WorkbookCell | null | undefined) =>
  cell && 'value' in cell ? cell.value : cell && 'formula' in cell ? cell.formula : undefined

describe('Административное деление (#32)', () => {
  it('книга из шести листов с итогами приложения по ПД и по дистанции', () => {
    const division = buildAdmDivision(fictionalSource())
    expect(division.workbook.sheets.map((s) => s.name)).toEqual(Object.values(ADM_SHEETS))
    // Км 120 длиной 964 м: 100–121 км — 20 964 м, а не 21 000.
    expect(division.totals.byPd.get('ПД-1')).toEqual({
      mainMeters: 20_964,
      stationMeters: 1050 + 400,
      stationTracks: 3,
      stationMainMeters: 2100,
      switches: 2,
      stations: 2,
    })
    expect(division.totals.byPd.get('ПД-2')?.stations).toBe(1)
    expect(division.totals.byPd.get('ПД-10')).toMatchObject({ mainMeters: 20_000, stations: 1 })
    expect(division.totals.district).toEqual({
      mainMeters: 20_964 + 19_500 + 20_000,
      stationMeters: 1450 + 850 + 640,
      stationTracks: 5,
      stationMainMeters: 2100,
      switches: 4,
      stations: 4,
    })
  })

  it('каждая формула книги даёт тот же результат, что посчитало приложение', () => {
    const { workbook } = buildAdmDivision(fictionalSource())
    const read = evaluateWorkbook(workbook)
    const checked: { at: string; expected: string | number; got: unknown }[] = []
    for (const sheet of workbook.sheets)
      for (const [r, row] of sheet.rows.entries())
        for (const [c, cell] of row.entries())
          if (cell && 'formula' in cell) {
            const at = `${sheet.name}!${columnName(c + 1)}${r + 1}`
            checked.push({ at, expected: cell.result, got: read(sheet.name, at.split('!')[1]!) })
          }
    const mismatches = checked.filter(({ expected, got }) =>
      typeof expected === 'number'
        ? typeof got !== 'number' || Math.abs(got - expected) > 1e-9
        : got !== expected,
    )
    expect(mismatches).toEqual([])
    const formulas = checked.length
    expect(formulas).toBeGreaterThan(40)
  })

  it('главный лист: группы по ПЧУ, руководители через справочник, подытоги и всего', () => {
    const { workbook } = buildAdmDivision(fictionalSource())
    const main = workbook.sheets[0]!
    const column = (index: number) => main.rows.map((row) => cellText(row[index]))
    expect(column(1).filter((t) => typeof t === 'string' && t.startsWith('Итого'))).toEqual([
      'Итого по ПЧУ-1 · станций: 3',
      'Итого по ПЧУ-2 · станций: 1',
    ])
    expect(column(1)).toContain('ВСЕГО по дистанции · 2 ПЧУ · 3 ПД · станций: 4')
    expect(column(2).slice(5, 7)).toEqual([
      `="ПД-1"&CHAR(10)&INDEX(Справочник!$C:$C,MATCH("ПД-1",Справочник!$A:$A,0))`,
      `="ПД-2"&CHAR(10)&INDEX(Справочник!$C:$C,MATCH("ПД-2",Справочник!$A:$A,0))`,
    ])
    expect(main.rows[5]?.[1]).toMatchObject({ result: 'ПЧУ-1\nТестовый Ж.Ж.' })
    expect(main.merges).toEqual(expect.arrayContaining(['B6:B7', 'B8:E8']))
    expect(cellText(main.rows[5]?.[3])).toBe('Северная — Южная: км 100+000 — 121+000')
    expect(cellText(main.rows[5]?.[4])).toBe('Озёрная, Берёзовка')
    expect(cellText(main.rows[5]?.[5])).toBe(
      `=SUMIFS('Границы ПД'!$H:$H,'Границы ПД'!$A:$A,"ПД-1")/1000`,
    )
    expect(cellText(main.rows[5]?.[6])).toBe(
      '=SUMIFS(Станции!$H$2:$H$5,Станции!$E$2:$E$5,"ПД-1")/1000',
    )
    expect(main.print).toEqual({ orientation: 'landscape', onePage: true })
    expect(column(0)).toContain(
      'Начальник дистанции  ______________________ / ______________________ /',
    )
  })

  it('станции: одна строка на станцию, примыкание, станции вне привязки отдельно', () => {
    const division = buildAdmDivision(fictionalSource())
    const sheet = division.workbook.sheets[1]!
    const names = sheet.rows.map((row) => cellText(row[1]))
    expect(names.slice(1, 5)).toEqual(['Озёрная', 'Берёзовка', 'Каменка', 'Ключи'])
    expect(cellText(sheet.rows[1]?.[2])).toBe('Озёрная — Ключи / Северная — Южная')
    expect(cellText(sheet.rows[1]?.[3])).toBe('10+400; 101+300')
    expect(cellText(sheet.rows[1]?.[10])).toBe('Примыкание направлений')
    expect(cellText(sheet.rows[3]?.[10])).toBe('Привязана также к ПД-10')
    expect(cellText(sheet.rows[2]?.[6])).toBe(
      `=COUNTIFS('Пути (исх.)'!$B:$B,B3,'Пути (исх.)'!$C:$C,"<>главный")`,
    )
    expect(names).toContain('Разъезд 7 км')
    expect(division.warnings).toEqual(
      expect.arrayContaining([
        'Станция Каменка привязана к нескольким ПД (ПД-2, ПД-10): в итоги входит по ПД-2.',
        'ПД-2, Северная — Южная км 121+000 — 140+500: в выгрузке длина 19000 м, по координатам и длинам км 19500 м.',
      ]),
    )
    expect(
      cellText(
        division.workbook.sheets[0]!.rows.find((r) =>
          String(cellText(r[0])).startsWith('Станции Разъезд'),
        )?.[0],
      ),
    ).toContain('нет в привязке станций к ПД')
  })

  it('длина участка — значение по длинам км; без направления — замечание и пустая ячейка', () => {
    const source = fictionalSource()
    const division = buildAdmDivision({
      ...source,
      boundaries: [
        ...source.boundaries,
        {
          pd: 'ПД-10',
          line: 'Нет такого',
          from: { km: 1, m: 0 },
          to: { km: 2, m: 0 },
          statedLength: null,
        },
        {
          pd: 'ПД-10',
          line: 'Озёрная — Ключи',
          from: { km: 40, m: 0 },
          to: { km: 39, m: 0 },
          statedLength: null,
        },
      ],
    })
    const sheet = division.workbook.sheets[2]!
    expect(sheet.rows[1]?.[7]).toMatchObject({ value: 20_964 })
    expect(sheet.rows.flat().some((c) => c && 'formula' in c && c.formula.includes('1000'))).toBe(
      false,
    )
    expect(division.warnings).toEqual(
      expect.arrayContaining([
        'ПД-10: направление «Нет такого» отсутствует или неоднозначно — длина участка не посчитана.',
        'ПД-10, Озёрная — Ключи: начало участка не раньше конца.',
      ]),
    )
    expect(division.totals.byPd.get('ПД-10')?.mainMeters).toBe(20_000)
  })

  it('ПД без ПЧУ — отдельная группа, справочник без пустых строк в формулах', () => {
    const source = fictionalSource()
    const division = buildAdmDivision({
      ...source,
      units: [...source.units, { code: 'ПД-7', kind: 'ПД' }],
    })
    const main = division.workbook.sheets[0]!
    expect(main.rows.map((r) => cellText(r[1]))).toContain('Итого по ПД без ПЧУ · станций: 0')
    const reference = division.workbook.sheets[3]!
    expect(reference.rows.map((r) => cellText(r[0])).slice(1, 6)).toEqual([
      'ПЧУ-1',
      'ПЧУ-2',
      'ПД-1',
      'ПД-2',
      'ПД-7',
    ])
    const read = evaluateWorkbook(division.workbook)
    const row = main.rows.findIndex((r) => cellText(r[2])?.toString().includes('"ПД-7"')) + 1
    expect(read(ADM_SHEETS.main, `C${row}`)).toBe('ПД-7\n')
  })

  it('экранирует кавычки и имена листов в формулах', () => {
    expect(formulaText('ПД "Север"')).toBe('"ПД ""Север"""')
    expect(sheetRef('Станции')).toBe('Станции!')
    expect(sheetRef('Пути (исх.)')).toBe("'Пути (исх.)'!")
    expect(sheetRef("Д'Арк")).toBe("'Д''Арк'!")
    expect(columnName(1)).toBe('A')
    expect(columnName(27)).toBe('AA')
  })
})
