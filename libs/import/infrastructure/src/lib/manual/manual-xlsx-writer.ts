import { strToU8, zipSync } from 'fflate'
import type { ManualBasis } from '@eow/passport/import-api'
import { MANUAL_SHEETS } from '@eow/passport/import-api'
import { columnLetter } from '../export/sheet'
import { MANUAL_COLUMNS, MANUAL_KEYS, manualCells, type ManualCell } from './manual-layout'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const xml = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
function text(s: string): string {
  const literal = s.replaceAll(/_x[0-9a-f]{4}_/giu, (m) => '_x005F_' + m.slice(1))
  return xml(
    [...literal]
      .map((ch) => {
        const code = ch.charCodeAt(0)
        return code < 32 && code !== 9 && code !== 10
          ? `_x${code.toString(16).padStart(4, '0')}_`
          : ch
      })
      .join(''),
  )
}

function sheet(rows: readonly (readonly ManualCell[])[], width: number, hideId: boolean): string {
  const body = rows
    .map(
      (r, i) =>
        `<row r="${i + 1}"${i === 0 ? ' ht="32" customHeight="1"' : ''}>${r
          .map((v, j) => {
            if (v === null) return ''
            const attrs = `r="${columnLetter(j + 1)}${i + 1}" s="${i === 0 ? 1 : 0}"`
            if (typeof v === 'number') {
              if (!Number.isFinite(v)) throw new Error('нечисловое значение')
              return `<c ${attrs}><v>${v}</v></c>`
            }
            return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${text(v)}</t></is></c>`
          })
          .join('')}</row>`,
    )
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${width - (hideId ? 1 : 0)}" width="25" customWidth="1"/>${hideId ? `<col min="${width}" max="${width}" width="16" customWidth="1" hidden="1"/>` : ''}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${columnLetter(width - (hideId ? 1 : 0))}${Math.max(1, rows.length)}"/></worksheet>`
}
/** Минимальный SpreadsheetML: https://learn.microsoft.com/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document */
export function writeManualXlsx(basis: ManualBasis): Uint8Array {
  const data = manualCells(basis.data)
  const names = [...MANUAL_KEYS.map((key) => MANUAL_SHEETS[key]), '_Шаблон']
  const parts: Record<string, Uint8Array> = {}
  const add = (path: string, value: string): void => {
    parts[path] = strToU8(value)
  }
  add(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
  )
  add(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  add(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"${name === '_Шаблон' ? ' state="hidden"' : ''}/>`).join('')}</sheets></workbook>`,
  )
  add(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="styles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  )
  add(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF244763"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf xfId="0"/><xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  )
  MANUAL_KEYS.forEach((key, i) =>
    add(
      `xl/worksheets/sheet${i + 1}.xml`,
      sheet([MANUAL_COLUMNS[key], ...data[key]], MANUAL_COLUMNS[key].length, true),
    ),
  )
  add(
    'xl/worksheets/sheet6.xml',
    sheet(
      [
        ['editor-of-work/manual-data', 1],
        ['Дата редакции', basis.date],
        ['Основа', basis.token],
      ],
      2,
      false,
    ),
  )
  return zipSync(parts)
}
