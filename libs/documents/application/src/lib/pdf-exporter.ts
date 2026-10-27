import type { Result } from '@eow/shared/kernel'
import type { SheetError, SheetPage } from './sheet-model'

/** Готовая модель листа: zoom просмотра в неё не входит. */
export interface EditorPdfRequest {
  readonly revision: number
  readonly pd: string
  readonly page: SheetPage
}
export type PdfOutcome = 'saved' | 'cancelled'
export interface EditorPdfClient {
  export(request: EditorPdfRequest): Promise<Result<PdfOutcome, SheetError>>
}
/** Main выбирает путь, печатает и атомарно записывает один лист. */
export interface PdfExporter {
  export(page: SheetPage): Promise<Result<PdfOutcome, SheetError>>
}

/** Пакет листов ПД (ADR-0039): один файл или файл на каждый ПД в выбранной папке. */
export type PdfBatchMode = 'file' | 'folder'
export interface PdfBatchJob {
  readonly job: string
  readonly total: number
}
/** Renderer ведёт пакет по шагам; путь и папка остаются в main. */
export interface PdfBatchClient {
  start(
    revision: number,
    mode: PdfBatchMode,
    pds: readonly string[],
  ): Promise<Result<PdfBatchJob | 'cancelled', SheetError>>
  add(
    job: string,
    revision: number,
    pd: string,
    pages: readonly SheetPage[],
  ): Promise<Result<void, SheetError>>
  finish(job: string, revision: number): Promise<Result<void, SheetError>>
  cancel(job: string): Promise<void>
}
/** Порт main: диалоги и запись. Пути не покидают main. */
export interface PdfBatchWriter {
  chooseFile(defaultName: string): Promise<string | undefined>
  chooseFolder(): Promise<string | undefined>
  /** Какие из имён уже заняты в папке: такие файлы не перезаписываются молча. */
  existing(folder: string, names: readonly string[]): Promise<readonly string[]>
  /** Печатает листы одним файлом и атомарно записывает его. */
  write(path: string, pages: readonly SheetPage[]): Promise<Result<void, SheetError>>
  /** Путь файла в выбранной папке. */
  join(folder: string, name: string): string
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu
/**
 * Имя файла PDF для ПД, допустимое в Windows: запрещённые символы заменяются «_»,
 * точки и пробелы по краям убираются, зарезервированные имена получают «_».
 * Повторы в одном пакете нумеруются: «ПД-1 (2).pdf».
 */
export function pdfFileNames(names: readonly string[]): readonly string[] {
  const used = new Set<string>()
  return names.map((name) => {
    let base = name
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
      .replace(/^[\s.]+|[\s.]+$/gu, '')
      .slice(0, 120)
    if (!base) base = 'ПД'
    if (RESERVED.test(base)) base = `_${base}`
    let candidate = `${base}.pdf`
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n}).pdf`
    used.add(candidate.toLowerCase())
    return candidate
  })
}
