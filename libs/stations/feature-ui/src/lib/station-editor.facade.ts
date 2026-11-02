import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core'
import {
  applyEdit,
  canRedoEdit,
  canUndoEdit,
  layoutDrawing,
  openEditor,
  type EditorAction,
  type EditorState,
  type StationEdition,
  type StationEntry,
  type StationLayoutClient,
} from '@eow/stations/application'
import type { Result } from '@eow/shared/kernel'

export interface StationEditorClient extends StationLayoutClient {
  editions(): Promise<Result<readonly StationEdition[], { readonly message: string }>>
}
export const STATION_EDITOR_CLIENT = new InjectionToken<StationEditorClient>('Редактор станций')

export const STATION_TEXT = {
  title: 'Схемы станций',
  intro:
    'Раскладка путевого развития из PDF схем станций (шаг «Схемы станций» мастера импорта). Узлы перетаскиваются мышью или стрелками клавиатуры с привязкой к сетке; стрелка сдвигается только вдоль своего пути. Править можно черновик редакции.',
  edition: 'Редакция паспорта',
  station: 'Станция',
  noLayout: 'нет схемы',
  emptyEditions: 'Нет редакций паспорта. Сначала создайте и заполните редакцию.',
  emptyStations: 'В редакции нет станций.',
  emptyLayout:
    'У станции нет раскладки. Загрузите PDF схемы на шаге «Схемы станций» мастера импорта.',
  readOnly: 'Редакция введена в действие или в архиве: схему можно только смотреть.',
  undo: 'Отменить',
  redo: 'Повторить',
  save: 'Сохранить схему',
  saving: 'Сохранение…',
  saved: 'Схема сохранена.',
  unsaved: 'Есть несохранённые правки.',
  discard: 'Есть несохранённые правки схемы. Перейти без сохранения?',
  loading: 'Загрузка…',
  tracks: 'Пути и съезды',
  switches: 'Стрелки',
  number: 'Номер',
  kind: 'Вид',
  state: 'Состояние',
  length: 'Длина по схеме, м',
  capacity: 'Вместимость, ваг.',
  track: 'Лежит на пути',
  branch: 'Ветвь',
  kinds: { main: 'главный', station: 'станционный', connector: 'съезд', siding: 'без номера' },
  states: { normal: 'действует', closed: 'закрыт для движения', conserved: 'консервация' },
} as const

@Injectable()
export class StationEditorFacade {
  private readonly client = inject(STATION_EDITOR_CLIENT)
  private revision = 0
  readonly editions = signal<readonly StationEdition[]>([])
  readonly edition = signal<number | null>(null)
  readonly stations = signal<readonly StationEntry[]>([])
  readonly station = signal<string | null>(null)
  readonly editor = signal<EditorState | null>(null)
  readonly editable = signal(false)
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)
  readonly notice = signal<string | null>(null)
  private version = ''

  readonly layout = computed(() => this.editor()?.history.present ?? null)
  readonly drawing = computed(() => {
    const layout = this.layout()
    return layout ? layoutDrawing(layout) : null
  })
  readonly editError = computed(() => this.editor()?.error ?? null)
  readonly canUndo = computed(() => {
    const e = this.editor()
    return !!e && canUndoEdit(e)
  })
  readonly canRedo = computed(() => {
    const e = this.editor()
    return !!e && canRedoEdit(e)
  })
  readonly dirty = computed(() => {
    const layout = this.layout()
    return layout !== null && layout !== this.savedLayout()
  })
  private readonly savedLayout = signal<EditorState['history']['present'] | null>(null)
  readonly trackNames = computed(
    () =>
      new Map(
        (this.layout()?.tracks ?? []).map((t) => [t.id, t.number ?? STATION_TEXT.kinds[t.kind]]),
      ),
  )

  async load(): Promise<void> {
    const revision = ++this.revision
    await this.run(revision, async () => {
      const editions = await this.client.editions()
      if (!editions.ok) return this.error.set(editions.error.message)
      this.editions.set(editions.value)
      const id =
        editions.value.find((e) => e.id === this.edition())?.id ??
        editions.value.find((e) => e.status === 'draft')?.id ??
        editions.value.find((e) => e.status === 'active')?.id ??
        editions.value.at(-1)?.id ??
        null
      this.edition.set(id)
      if (id !== null) await this.loadStations(revision, id)
    })
  }

  async selectEdition(id: number): Promise<void> {
    const revision = ++this.revision
    this.edition.set(id)
    await this.run(revision, () => this.loadStations(revision, id))
  }

  async selectStation(id: string): Promise<void> {
    const revision = ++this.revision
    const edition = this.edition()
    if (edition === null) return
    await this.run(revision, () => this.loadLayout(revision, edition, id))
  }

  edit(action: EditorAction): void {
    const state = this.editor()
    if (!state || !this.editable()) return
    this.notice.set(null)
    this.editor.set(applyEdit(state, action))
  }

  async save(): Promise<void> {
    const edition = this.edition(),
      station = this.station(),
      layout = this.layout()
    if (edition === null || station === null || !layout || !this.editable()) return
    const revision = ++this.revision
    await this.run(revision, async () => {
      const result = await this.client.save(edition, station, layout, this.version)
      if (!result.ok) return this.error.set(result.error.message)
      this.version = result.value.version
      this.savedLayout.set(layout)
      this.notice.set(STATION_TEXT.saved)
    })
  }

  private async loadStations(revision: number, edition: number): Promise<void> {
    this.editor.set(null)
    this.savedLayout.set(null)
    const stations = await this.client.stations(edition)
    if (revision !== this.revision) return
    if (!stations.ok) return this.error.set(stations.error.message)
    this.stations.set(stations.value)
    const id =
      stations.value.find((s) => s.id === this.station())?.id ??
      stations.value.find((s) => s.hasLayout)?.id ??
      stations.value[0]?.id ??
      null
    this.station.set(id)
    if (id !== null) await this.loadLayout(revision, edition, id)
  }

  private async loadLayout(revision: number, edition: number, station: string): Promise<void> {
    this.station.set(station)
    this.editor.set(null)
    this.savedLayout.set(null)
    const loaded = await this.client.load(edition, station)
    if (revision !== this.revision) return
    if (!loaded.ok) return this.error.set(loaded.error.message)
    if (!loaded.value) return
    this.version = loaded.value.version
    this.editable.set(loaded.value.editable)
    this.savedLayout.set(loaded.value.layout)
    this.editor.set(openEditor(loaded.value.layout))
  }

  private async run(revision: number, task: () => Promise<void>): Promise<void> {
    this.busy.set(true)
    this.error.set(null)
    this.notice.set(null)
    try {
      await task()
    } catch {
      if (revision === this.revision)
        this.error.set('Не удалось выполнить запрос. Повторите попытку.')
    } finally {
      if (revision === this.revision) this.busy.set(false)
    }
  }
}
