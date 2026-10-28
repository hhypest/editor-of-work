import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core'
import {
  buildPdSheets,
  exportPdBatch,
  type PdfBatchClient,
  type EditorSheetClient,
  type EditorPdfClient,
  type PdDocument,
  type OverviewScale,
  type TextMeasurer,
} from '@eow/documents/application'
import type { PlanPageSelection, PlanPreviewContext, PlanSheetData } from '@eow/planning/sheet-api'
import { SHEET_MEASURER } from './overview.facade'

export const EDITOR_PDF_CLIENT = new InjectionToken<EditorPdfClient>('PDF листа редактора')
export const EDITOR_PDF_BATCH_CLIENT = new InjectionToken<PdfBatchClient>('Пакетный PDF листов ПД')
/** Какие листы сохранить пакетом: текущий ПД, все ПД в один файл или по файлам. */
export type PdfBatchKind = 'pd' | 'all' | 'folder'
export const EDITOR_SHEET_CLIENT = new InjectionToken<EditorSheetClient>('Листы редактора плана')
/** Монотонные часы для замеров подготовки листа и пакетного PDF; в тестах подменяются. */
export const SHEET_CLOCK = new InjectionToken<() => number>('Часы замеров листа', {
  providedIn: 'root',
  factory: () => () => performance.now(),
})
/** Секунды с одним знаком после запятой: «12,4 с». */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} с`
}
@Injectable()
export class EditorSheetsFacade {
  private readonly pdf = inject(EDITOR_PDF_CLIENT, { optional: true })
  private readonly batch = inject(EDITOR_PDF_BATCH_CLIENT, { optional: true })
  private stopRequested = false
  private readonly client = inject(EDITOR_SHEET_CLIENT)
  private readonly prepare = inject(SHEET_MEASURER)
  private readonly now = inject(SHEET_CLOCK)
  private generation = 0
  private key: string | null = null
  private source: PlanSheetData | null = null
  private measurer: TextMeasurer | undefined
  private planEpoch: number | undefined
  readonly selected = signal('')
  readonly scale = signal<OverviewScale>(50000)
  readonly savedScale = signal<OverviewScale>(50000)
  readonly zoom = signal(0.5)
  readonly exporting = signal(false)
  /** Идёт пакетное сохранение; stoppable — можно остановить до печати общего файла. */
  readonly batchRunning = signal(false)
  readonly batchStoppable = signal(false)
  readonly pdfStatus = signal<string | null>(null)
  readonly pdfError = signal<string | null>(null)
  readonly busy = signal(false)
  /**
   * Время подготовки текущего листа после правки, смены ПД или масштаба, мс: данные плана из
   * main и раскладка листов (критерий приёмки — быстрее 200 мс). Отрисовка SVG не входит.
   */
  readonly prepareMs = signal<number | null>(null)
  readonly error = signal<string | null>(null)
  private readonly readyContext = signal<{
    readonly revision: number
    readonly area: string
  } | null>(null)
  readonly document = signal<PdDocument | null>(null)
  readonly index = signal(0)
  readonly page = computed(() => this.document()?.pages[this.index()] ?? null)
  readonly selection = computed<PlanPageSelection | null>(() => {
    const context = this.readyContext(),
      page = this.page(),
      ids = this.document()?.workIdsByPage[this.index()]
    return context && page && ids && !this.busy()
      ? { ...context, page: page.number, workIds: ids }
      : null
  })
  constructor() {
    inject(DestroyRef).onDestroy(() => ++this.generation)
  }
  private invalidate(): void {
    ++this.generation
    this.key = null
    this.source = null
    this.readyContext.set(null)
    this.document.set(null)
    this.error.set(null)
    this.busy.set(false)
    this.prepareMs.set(null)
  }
  async sync(context: PlanPreviewContext | null): Promise<void> {
    if (!context?.hasPlan || !context.area.startsWith('pd:') || context.hasRecovery) {
      this.invalidate()
      this.selected.set('')
      this.index.set(0)
      return
    }
    const pd = context.area.slice(3)
    const savedScale = context.pdScale ?? 50000
    const epoch = context.planEpoch ?? 0
    if (pd !== this.selected() || savedScale !== this.savedScale() || epoch !== this.planEpoch) {
      this.index.set(0)
      this.selected.set(pd)
      this.scale.set(savedScale)
      this.savedScale.set(savedScale)
      this.planEpoch = epoch
    }
    if (context.busy) {
      this.invalidate()
      this.busy.set(true)
      return
    }
    const key = JSON.stringify([context.revision, pd, savedScale, epoch])
    if (key === this.key) return
    this.invalidate()
    this.key = key
    const generation = this.generation
    const started = this.now()
    this.busy.set(true)
    try {
      const result = await this.client.source(context.revision, pd)
      if (generation !== this.generation) return
      if (!result.ok) {
        this.error.set(result.error.message)
        return
      }
      const measurer = this.measurer ?? (await this.prepare())
      if (generation !== this.generation) return
      this.measurer = measurer
      this.source = result.value
      this.rebuild(started)
      this.readyContext.set({ revision: context.revision, area: context.area })
    } catch {
      if (generation === this.generation)
        this.error.set('Не удалось подготовить лист или встроенные шрифты. Повторите попытку.')
    } finally {
      if (generation === this.generation) this.busy.set(false)
    }
  }
  canExport(context: PlanPreviewContext | null): boolean {
    const ready = this.selection()
    return (
      !!context?.hasPlan &&
      !context.busy &&
      !context.pending &&
      !context.hasRecovery &&
      !this.exporting() &&
      !!ready &&
      ready.revision === context.revision &&
      ready.area === context.area
    )
  }
  async exportPdf(context: PlanPreviewContext | null): Promise<void> {
    if (!this.canExport(context)) {
      if (!this.exporting())
        this.pdfError.set('Выберите готовый лист ПД и примените или отмените незавершённый ввод.')
      return
    }
    const selected = this.selection(),
      page = this.page()
    if (!selected || !page) return
    this.exporting.set(true)
    this.pdfError.set(null)
    this.pdfStatus.set('Подготовка и сохранение PDF…')
    try {
      if (!this.pdf) throw new Error('PDF недоступен')
      const result = await this.pdf.export({
        revision: selected.revision,
        pd: selected.area.slice(3),
        page,
      })
      if (!result.ok) {
        this.pdfError.set(result.error.message)
        this.pdfStatus.set(null)
      } else
        this.pdfStatus.set(
          result.value === 'saved'
            ? `PDF листа ${page.number} сохранён.`
            : 'Сохранение PDF отменено.',
        )
    } catch {
      this.pdfError.set('Не удалось сохранить PDF. Повторите попытку.')
      this.pdfStatus.set(null)
    } finally {
      this.exporting.set(false)
    }
  }
  canExportBatch(context: PlanPreviewContext | null): boolean {
    const ready = this.readyContext()
    return (
      !!this.batch &&
      !!context?.hasPlan &&
      !context.busy &&
      !context.pending &&
      !context.hasRecovery &&
      !this.exporting() &&
      !this.busy() &&
      !!this.source &&
      !!this.measurer &&
      !!ready &&
      ready.revision === context.revision &&
      ready.area === context.area
    )
  }
  /** Листы печатаются в масштабе, сохранённом в плане у каждого ПД (ADR-0039). */
  async exportBatch(kind: PdfBatchKind, context: PlanPreviewContext | null): Promise<void> {
    const source = this.source,
      measurer = this.measurer,
      ready = this.readyContext()
    if (!this.canExportBatch(context) || !source || !measurer || !ready || !this.batch) {
      if (!this.exporting())
        this.pdfError.set(
          'Дождитесь готового листа ПД и примените или отмените незавершённый ввод.',
        )
      return
    }
    const pds = kind === 'pd' ? [this.selected()] : source.pds.map((pd) => pd.id)
    const names = new Map(source.pds.map((pd) => [pd.id, pd.name]))
    this.stopRequested = false
    this.exporting.set(true)
    this.batchRunning.set(true)
    this.batchStoppable.set(true)
    this.pdfError.set(null)
    this.pdfStatus.set('Выбор файла PDF…')
    // Время пакета считается от первого шага после диалога выбора файла или папки.
    let started: number | undefined
    try {
      const result = await exportPdBatch({
        client: this.batch,
        sheets: this.client,
        measurer,
        revision: ready.revision,
        mode: kind === 'folder' ? 'folder' : 'file',
        pds,
        stopped: () => this.stopRequested,
        progress: (step) => {
          started ??= this.now()
          if (step.phase === 'print') {
            this.batchStoppable.set(false)
            this.pdfStatus.set(`Печать и сохранение PDF: листов ${step.pages}…`)
          } else
            this.pdfStatus.set(
              `${kind === 'folder' ? 'Сохранение' : 'Подготовка'} ${names.get(step.pd ?? '') ?? step.pd} (${step.done + 1} из ${step.total})…`,
            )
        },
      })
      if (!result.ok) {
        this.pdfError.set(
          result.error.files && !result.error.message.includes('Сохранено файлов')
            ? `${result.error.message} Сохранено файлов: ${result.error.files}.`
            : result.error.message,
        )
        this.pdfStatus.set(null)
      } else if (result.value.outcome === 'cancelled')
        this.pdfStatus.set(
          result.value.files
            ? `Сохранение PDF остановлено. Сохранено файлов: ${result.value.files}.`
            : 'Сохранение PDF отменено.',
        )
      else {
        const took = started === undefined ? '' : ` за ${seconds(this.now() - started)}`
        this.pdfStatus.set(
          kind === 'folder'
            ? `PDF сохранены: файлов ${result.value.files}, листов ${result.value.pages}${took}.`
            : `PDF сохранён: листов ${result.value.pages}${took}.`,
        )
      }
    } catch {
      this.pdfError.set('Не удалось сохранить PDF. Повторите попытку.')
      this.pdfStatus.set(null)
    } finally {
      this.exporting.set(false)
      this.batchRunning.set(false)
      this.batchStoppable.set(false)
    }
  }
  /** Остановка проверяется между ПД; уже начатая печать общего файла завершается. */
  stopBatch(): void {
    if (this.batchStoppable()) {
      this.stopRequested = true
      this.pdfStatus.set('Остановка после текущего ПД…')
    }
  }
  async retry(context: PlanPreviewContext | null): Promise<void> {
    this.key = null
    await this.sync(context)
  }
  setScale(value: number): void {
    if (this.busy() || (value !== 25000 && value !== 50000 && value !== 100000)) return
    this.scale.set(value)
    this.index.set(0)
    this.rebuild(this.now())
  }
  setZoom(value: number): void {
    if (Number.isFinite(value) && value >= 0.3 && value <= 1.5) this.zoom.set(value)
  }
  move(delta: number): void {
    const index = this.index() + delta
    if (!this.busy() && index >= 0 && index < (this.document()?.pages.length ?? 0))
      this.index.set(index)
  }
  private rebuild(started: number): void {
    if (!this.source || !this.measurer) return
    const result = buildPdSheets(this.source, this.selected(), this.scale(), this.measurer)
    this.document.set(result.ok ? result.value : null)
    this.error.set(result.ok ? null : result.error.message)
    this.prepareMs.set(result.ok ? Math.round(this.now() - started) : null)
    if (result.ok)
      this.index.set(Math.min(this.index(), Math.max(0, result.value.pages.length - 1)))
  }
}
