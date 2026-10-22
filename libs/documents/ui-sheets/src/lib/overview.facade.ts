import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core'
import {
  buildOverview,
  type OverviewClient,
  type OverviewDocument,
  type OverviewScale,
  type OverviewSource,
  type TextMeasurer,
} from '@eow/documents/application'

export const OVERVIEW_CLIENT = new InjectionToken<OverviewClient>('Общая схема дистанции')
export const SHEET_MEASURER = new InjectionToken<() => Promise<TextMeasurer>>(
  'Измерение текста листа',
)
export const OVERVIEW_TEXT = {
  title: 'Общая схема дистанции',
  edition: 'Редакция паспорта',
  scale: 'Масштаб схемы',
  zoom: 'Масштаб просмотра',
  loading: 'Подготовка листов…',
  refresh: 'Обновить редакции',
  empty: 'Нет редакций. Создайте и заполните паспорт.',
  previous: 'Предыдущий лист',
  next: 'Следующий лист',
  warnings: 'Замечания к схеме',
  scope:
    'Предпросмотр А3 по выбранной редакции паспорта. Работы годового плана и экспорт PDF будут подключены отдельными шагами.',
} as const

@Injectable()
export class OverviewFacade {
  private readonly client = inject(OVERVIEW_CLIENT)
  private readonly prepareMeasurer = inject(SHEET_MEASURER)
  private measurer: TextMeasurer | undefined
  private revision = 0
  private source: OverviewSource | undefined
  readonly editions = signal<
    readonly {
      readonly id: number
      readonly number: number
      readonly label: string
      readonly date: string
    }[]
  >([])
  readonly selected = signal<number | null>(null)
  readonly scale = signal<OverviewScale>(50000)
  readonly zoom = signal(0.7)
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)
  readonly document = signal<OverviewDocument | null>(null)
  readonly pageIndex = signal(0)
  readonly page = computed(() => this.document()?.pages[this.pageIndex()] ?? null)

  async load(): Promise<void> {
    const revision = ++this.revision
    this.busy.set(true)
    this.error.set(null)
    this.document.set(null)
    this.source = undefined
    try {
      const result = await this.client.editions()
      if (revision !== this.revision) return
      if (!result.ok) {
        this.error.set(result.error.message)
        return
      }
      this.editions.set(result.value)
      const id =
        result.value.find((e) => e.id === this.selected())?.id ?? result.value.at(-1)?.id ?? null
      this.selected.set(id)
      if (id !== null) await this.select(id)
    } catch {
      if (revision === this.revision)
        this.error.set('Не удалось загрузить редакции. Повторите попытку.')
    } finally {
      if (revision === this.revision) this.busy.set(false)
    }
  }
  async select(id: number): Promise<void> {
    if (!this.editions().some((e) => e.id === id)) return
    const revision = ++this.revision
    this.selected.set(id)
    this.busy.set(true)
    this.error.set(null)
    this.document.set(null)
    this.source = undefined
    try {
      const result = await this.client.source(id)
      if (revision !== this.revision) return
      if (!result.ok) {
        this.error.set(result.error.message)
        return
      }
      const measurer = this.measurer ?? (await this.prepareMeasurer())
      if (revision !== this.revision) return
      this.measurer = measurer
      this.source = result.value
      this.rebuild()
    } catch {
      if (revision === this.revision)
        this.error.set('Не удалось подготовить схему или встроенные шрифты. Повторите попытку.')
    } finally {
      if (revision === this.revision) this.busy.set(false)
    }
  }
  setScale(value: number): void {
    if (value !== 25000 && value !== 50000 && value !== 100000) return
    this.scale.set(value)
    this.rebuild()
  }
  setZoom(value: number): void {
    if (Number.isFinite(value) && value >= 0.3 && value <= 1.5) this.zoom.set(value)
  }
  move(delta: number): void {
    const index = this.pageIndex() + delta
    if (index >= 0 && index < (this.document()?.pages.length ?? 0)) this.pageIndex.set(index)
  }
  private rebuild(): void {
    if (!this.source || !this.measurer) return
    const result = buildOverview(this.source, this.scale(), this.measurer)
    this.pageIndex.set(0)
    this.error.set(result.ok ? null : result.error.message)
    this.document.set(result.ok ? result.value : null)
  }
}
