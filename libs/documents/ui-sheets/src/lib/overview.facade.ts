import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core'
import {
  buildDistrictSchemeA,
  buildOverview,
  type SheetPdfClient,
  type OverviewClient,
  type OverviewDocument,
  type OverviewScale,
  type OverviewSource,
  type TextMeasurer,
} from '@eow/documents/application'

export const OVERVIEW_CLIENT = new InjectionToken<OverviewClient>('Общая схема дистанции')
export const SHEET_PDF_CLIENT = new InjectionToken<SheetPdfClient>('PDF паспортных схем')
/** Оформление листов: общая схема рядами или схема дистанции, вариант A. */
export type OverviewVariant = 'overview' | 'district-a'
export const SHEET_MEASURER = new InjectionToken<() => Promise<TextMeasurer>>(
  'Измерение текста листа',
)
export const OVERVIEW_TEXT = {
  title: 'Общая схема и схема дистанции',
  edition: 'Редакция паспорта',
  variant: 'Оформление',
  variants: {
    overview: 'Общая схема (ряды в выбранном масштабе)',
    'district-a': 'Схема дистанции, вариант A — линейная в масштабе',
  },
  autoScale: 'Масштаб подобран по самому длинному направлению',
  pdf: 'Сохранить все листы в PDF',
  pdfSaving: 'Сохранение PDF…',
  pdfSaved: 'PDF сохранён',
  pdfCancelled: 'Сохранение PDF отменено.',
  scale: 'Масштаб схемы',
  zoom: 'Масштаб просмотра',
  loading: 'Подготовка листов…',
  refresh: 'Обновить редакции',
  empty: 'Нет редакций. Создайте и заполните паспорт.',
  previous: 'Предыдущий лист',
  next: 'Следующий лист',
  warnings: 'Замечания к схеме',
  scope:
    'Предпросмотр А3 по выбранной редакции паспорта. Общая схема переносит длинные направления в ряды выбранного масштаба; схема дистанции (вариант A) показывает каждое направление одной линией в общем масштабе с полосами ПД и ПЧУ.',
} as const

@Injectable()
export class OverviewFacade {
  private readonly client = inject(OVERVIEW_CLIENT)
  private readonly prepareMeasurer = inject(SHEET_MEASURER)
  private readonly pdf = inject(SHEET_PDF_CLIENT, { optional: true })
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
  readonly variant = signal<OverviewVariant>('overview')
  /** Масштаб схемы дистанции, подобранный по самому длинному направлению. */
  readonly autoScale = signal<number | null>(null)
  readonly exporting = signal(false)
  readonly pdfStatus = signal<string | null>(null)
  readonly pdfError = signal<string | null>(null)
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
  setVariant(value: string): void {
    if (value !== 'overview' && value !== 'district-a') return
    this.variant.set(value)
    this.rebuild()
  }
  /** Все листы текущего оформления — один файл; путь выбирает main. */
  async exportPdf(): Promise<void> {
    const document = this.document()
    if (!document || this.exporting() || this.busy()) return
    if (!this.pdf) {
      this.pdfError.set('PDF доступен в настольной программе editor-of-work.')
      return
    }
    const edition = this.editions().find((e) => e.id === this.selected())
    const name = `${this.variant() === 'district-a' ? 'Схема дистанции' : 'Общая схема'} ${edition?.date ?? ''}`
    this.exporting.set(true)
    this.pdfError.set(null)
    this.pdfStatus.set(OVERVIEW_TEXT.pdfSaving)
    try {
      const result = await this.pdf.save(name.trim(), document.pages)
      if (!result.ok) {
        this.pdfError.set(result.error.message)
        this.pdfStatus.set(null)
      } else
        this.pdfStatus.set(
          result.value === 'saved'
            ? `${OVERVIEW_TEXT.pdfSaved}: листов ${document.pages.length}.`
            : OVERVIEW_TEXT.pdfCancelled,
        )
    } catch {
      this.pdfError.set('Не удалось сохранить PDF. Повторите попытку.')
      this.pdfStatus.set(null)
    } finally {
      this.exporting.set(false)
    }
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
    const district =
      this.variant() === 'district-a' ? buildDistrictSchemeA(this.source, this.measurer) : null
    const result = district ?? buildOverview(this.source, this.scale(), this.measurer)
    this.autoScale.set(district?.ok ? district.value.scale : null)
    this.pdfStatus.set(null)
    this.pdfError.set(null)
    this.pageIndex.set(0)
    this.error.set(result.ok ? null : result.error.message)
    this.document.set(result.ok ? result.value : null)
  }
}
