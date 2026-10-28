import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core'
import type {
  EditorAction,
  EditorDraft,
  EditorDatedDraft,
  EditorExpectedDraft,
  EditorIndicatorDraft,
  EditorItemDraft,
  EditorItemTable,
  EditorIssue,
  EditorState,
  PlaceHint,
  PlanEditorClient,
  PlanEditionChoice,
} from '@eow/planning/application'
import type { PlanPdScaleChange } from '@eow/planning/sheet-api'
export const PLAN_EDITOR_CLIENT = new InjectionToken<PlanEditorClient>('Редактор годового плана')
const emptyDraft = (): EditorDraft => ({
  kind: '',
  mode: 'line',
  line: '',
  text: '',
  station: '',
  objectKind: 'none',
  objectNumber: '',
  volume: '',
  note: '',
  callout: true,
})
interface CellDraft {
  readonly plan: string
  readonly need: string
}
@Injectable({ providedIn: 'root' })
export class PlanEditorFacade {
  private readonly client = inject(PLAN_EDITOR_CLIENT)
  private hintGeneration = 0
  readonly state = signal<EditorState | null>(null)
  readonly view = computed(() => this.state()?.view ?? null)
  readonly busy = signal(false)
  readonly planEpoch = signal(0)
  readonly error = signal<string | null>(null)
  readonly notice = signal<string | null>(null)
  readonly issues = signal<readonly EditorIssue[]>([])
  readonly area = signal('district')
  readonly form = signal<EditorDraft>(emptyDraft())
  readonly selected = signal<string | null>(null)
  readonly formDirty = signal(false)
  readonly hint = signal<PlaceHint | null>(null)
  readonly cells = signal<Readonly<Record<string, CellDraft>>>({})
  readonly indicatorDraft = signal<readonly EditorIndicatorDraft[] | null>(null)
  readonly pdTablesDraft = signal<readonly string[] | null>(null)
  readonly expectedDraft = signal<readonly EditorExpectedDraft[] | null>(null)
  /** Черновик таблицы «Показатели» на 01.01; null — нет незавершённого ввода. */
  readonly datedDraft = signal<readonly EditorDatedDraft[] | null>(null)
  /** Черновики перечней подрядных работ, ИССО и ЗП; null — нет незавершённого ввода. */
  readonly itemDrafts = signal<
    Readonly<Record<EditorItemTable, readonly EditorItemDraft[] | null>>
  >({ contract: null, isso: null, zp: null })
  readonly expectedRows = computed<readonly EditorExpectedDraft[]>(
    () =>
      this.expectedDraft() ??
      this.view()?.expected?.map((row) => ({
        ...row,
        value: row.value === null ? '' : String(row.value).replace('.', ','),
      })) ??
      [],
  )
  readonly datedRows = computed<readonly EditorDatedDraft[]>(
    () =>
      this.datedDraft() ??
      this.view()?.dated?.map((row) => ({
        id: row.id,
        name: row.name,
        previous: row.previous === null ? '' : String(row.previous).replace('.', ','),
        current: row.current === null ? '' : String(row.current).replace('.', ','),
      })) ??
      [],
  )
  readonly indicatorRows = computed<readonly EditorIndicatorDraft[]>(
    () =>
      this.indicatorDraft() ??
      this.view()?.indicators.map((row) => ({
        ...row,
        value: String(row.value).replace('.', ','),
      })) ??
      [],
  )
  readonly approval = signal({ title: '', name: '', year: 0 })
  readonly approvalDirty = signal(false)
  readonly pendingOpen = signal<EditorAction | null>(null)
  readonly editions = signal<readonly PlanEditionChoice[]>([])
  readonly editionsLoaded = signal(false)
  readonly newEdition = signal<number | null>(null)
  readonly newYear = signal('')
  readonly hasCells = computed(() => Object.keys(this.cells()).length > 0)
  readonly pending = computed(
    () =>
      this.formDirty() ||
      this.hasCells() ||
      this.approvalDirty() ||
      this.indicatorDraft() !== null ||
      this.expectedDraft() !== null ||
      this.datedDraft() !== null ||
      Object.values(this.itemDrafts()).some((rows) => rows !== null) ||
      this.pdTablesDraft() !== null,
  )
  readonly placeIssues = computed(() => [
    ...this.issues().filter((e) => e.field === 'place'),
    ...(this.hint()?.issues ?? []),
  ])
  readonly volumeIssues = computed(() => this.issues().filter((e) => e.field === 'volume'))
  readonly objects = computed(() => {
    const station = this.view()?.stations.find((s) => s.id === this.form().station)
    return this.form().objectKind === 'track'
      ? (station?.tracks ?? [])
      : this.form().objectKind === 'switch'
        ? (station?.switches ?? [])
        : []
  })
  constructor() {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (this.pending() || this.state()?.dirty || this.busy()) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', beforeUnload))
  }
  async initialize(): Promise<void> {
    if (!this.state() && (await this.run({ kind: 'state' }))) this.resetAll()
    // Список редакций мог устареть, пока открыт другой раздел: например, после восстановления
    // копии базы паспорта номер редакции указывает уже на другую. Без свежего списка план
    // из редакции не создаётся (create требует editionsLoaded).
    if (this.editionsLoaded()) {
      this.editionsLoaded.set(false)
      // Отложенное создание выбрано по прежнему списку: после возврата его нужно подтвердить
      // заново, иначе saveAndOpen/discardAndOpen создали бы план из устаревшего номера.
      if (this.pendingOpen()?.kind === 'create') this.pendingOpen.set(null)
      await this.loadEditions()
    }
  }
  async loadEditions(): Promise<void> {
    if (this.busy()) return
    this.busy.set(true)
    this.error.set(null)
    try {
      const reply = await this.client.send(
        { kind: 'editions' },
        this.state()?.revision ?? 0,
        'district',
      )
      if (reply.kind !== 'editions') throw new Error('Не удалось получить редакции паспорта.')
      this.editions.set(reply.editions)
      this.editionsLoaded.set(true)
      const selected = this.newEdition()
      this.newEdition.set(
        reply.editions.find((e) => e.id === selected)?.id ??
          reply.editions.find((e) => e.status === 'active')?.id ??
          reply.editions[0]?.id ??
          null,
      )
    } catch (error) {
      this.editionsLoaded.set(false)
      this.error.set(
        error instanceof Error ? error.message : 'Не удалось получить редакции паспорта.',
      )
    } finally {
      this.busy.set(false)
    }
  }
  async create(): Promise<void> {
    const editionId = this.newEdition()
    const text = this.newYear().trim()
    const year = Number(text)
    if (
      !this.editionsLoaded() ||
      !this.editions().some((e) => e.id === editionId) ||
      editionId === null ||
      !/^\d{4}$/u.test(text) ||
      year < 2000 ||
      year > 2100
    ) {
      this.error.set('Выберите редакцию и укажите год плана от 2000 до 2100.')
      return
    }
    await this.requestOpen({ kind: 'create', editionId, year })
  }
  private async run(action: EditorAction, area = this.area()): Promise<boolean> {
    if (this.busy()) return false
    ++this.hintGeneration
    this.busy.set(true)
    this.error.set(null)
    this.notice.set(null)
    this.issues.set([])
    this.hint.set(null)
    try {
      const reply = await this.client.send(action, this.state()?.revision ?? 0, area)
      if (reply.kind === 'invalid') {
        this.issues.set(reply.issues)
        return false
      }
      if (reply.kind !== 'state') return false
      this.state.set(reply.state)
      this.area.set(reply.state.view?.area ?? 'district')
      if (!this.approvalDirty() && reply.state.view)
        this.approval.set({ ...reply.state.view.approval })
      return true
    } catch (error) {
      this.error.set(
        error instanceof Error
          ? error.message
          : 'Не удалось выполнить действие с планом. Повторите попытку.',
      )
      return false
    } finally {
      this.busy.set(false)
    }
  }
  resetForm(id: string | null = null): void {
    const draft = this.view()?.works.find((w) => w.id === id)?.draft
    this.selected.set(draft ? id : null)
    this.form.set(
      draft
        ? { ...draft }
        : {
            ...emptyDraft(),
            kind: this.view()?.kinds[0]?.code ?? '',
            line: this.view()?.lines[0]?.id ?? '',
          },
    )
    this.formDirty.set(false)
    this.issues.set([])
    this.hint.set(null)
    ++this.hintGeneration
  }
  private resetAll(): void {
    this.pdTablesDraft.set(null)
    this.indicatorDraft.set(null)
    this.expectedDraft.set(null)
    this.datedDraft.set(null)
    this.itemDrafts.set({ contract: null, isso: null, zp: null })
    this.resetForm()
    this.cells.set({})
    this.approvalDirty.set(false)
    const approval = this.view()?.approval
    if (approval) this.approval.set({ ...approval })
  }
  patch(patch: Partial<EditorDraft>): void {
    this.form.update((d) => ({ ...d, ...patch }))
    this.formDirty.set(true)
    this.issues.set([])
    if ('text' in patch || 'line' in patch || 'mode' in patch) void this.checkPlace()
  }
  private async checkPlace(): Promise<void> {
    const generation = ++this.hintGeneration,
      draft = this.form(),
      revision = this.state()?.revision ?? 0
    this.hint.set(null)
    if (draft.mode !== 'line' || !draft.text.trim()) return
    try {
      const reply = await this.client.send(
        { kind: 'checkPlace', line: draft.line, text: draft.text },
        revision,
        this.area(),
      )
      if (generation !== this.hintGeneration || revision !== this.state()?.revision) return
      if (reply.kind === 'place' && reply.revision === revision) this.hint.set(reply.hint)
    } catch {
      if (generation === this.hintGeneration)
        this.hint.set({
          normalized: null,
          meters: null,
          issues: [
            {
              field: 'place',
              message: 'Не удалось проверить место. При применении оно будет проверено повторно.',
              start: null,
              end: null,
            },
          ],
        })
    }
  }
  async apply(): Promise<boolean> {
    const id = this.selected(),
      draft = this.form()
    if (!(await this.run(id ? { kind: 'edit', id, draft } : { kind: 'add', draft }))) return false
    this.resetForm(id)
    this.notice.set('Работа применена к плану.')
    return true
  }
  async remove(id: string): Promise<void> {
    if (this.pending()) {
      this.error.set('Сначала примените или отмените введённые изменения.')
      return
    }
    if (await this.run({ kind: 'remove', id })) this.resetForm()
  }
  edit(id: string): void {
    if (!this.formDirty() && !this.busy()) this.resetForm(id)
  }
  async filter(area: string): Promise<void> {
    if (this.pending()) {
      this.error.set('Сначала примените или отмените введённые изменения.')
      return
    }
    if (await this.run({ kind: 'state' }, area)) this.resetForm()
  }
  async refresh(): Promise<void> {
    if (this.pending()) {
      this.error.set('Сначала примените или отмените введённые изменения.')
      return
    }
    if (await this.run({ kind: 'state' }, 'district')) this.resetAll()
  }
  async history(kind: 'undo' | 'redo'): Promise<void> {
    if (this.pending()) {
      this.error.set('Сначала примените или отмените введённые изменения.')
      return
    }
    if (await this.run({ kind })) this.resetAll()
  }
  async savePdScale(change: PlanPdScaleChange): Promise<boolean> {
    if (this.busy() || this.state()?.hasRecovery) return false
    if (this.pending()) {
      this.error.set('Сначала примените или отмените введённые изменения.')
      return false
    }
    if (
      change.revision !== this.state()?.revision ||
      change.area !== this.view()?.area ||
      !change.area.startsWith('pd:')
    ) {
      this.error.set('Лист изменился. Обновите предпросмотр и повторите настройку масштаба.')
      return false
    }
    const applied = await this.run({ kind: 'pdScale', scale: change.scale })
    if (applied) this.notice.set('Масштаб ПД применён к плану. Сохраните файл для записи на диск.')
    return applied
  }
  cell(code: string): CellDraft {
    const staged = this.cells()[code]
    if (staged) return staged
    const row = this.view()
      ?.tables.flatMap((t) => t.rows)
      .find((r) => r.code === code)
    return {
      plan: row?.manual ? String(row.value).replace('.', ',') : '',
      need: row?.need === null || row?.need === undefined ? '' : String(row.need).replace('.', ','),
    }
  }
  patchCell(code: string, field: 'plan' | 'need', value: string): void {
    this.cells.update((cells) => ({ ...cells, [code]: { ...this.cell(code), [field]: value } }))
  }
  async applyCells(): Promise<boolean> {
    if (!this.hasCells()) return true
    if (
      !(await this.run({
        kind: 'manualRows',
        rows: Object.entries(this.cells()).map(([code, c]) => ({ code, ...c })),
      }))
    )
      return false
    this.cells.set({})
    return true
  }
  patchApproval(patch: Partial<{ title: string; name: string; year: number }>): void {
    this.approval.update((a) => ({ ...a, ...patch }))
    this.approvalDirty.set(true)
  }
  async applyApproval(): Promise<boolean> {
    if (!this.approvalDirty()) return true
    if (!(await this.run({ kind: 'approval', ...this.approval() }))) return false
    this.approvalDirty.set(false)
    return true
  }
  cancelTables(): void {
    this.cells.set({})
  }
  addIndicator(): void {
    if (this.busy() || this.state()?.hasRecovery || this.indicatorRows().length >= 10000) return
    this.indicatorDraft.set([
      ...this.indicatorRows(),
      { id: null, name: '', unit: '', value: '', note: '' },
    ])
  }
  patchIndicator(index: number, patch: Partial<EditorIndicatorDraft>): void {
    if (this.busy() || this.state()?.hasRecovery) return
    const rows = this.indicatorRows(),
      row = rows[index]
    if (row) this.indicatorDraft.set(rows.with(index, { ...row, ...patch }))
  }
  removeIndicator(index: number): void {
    if (this.busy() || this.state()?.hasRecovery) return
    this.indicatorDraft.set(this.indicatorRows().filter((_row, i) => i !== index))
  }
  cancelIndicators(): void {
    this.indicatorDraft.set(null)
  }
  async applyIndicators(): Promise<boolean> {
    const rows = this.indicatorDraft()
    if (rows === null) return true
    if (!(await this.run({ kind: 'indicatorRows', rows }))) return false
    this.indicatorDraft.set(null)
    return true
  }
  itemRows(table: EditorItemTable): readonly EditorItemDraft[] {
    return (
      this.itemDrafts()[table] ??
      this.view()
        ?.items?.find((t) => t.table === table)
        ?.rows.map((row) => ({
          ...row,
          quantity: String(row.quantity).replace('.', ','),
          cost: String(row.cost).replace('.', ','),
        })) ??
      []
    )
  }
  private setItems(table: EditorItemTable, rows: readonly EditorItemDraft[] | null): void {
    this.itemDrafts.set({ ...this.itemDrafts(), [table]: rows })
  }
  addItem(table: EditorItemTable): void {
    if (
      this.busy() ||
      this.state()?.hasRecovery ||
      !this.view()?.items ||
      this.itemRows(table).length >= 10000
    )
      return
    this.setItems(table, [
      ...this.itemRows(table),
      { id: null, name: '', unit: '', quantity: '0', cost: '0' },
    ])
  }
  patchItem(table: EditorItemTable, index: number, patch: Partial<EditorItemDraft>): void {
    if (this.busy() || this.state()?.hasRecovery) return
    const rows = this.itemRows(table),
      row = rows[index]
    if (row) this.setItems(table, rows.with(index, { ...row, ...patch }))
  }
  removeItem(table: EditorItemTable, index: number): void {
    if (this.busy() || this.state()?.hasRecovery) return
    this.setItems(
      table,
      this.itemRows(table).filter((_row, i) => i !== index),
    )
  }
  cancelItems(table: EditorItemTable): void {
    this.setItems(table, null)
  }
  async applyItems(table: EditorItemTable): Promise<boolean> {
    const rows = this.itemDrafts()[table]
    if (rows === null) return true
    if (!(await this.run({ kind: 'itemRows', table, rows }))) return false
    this.setItems(table, null)
    return true
  }
  addDated(): void {
    if (
      this.busy() ||
      this.state()?.hasRecovery ||
      !this.view()?.dated ||
      this.datedRows().length >= 10000
    )
      return
    this.datedDraft.set([...this.datedRows(), { id: null, name: '', previous: '', current: '' }])
  }
  patchDated(index: number, patch: Partial<EditorDatedDraft>): void {
    if (this.busy() || this.state()?.hasRecovery) return
    const rows = this.datedRows(),
      row = rows[index]
    if (row) this.datedDraft.set(rows.with(index, { ...row, ...patch }))
  }
  moveDated(index: number, step: -1 | 1): void {
    if (this.busy() || this.state()?.hasRecovery) return
    const rows = this.datedRows(),
      row = rows[index],
      other = rows[index + step]
    if (row && other) this.datedDraft.set(rows.with(index, other).with(index + step, row))
  }
  removeDated(index: number): void {
    if (this.busy() || this.state()?.hasRecovery) return
    this.datedDraft.set(this.datedRows().filter((_row, i) => i !== index))
  }
  cancelDated(): void {
    this.datedDraft.set(null)
  }
  async applyDated(): Promise<boolean> {
    const rows = this.datedDraft()
    if (rows === null) return true
    if (!(await this.run({ kind: 'datedRows', rows }))) return false
    this.datedDraft.set(null)
    return true
  }
  addExpected(): void {
    if (
      this.busy() ||
      this.state()?.hasRecovery ||
      !this.view()?.expected ||
      this.expectedRows().length >= 10000
    )
      return
    // Новая строка продолжает группу предыдущей: так вводятся составляющие «в т.ч.».
    const last = this.expectedRows().at(-1)
    this.expectedDraft.set([
      ...this.expectedRows(),
      { id: null, group: last?.group ?? '', name: '', unit: last?.unit ?? '', value: '' },
    ])
  }
  patchExpected(index: number, patch: Partial<EditorExpectedDraft>): void {
    if (this.busy() || this.state()?.hasRecovery) return
    const rows = this.expectedRows(),
      row = rows[index]
    if (row) this.expectedDraft.set(rows.with(index, { ...row, ...patch }))
  }
  moveExpected(index: number, step: -1 | 1): void {
    if (this.busy() || this.state()?.hasRecovery) return
    const rows = this.expectedRows(),
      row = rows[index],
      other = rows[index + step]
    if (row && other) this.expectedDraft.set(rows.with(index, other).with(index + step, row))
  }
  removeExpected(index: number): void {
    if (this.busy() || this.state()?.hasRecovery) return
    this.expectedDraft.set(this.expectedRows().filter((_row, i) => i !== index))
  }
  cancelExpected(): void {
    this.expectedDraft.set(null)
  }
  async applyExpected(): Promise<boolean> {
    const rows = this.expectedDraft()
    if (rows === null) return true
    if (!(await this.run({ kind: 'expectedRows', rows }))) return false
    this.expectedDraft.set(null)
    return true
  }
  pdTableVisible(key: string): boolean {
    const draft = this.pdTablesDraft()
    return draft === null
      ? (this.view()?.pdTables.find((row) => row.key === key)?.visible ?? false)
      : !draft.includes(key)
  }
  patchPdTable(key: string, visible: boolean): void {
    if (
      this.busy() ||
      this.state()?.hasRecovery ||
      !this.view()?.pdTables.some((row) => row.key === key)
    )
      return
    const hidden =
      this.pdTablesDraft() ??
      this.view()
        ?.pdTables.filter((row) => !row.visible)
        .map((row) => row.key) ??
      []
    this.pdTablesDraft.set(
      visible
        ? hidden.filter((entry) => entry !== key)
        : [...hidden.filter((entry) => entry !== key), key],
    )
  }
  cancelPdTables(): void {
    this.pdTablesDraft.set(null)
  }
  async applyPdTables(): Promise<boolean> {
    const hidden = this.pdTablesDraft()
    if (hidden === null) return true
    if (!(await this.run({ kind: 'pdTables', hidden }))) return false
    this.pdTablesDraft.set(null)
    return true
  }
  cancelApproval(): void {
    this.approvalDirty.set(false)
    const approval = this.view()?.approval
    if (approval) this.approval.set({ ...approval })
  }
  async save(saveAs = false): Promise<boolean> {
    if (this.busy()) return false
    if (this.formDirty() && !(await this.apply())) return false
    if (
      !(await this.applyCells()) ||
      !(await this.applyIndicators()) ||
      !(await this.applyDated()) ||
      !(await this.applyExpected()) ||
      !(await this.applyItems('contract')) ||
      !(await this.applyItems('isso')) ||
      !(await this.applyItems('zp')) ||
      !(await this.applyPdTables()) ||
      !(await this.applyApproval())
    )
      return false
    const saved = await this.run({ kind: 'save', saveAs })
    if (saved) this.notice.set('План сохранён.')
    return saved
  }
  async requestOpen(action: EditorAction): Promise<void> {
    if (this.busy()) return
    if ((action.kind === 'recover' && !action.accept) || this.pending() || this.state()?.dirty) {
      this.pendingOpen.set(action)
      return
    }
    await this.open(action)
  }
  private async open(action: EditorAction): Promise<void> {
    if (await this.run(action, 'district')) {
      this.resetAll()
      this.planEpoch.update((value) => value + 1)
    }
    this.pendingOpen.set(null)
  }
  async discardAndOpen(): Promise<void> {
    const action = this.pendingOpen()
    if (action) await this.open(action)
  }
  async saveAndOpen(): Promise<void> {
    const action = this.pendingOpen()
    if (action && (await this.save())) await this.open(action)
  }
}
