import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core'
import {
  buildPdSheets,
  type PdSheetClient,
  type OverviewDocument,
  type OverviewScale,
  type TextMeasurer,
} from '@eow/documents/application'
import type { PlanSheetData } from '@eow/planning/sheet-api'
import { SHEET_MEASURER } from './overview.facade'

export const PD_SHEET_CLIENT = new InjectionToken<PdSheetClient>('Источник листов ПД')
@Injectable()
export class PdSheetsFacade {
  private readonly client = inject(PD_SHEET_CLIENT)
  private readonly prepare = inject(SHEET_MEASURER)
  private measurer: TextMeasurer | undefined
  private revision = 0
  readonly source = signal<PlanSheetData | null>(null)
  readonly selected = signal('')
  readonly scale = signal<OverviewScale>(50000)
  readonly zoom = signal(0.7)
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)
  readonly document = signal<OverviewDocument | null>(null)
  readonly index = signal(0)
  readonly page = computed(() => this.document()?.pages[this.index()] ?? null)
  async load(open: boolean): Promise<void> {
    const revision = ++this.revision
    this.busy.set(true)
    this.error.set(null)
    try {
      const result = await this.client.load(open)
      if (revision !== this.revision) return
      if (!result.ok) {
        this.document.set(null)
        this.error.set(result.error.message)
        return
      }
      if (result.value === 'cancelled') return
      if (!result.value) {
        this.source.set(null)
        this.document.set(null)
        this.selected.set('')
        return
      }
      const measurer = this.measurer ?? (await this.prepare())
      if (revision !== this.revision) return
      this.measurer = measurer
      this.source.set(result.value)
      this.selected.set(
        result.value.pds.find((p) => p.id === this.selected())?.id ?? result.value.pds[0]?.id ?? '',
      )
      this.rebuild()
    } catch {
      if (revision === this.revision) {
        this.document.set(null)
        this.error.set('Не удалось подготовить листы ПД или встроенные шрифты.')
      }
    } finally {
      if (revision === this.revision) this.busy.set(false)
    }
  }
  select(id: string): void {
    if (this.busy() || !this.source()?.pds.some((p) => p.id === id)) return
    this.selected.set(id)
    this.rebuild()
  }
  setScale(value: number): void {
    if (this.busy() || (value !== 25000 && value !== 50000 && value !== 100000)) return
    this.scale.set(value)
    this.rebuild()
  }
  setZoom(value: number): void {
    if (Number.isFinite(value) && value >= 0.3 && value <= 1.5) this.zoom.set(value)
  }
  move(delta: number): void {
    const i = this.index() + delta
    if (i >= 0 && i < (this.document()?.pages.length ?? 0)) this.index.set(i)
  }
  private rebuild(): void {
    this.index.set(0)
    const source = this.source()
    if (!source || !this.selected() || !this.measurer) {
      this.document.set(null)
      return
    }
    const result = buildPdSheets(source, this.selected(), this.scale(), this.measurer)
    this.document.set(result.ok ? result.value : null)
    this.error.set(result.ok ? null : result.error.message)
  }
}
