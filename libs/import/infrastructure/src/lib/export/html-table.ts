import { decodeEntities } from './xml'
import { SheetBuilder, type Sheet } from './sheet'

/** Текст ячейки: `<br>` — перевод строки, прочие теги убраны, сущности раскрыты. */
function cellText(html: string): string {
  return decodeEntities(
    html
      .replaceAll(/<br\s*\/?>/giu, '\n')
      .replaceAll(/<[^>]*>/gu, '')
      .replaceAll(/[ \t\r]*\n[ \t\r]*/gu, '\n'),
  )
    .replaceAll(/[ \t\r\f]+/gu, ' ')
    .trim()
}

/** Имя листа из `<x:Name>` разметки Excel; без него — «Лист1». */
export function htmlSheetName(html: string): string {
  return decodeEntities(/<x:Name>([\s\S]*?)<\/x:Name>/iu.exec(html)?.[1]?.trim() ?? 'Лист1')
}

export type HtmlTableResult =
  | { readonly kind: 'table'; readonly sheet: Sheet }
  | { readonly kind: 'none' }
  /** Таблица начата, но не закончена: файл оборван. rows — сколько строк прочитано целиком. */
  | { readonly kind: 'truncated'; readonly rows: number; readonly length: number }

/**
 * Первая таблица страницы как лист. Выгрузки ЕК АСУИ — одна плоская таблица без
 * объединений; `colspan` разворачивается в пустые ячейки, чтобы столбцы не съезжали.
 * Длинную выгрузку ЕК АСУИ обрезает (встречено на 1 048 576 символах): у такой таблицы
 * нет `</table>`. Неполные данные не читаются молча — это отдельный результат.
 */
export function readHtmlTable(html: string): HtmlTableResult {
  const start = /<table\b[^>]*>/iu.exec(html)
  if (!start) return { kind: 'none' }
  const rest = html.slice(start.index + start[0].length)
  const end = /<\/table>/iu.exec(rest)
  const table = end ? rest.slice(0, end.index) : rest
  const b = new SheetBuilder()
  let row = 0
  for (const tr of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)) {
    row += 1
    let col = 0
    for (const td of (tr[1] ?? '').matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/giu)) {
      col += 1
      b.set(row, col, cellText(td[3] ?? ''))
      const span = Number(/colspan\s*=\s*["']?(\d+)/iu.exec(td[2] ?? '')?.[1] ?? 1)
      col += Math.max(0, span - 1)
    }
  }
  if (!end) return { kind: 'truncated', rows: row, length: html.length }
  return row === 0 ? { kind: 'none' } : { kind: 'table', sheet: b.build(htmlSheetName(html), true) }
}

/** Путь листа frameset из `<x:WorksheetSource HRef=…>` или `<frame src=…>`. */
export function framesetSheetPath(html: string): string | undefined {
  return (
    /<x:WorksheetSource\s+HRef\s*=\s*["']([^"']+)["']/iu.exec(html)?.[1] ??
    /<frame\b[^>]*\bsrc\s*=\s*["']([^"']+sheet\d+\.html?)["']/iu.exec(html)?.[1]
  )
}
