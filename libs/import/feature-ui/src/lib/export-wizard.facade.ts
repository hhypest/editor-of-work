import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core'
import {
  type ExportWizardClient,
  type ExportWizardOutcome,
  type ExportWizardAction,
  type ExportGroup,
  type ExportProgress,
  type ExportReview,
  type ManualTemplateEdition,
} from '@eow/import/application'

/** Как часто спрашивать main о ходе операции, мс. */
const PROGRESS_INTERVAL = 400

/** «Чтение файлов: 3 из 17 — 90000103.xls» или название этапа без счётчика. */
export function progressText(progress: ExportProgress): string {
  const stage = EXPORT_TEXT.stages[progress.stage]
  if (!progress.total) return stage
  const file = progress.file ? ` — ${progress.file}` : ''
  return `${stage}: ${Math.min(progress.done + 1, progress.total)} из ${progress.total}${file}`
}

export const EXPORT_WIZARD_CLIENT = new InjectionToken<ExportWizardClient>(
  'Импорт выгрузок паспорта',
)
export const EXPORT_STEPS = [
  {
    id: 'org',
    title: '1. Оргструктура',
    description:
      'Четыре формы: подразделения, границы, станции → ПД и станционные пути → ПД. Отметьте действующие ПЧУ и ПД.',
  },
  {
    id: 'segments',
    title: '2. Характеристики пути',
    description:
      'Шесть форм: класс, грузонапряжённость, скорости, рельсы, шпалы и скрепления, балласт. Передайте все части каждой выбранной формы; остальные формы сохранятся.',
  },
  {
    id: 'stations',
    title: '3. Станции и переезды',
    description: 'Все семь форм: оси, экспликации путей и стрелок, три книги переездов и ОКАТО.',
  },
] as const
export const EXPORT_TEXT = {
  title: 'Импорт выгрузок ЕК АСУИ',
  intro:
    'Загрузите данные по шагам: сначала оргструктуру, затем характеристики и станции. Каждый пакет записывается отдельно только после проверки. Ошибка следующего шага не отменяет ранее принятые пакеты.',
  edition: 'Черновик редакции',
  empty: 'Создайте черновик в разделе «Паспорт».',
  immutable: 'Импорт доступен только в черновике.',
  retry: 'Обновить редакции',
  choose: 'Выбрать формы и все их части',
  units: 'Действующие подразделения на дату редакции',
  review: 'Проверить выбранные подразделения',
  choiceHint:
    'Предложения и пересечения — подсказки. Отметьте действующие ПЧУ и ПД самостоятельно. Остальные подразделения сохраняются по правилам импорта.',
  preview: 'Проверка перед записью',
  scope:
    'Импортированные данные пакета будут заменены целиком. Проверьте комплектность файлов и замечания.',
  expiry:
    'Сеанс подтверждения действует 10 минут после выбора файлов. При изменении паспорта подготовьте импорт заново.',
  before: 'Строк в заменяемом разделе до импорта',
  incoming: 'Строк подготовлено к записи',
  sourceRows: 'Прочитано строк',
  file: 'Файл',
  form: 'Форма',
  remarks: 'Замечания',
  noRemarks: 'Замечаний нет.',
  candidates: 'Кандидаты на исключение станций — только для проверки, автоматически не исключаются',
  apply: 'Подтвердить замену пакета',
  cancel: 'Отменить импорт',
  busy: 'Чтение и проверка выгрузок…',
  stop: 'Остановить',
  stopping: 'Остановка после текущего файла…',
  stopped: 'Импорт остановлен до записи. Ничего не сохранено, файлы можно выбрать заново.',
  stages: {
    reading: 'Чтение файлов',
    parsing: 'Разбор форм',
    checking: 'Сверка с паспортом и подготовка отчёта…',
    saving: 'Запись в базу паспорта…',
  },
  success: 'Пакет сохранён. Данные и отчёт записаны вместе. Можно перейти к следующему шагу.',
} as const

@Injectable()
export class ExportWizardFacade {
  private readonly client = inject(EXPORT_WIZARD_CLIENT)
  readonly editions = signal<readonly ManualTemplateEdition[]>([])
  readonly editionId = signal<number | null>(null)
  readonly group = signal<ExportGroup>('org')
  readonly busy = signal(false)
  /** Ход текущей операции main; null — ход ещё не пришёл. */
  readonly progress = signal<ExportProgress | null>(null)
  private stopRequested = false
  readonly error = signal<string | null>(null)
  readonly message = signal<string | null>(null)
  readonly choices = signal<Extract<ExportWizardOutcome, { status: 'choices' }> | null>(null)
  readonly selected = signal<readonly string[]>([])
  readonly review = signal<ExportReview | null>(null)
  readonly locked = computed(() => this.busy() || this.choices() !== null || this.review() !== null)
  readonly canEdit = computed(
    () => this.editions().find((e) => e.id === this.editionId())?.status === 'draft',
  )
  readonly step = computed(() => EXPORT_STEPS.find((s) => s.id === this.group()) ?? EXPORT_STEPS[0])

  async load(): Promise<void> {
    if (this.locked()) return
    this.busy.set(true)
    this.error.set(null)
    try {
      const result = await this.client.list()
      if (!result.ok) {
        this.error.set(result.error.message)
        return
      }
      this.editions.set(result.value)
      this.editionId.set(
        result.value.find((e) => e.id === this.editionId())?.id ??
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
  selectEdition(id: number): void {
    if (this.locked() || !this.editions().some((e) => e.id === id)) return
    this.editionId.set(id)
    this.error.set(null)
    this.message.set(null)
  }
  selectGroup(group: ExportGroup): void {
    if (this.locked()) return
    this.group.set(group)
    this.error.set(null)
    this.message.set(null)
  }
  toggle(code: string, checked: boolean): void {
    if (this.busy() || !this.choices()?.choices.some((c) => c.code === code)) return
    this.selected.update((codes) =>
      checked ? [...new Set([...codes, code])] : codes.filter((c) => c !== code),
    )
  }
  async run(action: 'choose' | 'review' | 'apply' | 'discard'): Promise<void> {
    const editionId = this.editionId()
    if (this.busy() || editionId === null || (action !== 'discard' && !this.canEdit())) return
    const token = this.review()?.token ?? this.choices()?.token
    if (action === 'choose' && this.locked()) return
    if (action !== 'choose' && !token) return
    if (action === 'apply' && !this.review()) return
    if (action === 'review' && !this.choices()) return
    const request: ExportWizardAction =
      action === 'choose'
        ? { action, editionId, group: this.group() }
        : action === 'review'
          ? { action, editionId, token: token ?? '', selected: this.selected() }
          : { action, editionId, token: token ?? '' }
    this.busy.set(true)
    this.error.set(null)
    this.message.set(null)
    this.progress.set(null)
    this.stopRequested = false
    const watching = action === 'choose' || action === 'apply'
    let running = true
    const poll = async (): Promise<void> => {
      while (running) {
        await new Promise((done) => setTimeout(done, PROGRESS_INTERVAL))
        if (!running) return
        const current = await this.client.progress().catch(() => null)
        if (running && current) this.progress.set(current)
      }
    }
    if (watching) void poll()
    try {
      const result = await this.client.run(request)
      if (result.status === 'error') {
        this.error.set(result.message)
        if (action === 'apply') this.clear()
      } else if (result.status === 'choices') {
        this.choices.set(result)
        this.selected.set([])
      } else if (result.status === 'preview') {
        this.choices.set(null)
        this.review.set(result.review)
      } else if (result.status === 'discarded') this.clear()
      else if (result.status === 'applied') {
        this.clear()
        this.message.set(EXPORT_TEXT.success)
      } else if (result.status === 'cancelled' && this.stopRequested)
        this.message.set(EXPORT_TEXT.stopped)
    } catch {
      this.clear()
      this.error.set('Операция прервана. Проверьте данные паспорта и выберите файлы заново.')
    } finally {
      running = false
      this.progress.set(null)
      this.busy.set(false)
    }
  }
  /** Остановка подготовки: main прерывает её перед следующим файлом; запись не останавливается. */
  async stop(): Promise<void> {
    if (!this.busy() || !this.progress()?.cancellable || this.progress()?.cancelling) return
    this.stopRequested = true
    const current = this.progress()
    if (current) this.progress.set({ ...current, cancelling: true })
    await this.client.cancel().catch(() => undefined)
  }
  private clear(): void {
    this.choices.set(null)
    this.review.set(null)
    this.selected.set([])
  }
}
