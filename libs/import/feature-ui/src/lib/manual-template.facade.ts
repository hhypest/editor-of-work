import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core'
import type {
  ManualTemplateClient,
  ManualTemplateEdition,
  ManualTemplateReview,
  ManualTemplateAction,
} from '@eow/import/application'

export const MANUAL_TEMPLATE_CLIENT = new InjectionToken<ManualTemplateClient>(
  'Шаблон ручных данных',
)
export const MANUAL_TEMPLATE_TEXT = {
  title: 'Ручные данные паспорта',
  instruction:
    'Выдайте книгу с текущими данными, заполните её и загрузите для проверки. Книга заменяет пять ручных разделов целиком после подтверждения. Нормативы задаёт составитель.',
  edition: 'Редакция паспорта',
  noEditions: 'Нет редакций. Создайте черновик в разделе «Паспорт».',
  immutable: 'Правка доступна только в черновике. Создайте новую редакцию в разделе «Паспорт».',
  export: 'Выдать шаблон',
  prepare: 'Загрузить заполненную книгу',
  review: 'Проверка перед записью',
  sheet: 'Лист',
  added: 'Добавлено',
  changed: 'Изменено',
  removed: 'Удалено',
  confirm: 'Подтвердить замену ручных данных',
  cancel: 'Отменить загрузку',
  pending: 'Дождитесь завершения операции…',
  exported: 'Шаблон сохранён. Заполните книгу и верните её через «Загрузить заполненную книгу».',
  applied: 'Ручные данные сохранены. Обновлённые значения доступны в разделе «Паспорт».',
  unchanged: 'Изменений нет. Подтверждение не изменит данные и журнал.',
  expiry:
    'Подтвердите в течение 10 минут. Если паспорт изменится, потребуется загрузить книгу заново.',
  retry: 'Обновить список редакций',
  statusText: { draft: 'Черновик', active: 'Действующая', archived: 'Архивная' },
} as const

@Injectable()
export class ManualTemplateFacade {
  private readonly client = inject(MANUAL_TEMPLATE_CLIENT)
  readonly editions = signal<readonly ManualTemplateEdition[]>([])
  readonly selected = signal<number | null>(null)
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)
  readonly message = signal<string | null>(null)
  readonly review = signal<ManualTemplateReview | null>(null)
  readonly canEdit = computed(
    () => this.editions().find((e) => e.id === this.selected())?.status === 'draft',
  )
  readonly unchanged = computed(
    () => this.review()?.changes.every((s) => s.added + s.changed + s.removed === 0) ?? false,
  )

  async load(): Promise<void> {
    if (this.busy() || this.review()) return
    this.busy.set(true)
    this.error.set(null)
    try {
      const result = await this.client.list()
      if (!result.ok) {
        this.error.set(result.error.message)
        return
      }
      this.editions.set(result.value)
      this.selected.set(
        result.value.find((e) => e.id === this.selected())?.id ??
          result.value.find((e) => e.status === 'draft')?.id ??
          result.value.at(-1)?.id ??
          null,
      )
    } catch {
      this.error.set('Не удалось получить редакции. Повторите попытку.')
    } finally {
      this.busy.set(false)
    }
  }
  select(id: number): void {
    if (this.busy() || this.review() || !this.editions().some((e) => e.id === id)) return
    this.selected.set(id)
    this.error.set(null)
    this.message.set(null)
  }
  async run(action: 'export' | 'prepare' | 'apply' | 'discard'): Promise<void> {
    const editionId = this.selected()
    if (this.busy() || editionId === null) return
    if ((action === 'prepare' || action === 'apply') && !this.canEdit()) return
    const review = this.review()
    if ((action === 'apply' || action === 'discard') && review === null) return
    if ((action === 'export' || action === 'prepare') && review !== null) return
    const request: ManualTemplateAction =
      action === 'apply' || action === 'discard'
        ? { action, editionId, token: review?.token ?? '' }
        : { action, editionId }
    this.busy.set(true)
    this.error.set(null)
    this.message.set(null)
    try {
      const result = await this.client.run(request)
      if (result.status === 'error') {
        this.error.set(result.message)
        if (action === 'apply') this.review.set(null)
      } else if (result.status === 'preview') {
        this.review.set(result.review)
      } else if (result.status === 'exported') {
        this.message.set(MANUAL_TEMPLATE_TEXT.exported)
      } else if (result.status === 'applied') {
        this.review.set(null)
        this.message.set(MANUAL_TEMPLATE_TEXT.applied)
      } else if (result.status === 'discarded') {
        this.review.set(null)
      }
    } catch {
      this.review.set(null)
      this.error.set(
        'Не удалось завершить операцию. Проверьте данные паспорта и загрузите книгу заново.',
      )
    } finally {
      this.busy.set(false)
    }
  }
}
