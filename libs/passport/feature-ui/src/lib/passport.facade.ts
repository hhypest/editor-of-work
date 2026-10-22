import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core'
import {
  compareEditionData,
  type EditionData,
  type EditionDiff,
  type PassportEdition,
  type PassportError,
} from '@eow/passport/application'
import type { Result } from '@eow/shared/kernel'
import { editionDataView, type TableView } from './passport-view'

export interface PassportClient {
  list(): Promise<Result<readonly PassportEdition[], PassportError>>
  createDraft(input: { date: string; label: string }): Promise<Result<null, PassportError>>
  activate(id: number): Promise<Result<null, PassportError>>
  editionData(editionId: number): Promise<Result<EditionData, PassportError>>
}
export const PASSPORT_CLIENT = new InjectionToken<PassportClient>('Паспорт')

export const PASSPORT_TEXT = {
  title: 'Паспорт дистанции',
  editions: 'Редакции',
  number: '№',
  date: 'Дата',
  label: 'Название',
  status: 'Статус',
  statusText: { draft: 'Черновик', active: 'Действующая', archived: 'Архивная' },
  open: 'Открыть',
  activate: 'Ввести в действие',
  confirmActivate:
    'Ввести редакцию в действие? Действующая редакция уйдёт в архив, перед этим будет создана резервная копия базы.',
  confirm: 'Подтвердить',
  cancel: 'Отмена',
  newDraft: 'Новый черновик',
  draftDate: 'Дата редакции',
  draftLabel: 'Название редакции',
  createDraft: 'Создать черновик',
  emptyEditions: 'Нет редакций паспорта. Создайте черновик, чтобы начать заполнение.',
  loading: 'Загрузка данных редакции…',
  emptySection: 'Нет данных',
  modeData: 'Данные',
  modeCompare: 'Сравнение редакций',
  compareWith: 'Сравнить с редакцией',
  compareEmpty: 'Выберите вторую редакцию для сравнения.',
  compareSame: 'Редакции совпадают.',
  added: 'Добавлено',
  removed: 'Удалено',
  changed: 'Изменено',
  field: 'Поле',
  before: 'Было',
  after: 'Стало',
  sectionTitles: {
    lines: 'Направления',
    segments: 'Характеристики участков',
    org: 'Оргструктура',
    stations: 'Станции',
    crossings: 'Переезды',
    territories: 'Территории',
    manual: 'Нормативы',
  },
} as const

export type PassportMode = 'data' | 'compare'

@Injectable()
export class PassportFacade {
  private readonly client = inject(PASSPORT_CLIENT)
  private revision = 0
  private mutating = false
  readonly editions = signal<readonly PassportEdition[]>([])
  readonly selected = signal<number | null>(null)
  readonly data = signal<EditionData | null>(null)
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)
  readonly confirming = signal<number | null>(null)
  readonly mode = signal<PassportMode>('data')
  readonly compareWith = signal<number | null>(null)
  readonly diff = signal<EditionDiff | null>(null)
  readonly sections = computed<readonly TableView[]>(() => {
    const data = this.data()
    return data ? editionDataView(data) : []
  })
  readonly compareCandidates = computed(() =>
    this.editions().filter((e) => e.id !== this.selected()),
  )
  readonly selectedEdition = computed(
    () => this.editions().find((e) => e.id === this.selected()) ?? null,
  )

  async load(): Promise<void> {
    if (this.mutating) return
    const revision = ++this.revision
    this.busy.set(true)
    this.error.set(null)
    try {
      const result = await this.client.list()
      if (revision !== this.revision) return
      if (!result.ok) {
        this.error.set(result.error.message)
        return
      }
      this.editions.set(result.value)
      const id =
        result.value.find((e) => e.id === this.selected())?.id ??
        result.value.find((e) => e.status === 'draft')?.id ??
        result.value.find((e) => e.status === 'active')?.id ??
        result.value.at(-1)?.id ??
        null
      if (id === null) {
        this.selected.set(null)
        this.data.set(null)
        this.diff.set(null)
      } else {
        await this.select(id)
      }
    } catch {
      if (revision === this.revision)
        this.error.set('Не удалось получить редакции паспорта. Повторите попытку.')
    } finally {
      if (revision === this.revision) this.busy.set(false)
    }
  }

  async select(id: number): Promise<void> {
    if (this.mutating || !this.editions().some((e) => e.id === id)) return
    const revision = ++this.revision
    this.selected.set(id)
    this.busy.set(true)
    this.error.set(null)
    this.data.set(null)
    this.diff.set(null)
    try {
      const result = await this.client.editionData(id)
      if (revision !== this.revision) return
      if (result.ok) {
        this.data.set(result.value)
        this.ensureComparator()
        if (this.mode() === 'compare') await this.compare()
      } else {
        this.error.set(result.error.message)
      }
    } catch {
      if (revision === this.revision)
        this.error.set('Не удалось получить данные редакции. Повторите попытку.')
    } finally {
      if (revision === this.revision) this.busy.set(false)
    }
  }

  async createDraft(date: string, label: string): Promise<void> {
    if (this.busy()) return
    this.mutating = true
    const revision = ++this.revision
    this.busy.set(true)
    this.error.set(null)
    try {
      const result = await this.client.createDraft({ date, label })
      if (revision !== this.revision) return
      if (!result.ok) {
        this.error.set(result.error.message)
        this.busy.set(false)
        return
      }
      this.mutating = false
      await this.load()
    } catch {
      if (revision === this.revision) {
        this.error.set('Не удалось создать черновик. Повторите попытку.')
        this.busy.set(false)
      }
    } finally {
      this.mutating = false
    }
  }

  requestActivate(id: number): void {
    if (this.busy()) return
    if (this.editions().find((e) => e.id === id)?.status === 'draft') this.confirming.set(id)
  }
  cancelActivate(): void {
    this.confirming.set(null)
  }
  async confirmActivate(): Promise<void> {
    if (this.busy()) return
    const id = this.confirming()
    if (id === null) return
    this.confirming.set(null)
    this.mutating = true
    const revision = ++this.revision
    this.busy.set(true)
    this.error.set(null)
    try {
      const result = await this.client.activate(id)
      if (revision !== this.revision) return
      if (!result.ok) {
        this.error.set(result.error.message)
        this.busy.set(false)
        return
      }
      this.mutating = false
      await this.load()
    } catch {
      if (revision === this.revision) {
        this.error.set('Не удалось ввести редакцию в действие. Повторите попытку.')
        this.busy.set(false)
      }
    } finally {
      this.mutating = false
    }
  }

  private ensureComparator(): void {
    this.compareWith.set(
      this.compareCandidates().find((e) => e.id === this.compareWith())?.id ??
        this.compareCandidates().at(0)?.id ??
        null,
    )
  }

  async setMode(mode: PassportMode): Promise<void> {
    if (this.mutating) return
    this.mode.set(mode)
    if (mode === 'compare') {
      this.ensureComparator()
      await this.compare()
    }
  }

  async selectCompare(id: number): Promise<void> {
    if (this.mutating || !this.compareCandidates().some((e) => e.id === id)) return
    this.compareWith.set(id)
    await this.compare()
  }

  /** Старшая по дате редакция — «после»; при равной дате старше больший номер. */
  private async compare(): Promise<void> {
    const id = this.selected()
    const other = this.compareWith()
    const current = this.data()
    if (id === null || other === null || other === id || current === null) return
    const revision = ++this.revision
    this.busy.set(true)
    this.error.set(null)
    this.diff.set(null)
    try {
      const result = await this.client.editionData(other)
      if (revision !== this.revision) return
      if (!result.ok) {
        this.error.set(result.error.message)
        return
      }
      const editions = new Map(this.editions().map((e) => [e.id, e]))
      const a = editions.get(id)
      const b = editions.get(other)
      const currentIsAfter =
        a !== undefined &&
        b !== undefined &&
        (a.date > b.date || (a.date === b.date && a.id > b.id))
      this.diff.set(
        currentIsAfter
          ? compareEditionData(result.value, current)
          : compareEditionData(current, result.value),
      )
    } catch {
      if (revision === this.revision)
        this.error.set('Не удалось получить данные для сравнения. Повторите попытку.')
    } finally {
      if (revision === this.revision) this.busy.set(false)
    }
  }
}
