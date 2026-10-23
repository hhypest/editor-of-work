import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core'
import {
  buildPdSheets,
  type EditorSheetClient,
  type PdDocument,
  type OverviewScale,
  type TextMeasurer,
} from '@eow/documents/application'
import type { PlanPageSelection, PlanPreviewContext, PlanSheetData } from '@eow/planning/sheet-api'
import { SHEET_MEASURER } from './overview.facade'

export const EDITOR_SHEET_CLIENT = new InjectionToken<EditorSheetClient>('Листы редактора плана')
@Injectable()
export class EditorSheetsFacade {
  private readonly client = inject(EDITOR_SHEET_CLIENT)
  private readonly prepare = inject(SHEET_MEASURER)
  private generation = 0
  private key: string | null = null
  private source: PlanSheetData | null = null
  private measurer: TextMeasurer | undefined
  private planEpoch: number | undefined
  readonly selected = signal('')
  readonly scale = signal<OverviewScale>(50000)
  readonly savedScale = signal<OverviewScale>(50000)
  readonly zoom = signal(0.5)
  readonly busy = signal(false)
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
      this.rebuild()
      this.readyContext.set({ revision: context.revision, area: context.area })
    } catch {
      if (generation === this.generation)
        this.error.set('Не удалось подготовить лист или встроенные шрифты. Повторите попытку.')
    } finally {
      if (generation === this.generation) this.busy.set(false)
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
    this.rebuild()
  }
  setZoom(value: number): void {
    if (Number.isFinite(value) && value >= 0.3 && value <= 1.5) this.zoom.set(value)
  }
  move(delta: number): void {
    const index = this.index() + delta
    if (!this.busy() && index >= 0 && index < (this.document()?.pages.length ?? 0))
      this.index.set(index)
  }
  private rebuild(): void {
    if (!this.source || !this.measurer) return
    const result = buildPdSheets(this.source, this.selected(), this.scale(), this.measurer)
    this.document.set(result.ok ? result.value : null)
    this.error.set(result.ok ? null : result.error.message)
    if (result.ok)
      this.index.set(Math.min(this.index(), Math.max(0, result.value.pages.length - 1)))
  }
}
