import {
  recognizeForm,
  type ExportError,
  type ExportFile,
  type ExportSource,
  type ExportTable,
} from '@eow/import/application'
import { err, ok, type Result } from '@eow/shared/kernel'
import { detectFileKind } from './file-kind'
import { framesetSheetPath, htmlSheetName, readHtmlTable } from './html-table'
import type { Sheet } from './sheet'
import { tableLayout } from './table-layout'
import { readXlsx } from './xlsx-reader'

const decode = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8').decode(bytes).replace(/^﻿/u, '')

function htmlSheet(file: string, html: string, name?: string): Result<Sheet[], ExportError> {
  const r = readHtmlTable(html)
  switch (r.kind) {
    case 'table':
      return ok([name ? { ...r.sheet, name } : r.sheet])
    case 'none':
      return err({ kind: 'no-table', file })
    case 'truncated':
      return err({ kind: 'truncated', file, rows: Math.max(0, r.rows - 1), length: r.length })
  }
}

async function sheetsOf(file: ExportFile): Promise<Result<Sheet[], ExportError>> {
  switch (detectFileKind(file.bytes)) {
    case 'xlsx': {
      const r = readXlsx(file.bytes)
      return r.ok ? r : err({ kind: 'broken-file', file: file.name, detail: r.error.detail })
    }
    case 'web-xls':
      return htmlSheet(file.name, decode(file.bytes))
    case 'frameset': {
      const html = decode(file.bytes)
      const part = framesetSheetPath(html)
      if (!part) return err({ kind: 'no-table', file: file.name })
      let bytes: Uint8Array | undefined
      try {
        bytes = await file.sibling?.(decodeURIComponent(part))
      } catch (e) {
        // Испорченная ссылка (%ZZ) или сбой чтения папки — ошибка файла, а не исключение.
        const detail = e instanceof Error ? e.message : String(e)
        return err({
          kind: 'broken-file',
          file: file.name,
          detail: `не читается «${part}»: ${detail}`,
        })
      }
      if (!bytes) return err({ kind: 'missing-part', file: file.name, part })
      // Имя листа — из главного файла: в самом листе frameset его может не быть.
      return htmlSheet(file.name, decode(bytes), htmlSheetName(html))
    }
    case 'binary-xls':
      return err({ kind: 'binary-xls', file: file.name })
    case 'unknown':
      return err({ kind: 'unknown-file', file: file.name })
  }
}

/**
 * Чтение выгрузок ЕК АСУИ (ADR-0006): xlsx, «веб-страничный» xls и frameset.
 * С каждого видимого листа берётся таблица, форма узнаётся по шапке. Лист без
 * узнаваемой шапки (например, «Методология» в отчёте BEx) пропускается; если не узнан
 * ни один лист — ошибка с заголовками первого листа.
 */
export class PassportExportSource implements ExportSource {
  async read(file: ExportFile): Promise<Result<readonly ExportTable[], ExportError>> {
    const sheets = await sheetsOf(file)
    if (!sheets.ok) return sheets
    const tables: ExportTable[] = []
    let firstUnknown: ExportError | undefined
    for (const sheet of sheets.value.filter((s) => s.visible)) {
      const layout = tableLayout(sheet)
      if (!layout || (layout.rows.length === 0 && layout.columns.length < 2)) continue
      const headers = layout.columns.map((c) => c.name)
      const form = recognizeForm(headers)
      if (form.ok) {
        tables.push({
          file: file.name,
          sheet: sheet.name,
          form: form.value,
          columns: layout.columns,
          rows: layout.rows,
        })
        continue
      }
      const at = { file: file.name, sheet: sheet.name }
      const error: ExportError =
        form.error.kind === 'ambiguous'
          ? { kind: 'ambiguous-form', at, forms: form.error.forms }
          : { kind: 'unknown-form', at, headers: headers.filter((h) => h !== '') }
      if (form.error.kind === 'ambiguous') return err(error)
      firstUnknown ??= error
    }
    if (tables.length > 0) return ok(tables)
    return err(firstUnknown ?? { kind: 'no-table', file: file.name })
  }
}
