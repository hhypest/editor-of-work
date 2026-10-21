/**
 * «Веб-страничный» xls ЕК АСУИ: HTML-таблица с пространством имён Excel и расширением .xls.
 * Разметка повторяет настоящие выгрузки: шапка ячейками `<td x:str>` с переносами `<br>`,
 * числа и даты — `<td align="right"x:num>` (без пробела перед x:num, как в оригинале).
 */

/** Как ячейка столбца записана в строках данных. */
export type CellKind = 'str' | 'num' | 'date'

export interface WebColumn {
  /** Заголовок как в выгрузке; «|» — перенос строки (`<br>`). */
  readonly header: string
  readonly kind: CellKind
}

export interface WebTable {
  /** Имя листа в `<x:Name>`: «Список …». */
  readonly sheet: string
  readonly columns: readonly WebColumn[]
  readonly rows: readonly (readonly string[])[]
}

const escape = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const T5 = '\t\t\t\t\t'
const T9 = '\t\t\t\t\t\t\t\t\t'

function headerCell(header: string): string {
  const text = header.split('|').map(escape).join('<br>')
  return `\n\n${T5}\t<td x:str>\n${T5}\t\t${text}\n${T5}\t</td>\n`
}

function dataCell(kind: CellKind, value: string): string {
  const open =
    kind === 'str' ? '<td x:str>' : kind === 'num' ? '<td x:num>' : '<td align="right"x:num>'
  return `\n${T9}${open}${escape(value)}</td>\n`
}

function tableRows(t: WebTable): string {
  const head = `${T5}<tr>\n${t.columns.map((c) => headerCell(c.header)).join('')}\n${T5}</tr>\n`
  const body = t.rows
    .map((row) => {
      if (row.length !== t.columns.length)
        throw new Error(`строка из ${row.length} ячеек, а столбцов ${t.columns.length}: ${t.sheet}`)
      const cells = row.map((v, i) => dataCell(t.columns[i]?.kind ?? 'str', v)).join('')
      return `\n${T5}\t\t<tr>\n${cells}\n${T5}\t\t</tr>\n`
    })
    .join('')
  return head + body
}

function workbookXml(sheet: string, source?: string): string {
  const src = source ? `\n${T5}\t\t\t<x:WorksheetSource HRef="${source}"/>` : ''
  return `${T5}<!--[if gte mso 9]>
${T5}\t<xml>
${T5}\t\t<x:ExcelWorkbook>
${T5}\t\t\t<x:ExcelWorksheets>
${T5}\t\t\t\t<x:ExcelWorksheet>
${T5}\t\t\t\t\t<x:Name>${escape(sheet)}</x:Name>${src}
${T5}\t\t\t\t\t<x:WorksheetOptions>
${T5}\t\t\t\t\t\t<x:Selected/>
${T5}\t\t\t\t\t</x:WorksheetOptions>
${T5}\t\t\t\t</x:ExcelWorksheet>
${T5}\t\t\t</x:ExcelWorksheets>
${T5}\t\t</x:ExcelWorkbook>
${T5}\t</xml>
${T5}<![endif]
${T5}-->`
}

const HEAD_STYLE = `\t\t\t<style>
\t\t\t  <!--table
\t                      tr
\t                      {vertical-align:top;}
\t\t\t     br
\t\t\t     {mso-data-placement:same-cell;}
\t\t\t  -->
\t\t\t</style>`

/** Одна HTML-таблица в файле — так выглядят выгрузки этой формы. */
export function renderWebXls(t: WebTable): string {
  return `\n\n\t\t<html xmlns:x='urn:schemas-microsoft-com:office:excel' xmlns='http://www.w3.org/TR/REC-html40'>

\t\t\t<head>
\t\t\t<meta http-equiv=Content-Type content="text/html; charset=UTF-8">
${HEAD_STYLE}
\t${workbookXml(t.sheet)}
\t\t\t</head>

\t\t\t<body>
\t\t\t\t<table>
${tableRows(t)}\t\t\t\t\t
\t\t\t\t</table>
\t\t\t</body>
\t\t</html>

`
}

/**
 * Тот же лист в формате «Веб-страница» Excel с frameset: главный файл ссылается
 * на папку `<имя>.files`, где лежит сам лист. Возвращает файлы по относительным путям.
 */
export function renderFramesetXls(baseName: string, t: WebTable): Record<string, string> {
  const dir = `${baseName}.files`
  const main = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:x="urn:schemas-microsoft-com:office:excel"
xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta name="Excel Workbook Frameset">
<meta http-equiv=Content-Type content="text/html; charset=UTF-8">
<link rel=File-List href="${dir}/filelist.xml">
${workbookXml(t.sheet, `${dir}/sheet001.htm`)}
</head>
<frameset rows="*,39" border=0 width=0 frameborder=no framespacing=0>
 <frame src="${dir}/sheet001.htm" name="frSheet">
 <frame src="${dir}/tabstrip.htm" name="frTabs" marginwidth=0 marginheight=0>
</frameset>
</html>
`
  const sheet = `<html xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv=Content-Type content="text/html; charset=UTF-8">
<link id=Main-File rel=Main-File href="../${baseName}.xls">
</head>
<body>
<table>
${tableRows(t)}</table>
</body>
</html>
`
  const filelist = `<xml xmlns:o="urn:schemas-microsoft-com:office:office">
 <o:MainFile HRef="../${baseName}.xls"/>
 <o:File HRef="sheet001.htm"/>
 <o:File HRef="tabstrip.htm"/>
 <o:File HRef="filelist.xml"/>
</xml>
`
  const tabstrip = `<html><head><meta http-equiv=Content-Type content="text/html; charset=UTF-8"></head>
<body><table><tr><td><a href="sheet001.htm" target="frSheet">${escape(t.sheet)}</a></td></tr></table></body></html>
`
  return {
    [`${baseName}.xls`]: main,
    [`${dir}/sheet001.htm`]: sheet,
    [`${dir}/filelist.xml`]: filelist,
    [`${dir}/tabstrip.htm`]: tabstrip,
  }
}
