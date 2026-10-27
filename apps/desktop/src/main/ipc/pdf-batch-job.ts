import { randomUUID } from 'node:crypto'
import { MAX_PDF_BYTES, MAX_PDF_PAGES } from '@eow/ipc/contracts'
import {
  pdfFileNames,
  type PdfBatchMode,
  type PdfBatchWriter,
  type SheetPage,
} from '@eow/documents/application'
import { err, ok, type Result } from '@eow/shared/kernel'

interface Job {
  readonly id: string
  readonly mode: PdfBatchMode
  readonly revision: number
  readonly pds: readonly string[]
  /** Файл для режима «файл» или папка для режима «папка». */
  readonly target: string
  readonly names: readonly string[]
  readonly pages: SheetPage[]
  /** Размер накопленных листов в единицах строки JSON, как считает окно печати. */
  bytes: number
  done: number
}
export interface PdfBatchState {
  readonly job: string
  readonly total: number
  readonly done: number
}
type Failure = { readonly message: string }

/**
 * Одно пакетное задание PDF (ADR-0039). Путь и папка остаются здесь; renderer знает
 * только идентификатор. Любая ошибка снимает задание, в режиме «файл» ничего не пишется.
 */
export function pdfBatchJobs(writer: PdfBatchWriter) {
  let job: Job | undefined
  const drop = (message: string, written = 0): Result<never, Failure> => {
    const mode = job?.mode
    job = undefined
    return err({
      message:
        mode === 'folder' && written > 0 ? `${message} Сохранено файлов: ${written}.` : message,
    })
  }
  const state = (j: Job): PdfBatchState => ({ job: j.id, total: j.pds.length, done: j.done })
  return {
    /** names — подписи ПД в том же порядке: из них строятся имена файлов. */
    async start(
      revision: number,
      mode: PdfBatchMode,
      pds: readonly string[],
      names: readonly string[],
      fileName: string,
    ): Promise<Result<PdfBatchState | 'cancelled', Failure>> {
      job = undefined
      if (new Set(pds).size !== pds.length) return err({ message: 'ПД в пакете повторяется.' })
      if (mode === 'file') {
        const path = await writer.chooseFile(fileName)
        if (!path) return ok('cancelled')
        if (!/\.pdf$/iu.test(path)) return err({ message: 'Укажите имя файла с расширением .pdf.' })
        job = {
          id: randomUUID(),
          mode,
          revision,
          pds,
          target: path,
          names: [],
          pages: [],
          bytes: 0,
          done: 0,
        }
        return ok(state(job))
      }
      const folder = await writer.chooseFolder()
      if (!folder) return ok('cancelled')
      const files = pdfFileNames(names)
      const taken = await writer.existing(folder, files)
      if (taken.length)
        return err({
          message: `В папке уже есть ${taken.length === 1 ? 'файл' : 'файлы'} ${taken
            .slice(0, 5)
            .map((n) => `«${n}»`)
            .join(
              ', ',
            )}${taken.length > 5 ? ' и другие' : ''}. Выберите другую папку: существующие PDF не перезаписываются.`,
        })
      job = {
        id: randomUUID(),
        mode,
        revision,
        pds,
        target: folder,
        names: files,
        pages: [],
        bytes: 0,
        done: 0,
      }
      return ok(state(job))
    },
    async add(
      id: string,
      revision: number,
      pd: string,
      pages: readonly SheetPage[],
    ): Promise<Result<PdfBatchState, Failure>> {
      const current = job
      if (current?.id !== id) return err({ message: 'Задание PDF уже завершено или отменено.' })
      if (current.revision !== revision)
        return drop('План изменился во время сохранения PDF. Повторите сохранение.', current.done)
      if (current.pds[current.done] !== pd)
        return drop('Листы ПД переданы не по порядку. Повторите сохранение.', current.done)
      if (current.mode === 'file') {
        if (current.pages.length + pages.length > MAX_PDF_PAGES)
          return drop(
            `В одном PDF допускается не более ${MAX_PDF_PAGES} листов. Сохраните ПД по файлам.`,
          )
        // Тот же бюджет, что у окна печати: иначе отказ проявился бы только при печати.
        const bytes = current.bytes + JSON.stringify(pages).length + (current.pages.length ? 1 : 0)
        if (bytes > MAX_PDF_BYTES)
          return drop('Листы превышают 64 МиБ для одного PDF. Сохраните ПД по файлам.')
        current.bytes = bytes
        current.pages.push(...pages)
      } else {
        const name = current.names[current.done]
        if (name === undefined)
          return drop('Переданы лишние листы ПД. Повторите сохранение.', current.done)
        const written = await writer.write(writer.join(current.target, name), pages, {
          replace: false,
        })
        if (!written.ok) return drop(written.error.message, current.done)
      }
      current.done++
      return ok(state(current))
    },
    async finish(id: string, revision: number): Promise<Result<void, Failure>> {
      const current = job
      if (current?.id !== id) return err({ message: 'Задание PDF уже завершено или отменено.' })
      if (current.revision !== revision)
        return drop('План изменился во время сохранения PDF. Повторите сохранение.', current.done)
      if (current.done !== current.pds.length)
        return drop('Переданы не все ПД пакета. Повторите сохранение.', current.done)
      job = undefined
      if (current.mode === 'folder') return ok(undefined)
      // Замену существующего файла пользователь подтвердил в диалоге сохранения.
      const written = await writer.write(current.target, current.pages, { replace: true })
      return written.ok ? ok(undefined) : err(written.error)
    },
    cancel(id: string): void {
      if (job?.id === id) job = undefined
    },
    /** Смена или замена плана снимает задание. */
    reset(): void {
      job = undefined
    },
  }
}
