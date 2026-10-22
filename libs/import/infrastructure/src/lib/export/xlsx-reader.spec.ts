import { strToU8, unzipSync, zipSync } from 'fflate'
import { excelDate, readXlsx } from './xlsx-reader'
import { cell } from './sheet'

/** Книга из одного листа: в A1 дата (формат 14 — встроенный формат даты), в B1 строка. */
function book(date1904: boolean): Uint8Array {
  const pr = date1904 ? '<workbookPr date1904="1"/>' : '<workbookPr/>'
  return zipSync({
    'xl/workbook.xml': strToU8(
      `<workbook xmlns:r="r">${pr}<sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/styles.xml': strToU8(
      '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>36526</v></c>' +
        '<c r="B1" t="inlineStr"><is><t>a&amp;b_x000A_c</t></is></c></row></sheetData></worksheet>',
    ),
  })
}

function firstRow(bytes: Uint8Array): unknown[] {
  const r = readXlsx(bytes)
  const sheet = r.ok ? r.value[0] : undefined
  if (!sheet) throw new Error('лист не прочитан')
  return [cell(sheet, 1, 1), cell(sheet, 1, 2)]
}

describe('Читатель xlsx', () => {
  it('даты по системе 1900 и по системе 1904 (флаг date1904 книги)', () => {
    expect(excelDate(2958465)).toBe('9999-12-31')
    expect(firstRow(book(false))[0]).toBe('2000-01-01')
    expect(firstRow(book(true))[0]).toBe('2004-01-02')
  })

  it('строки: сущности и экранирование OOXML', () => {
    expect(firstRow(book(false))[1]).toBe('a&b\nc')
  })

  it('превышение распакованного размера возвращает Result вместо частичной книги', () => {
    const bytes = book(false)
    const view = new DataView(bytes.buffer)
    // workbook.xml is the first central directory entry.
    for (let i = 0; i + 46 <= bytes.length; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 33 * 1024 * 1024, true)
        break
      }
    }
    expect(readXlsx(bytes)).toMatchObject({
      ok: false,
      error: { kind: 'broken', detail: expect.stringContaining('лимит 32 МиБ') },
    })
  })

  it('служебный скрытый лист не распаковывается; ручной шаблон учитывает его в бюджете', () => {
    const parts = unzipSync(book(false))
    const bytes = zipSync({
      ...parts,
      'xl/workbook.xml': strToU8(
        '<workbook><sheets><sheet name="Видимый" r:id="rId1"/>' +
          '<sheet name="Скрытый" state="hidden" r:id="rId2"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      ),
      'xl/worksheets/sheet2.xml': strToU8('маленький лист'),
    })
    const view = new DataView(bytes.buffer)
    // Make only the hidden part claim a huge output without constructing that output.
    for (let i = 0; i + 46 <= bytes.length; i++) {
      if (view.getUint32(i, true) !== 0x02014b50) continue
      const name = new TextDecoder().decode(
        bytes.subarray(i + 46, i + 46 + view.getUint16(i + 28, true)),
      )
      if (name === 'xl/worksheets/sheet2.xml') view.setUint32(i + 24, 33 * 1024 * 1024, true)
    }
    const read = readXlsx(bytes)
    expect(read.ok && read.value.map((s) => s.name)).toEqual(['Видимый'])
    expect(readXlsx(bytes, { includeHidden: true })).toMatchObject({
      ok: false,
      error: { detail: expect.stringContaining('лимит 32 МиБ') },
    })
  })
})
