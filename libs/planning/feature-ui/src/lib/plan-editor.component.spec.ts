import { TestBed } from '@angular/core/testing'
import type { EditorReply, EditorState, PlanEditorClient } from '@eow/planning/application'
import { PlanEditorComponent } from './plan-editor.component'
import { PLAN_EDITOR_CLIENT, PlanEditorFacade } from './plan-editor.facade'
const state: EditorState = {
  revision: 1,
  dirty: false,
  hasFile: true,
  hasRecovery: false,
  autosaveError: null,
  view: {
    year: 2027,
    edition: { number: '1', date: '2027-01-01' },
    approval: { title: 'Учебная', name: 'Учебный составитель', year: 2026 },
    canUndo: true,
    canRedo: true,
    lines: [{ id: 'l', name: '<УЧЕБНОЕ>' }],
    stations: [{ id: 's', name: 'УЧЕБНАЯ', tracks: ['1'], switches: ['3'] }],
    kinds: [{ code: 'work', name: 'Учебная выправка', unit: 'км' }],
    areas: [
      { key: 'district', label: 'Дистанция' },
      { key: 'pd:a', label: 'ПД-1' },
    ],
    area: 'district',
    works: [],
    indicators: [],
    tables: [
      {
        title: 'Текущее содержание',
        rows: [
          {
            code: 'work',
            name: 'Учебная выправка',
            unit: 'км',
            computed: 1,
            value: 1,
            manual: false,
            need: null,
          },
        ],
      },
    ],
    importReport: [],
  },
}
const client = (): PlanEditorClient => ({
  send: vi.fn<PlanEditorClient['send']>(async () => ({ kind: 'state', state })),
})
async function setup(port = client()) {
  await TestBed.configureTestingModule({
    imports: [PlanEditorComponent],
    providers: [{ provide: PLAN_EDITOR_CLIENT, useValue: port }],
  }).compileComponents()
  const fixture = TestBed.createComponent(PlanEditorComponent)
  await fixture.whenStable()
  fixture.detectChanges()
  return {
    fixture,
    port,
    facade: TestBed.inject(PlanEditorFacade),
    element: fixture.nativeElement as HTMLElement,
  }
}
describe('Редактор плана', () => {
  it('показывает ошибку разбора прямо у поля, безопасный текст и не сохраняет ошибочную форму', async () => {
    const port = client()
    vi.mocked(port.send).mockImplementation(async (command) =>
      command.kind === 'checkPlace'
        ? {
            kind: 'place',
            revision: 1,
            hint: {
              normalized: null,
              meters: null,
              issues: [{ field: 'place', message: 'Пикет 11 вне 1–10', start: 0, end: 11 }],
            },
          }
        : command.kind === 'add'
          ? {
              kind: 'invalid',
              issues: [{ field: 'place', message: 'Пикет 11 вне 1–10', start: 0, end: 11 }],
            }
          : { kind: 'state', state },
    )
    const { fixture, element, facade } = await setup(port)
    expect(element.textContent).toContain('<УЧЕБНОЕ>')
    expect(element.querySelector('учебное')).toBeNull()
    const input = element.querySelector<HTMLTextAreaElement>('#work-place')!
    input.value = '20 км пк 11'
    input.dispatchEvent(new Event('input'))
    await fixture.whenStable()
    fixture.detectChanges()
    expect(element.querySelector('#place-errors')?.textContent).toContain('Пикет 11')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await facade.save()
    expect(vi.mocked(port.send).mock.calls.filter(([c]) => c.kind === 'save')).toHaveLength(0)
    expect(facade.form().text).toBe('20 км пк 11')
  })
  it('игнорирует запоздавшую подсказку и сохраняет незавершённый ввод при переходе между разделами', async () => {
    const { fixture, facade, port } = await setup()
    let finish!: (reply: EditorReply) => void
    vi.mocked(port.send).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    facade.patch({ text: '20 км пк 11' })
    vi.mocked(port.send).mockResolvedValueOnce({
      kind: 'place',
      revision: 1,
      hint: { normalized: '20 км пк 10', meters: 64, issues: [] },
    })
    facade.patch({ text: '20 км пк 10' })
    await Promise.resolve()
    await Promise.resolve()
    finish({
      kind: 'place',
      revision: 1,
      hint: {
        normalized: null,
        meters: null,
        issues: [{ field: 'place', message: 'Устаревшая ошибка', start: 0, end: 11 }],
      },
    })
    await fixture.whenStable()
    expect(facade.hint()?.normalized).toBe('20 км пк 10')
    fixture.destroy()
    const returned = TestBed.createComponent(PlanEditorComponent)
    await returned.whenStable()
    returned.detectChanges()
    expect(returned.nativeElement.querySelector('#work-place').value).toBe('20 км пк 10')
  })
  it('Ctrl+S применяет форму и таблицы перед сохранением; Ctrl+Z в поле остаётся нативным', async () => {
    const { fixture, facade, port, element } = await setup()
    facade.patch({ volume: '0', note: 'Учебная правка' })
    facade.patchCell('work', 'need', '10')
    const event = new KeyboardEvent('keydown', {
      code: 'KeyS',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    element.querySelector('input')!.dispatchEvent(event)
    await fixture.whenStable()
    expect(event.defaultPrevented).toBe(true)
    expect(vi.mocked(port.send).mock.calls.map(([c]) => c.kind)).toEqual([
      'state',
      'add',
      'manualRows',
      'save',
    ])
    const native = new KeyboardEvent('keydown', {
      code: 'KeyZ',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    element.querySelector('input')!.dispatchEvent(native)
    expect(native.defaultPrevented).toBe(false)
    const undo = new KeyboardEvent('keydown', {
      code: 'KeyZ',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(undo)
    await fixture.whenStable()
    expect(vi.mocked(port.send).mock.lastCall?.[0]).toEqual({ kind: 'undo' })
  })
  it('при отмене открытия сохраняет ввод, а перед закрытием требует подтверждения', async () => {
    const { facade, port } = await setup()
    facade.patch({ note: 'Не потерять' })
    await facade.requestOpen({ kind: 'open' })
    expect(facade.pendingOpen()).toEqual({ kind: 'open' })
    expect(port.send).toHaveBeenCalledTimes(1)
    vi.mocked(port.send).mockResolvedValueOnce({ kind: 'cancelled' })
    await facade.discardAndOpen()
    expect(facade.form().note).toBe('Не потерять')
    const close = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(close)
    expect(close.defaultPrevented).toBe(true)
  })
  it('не скрывает введённые табличные значения при ошибке сервера', async () => {
    const { facade, port } = await setup()
    facade.patchCell('work', 'plan', 'не число')
    vi.mocked(port.send).mockResolvedValueOnce({
      kind: 'invalid',
      issues: [{ field: 'form', message: 'Учебная ошибка числа', start: null, end: null }],
    })
    expect(await facade.save()).toBe(false)
    expect(facade.cell('work').plan).toBe('не число')
    expect(vi.mocked(port.send).mock.calls.filter(([c]) => c.kind === 'save')).toHaveLength(0)
  })
  it('сохраняет черновик показателей при ошибке, блокирует переход и применяет пакет перед Ctrl+S', async () => {
    const { facade, port, fixture, element } = await setup()
    facade.addIndicator()
    fixture.detectChanges()
    const name = element.querySelector<HTMLInputElement>(
      '[aria-label="Наименование показателя 1"]',
    )!
    name.value = '<Учебный показатель>'
    name.dispatchEvent(new Event('input'))
    await fixture.whenStable()
    facade.patchIndicator(0, { value: 'ошибка', note: 'Не потерять' })
    await facade.filter('pd:a')
    expect(facade.area()).toBe('district')
    expect(port.send).toHaveBeenCalledTimes(1)
    const close = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(close)
    expect(close.defaultPrevented).toBe(true)
    vi.mocked(port.send).mockResolvedValueOnce({
      kind: 'invalid',
      issues: [{ field: 'form', message: 'Показатель 1: введите число.', start: null, end: null }],
    })
    expect(await facade.save()).toBe(false)
    expect(facade.indicatorRows()[0]).toMatchObject({
      name: '<Учебный показатель>',
      value: 'ошибка',
      note: 'Не потерять',
    })
    expect(vi.mocked(port.send).mock.calls.some(([c]) => c.kind === 'save')).toBe(false)
    facade.patchIndicator(0, { value: '0', unit: 'шт.' })
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyS',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await fixture.whenStable()
    expect(
      vi
        .mocked(port.send)
        .mock.calls.slice(-2)
        .map(([c]) => c),
    ).toEqual([
      {
        kind: 'indicatorRows',
        rows: [
          { id: null, name: '<Учебный показатель>', value: '0', unit: 'шт.', note: 'Не потерять' },
        ],
      },
      { kind: 'save', saveAs: false },
    ])
    expect(facade.pending()).toBe(false)
    facade.addIndicator()
    facade.removeIndicator(0)
    expect(facade.indicatorRows()).toEqual([])
    expect(facade.pending()).toBe(true)
    facade.cancelIndicators()
    expect(facade.pending()).toBe(false)
  })
  it('требует отдельного подтверждения отказа от найденной автокопии', async () => {
    const port = client()
    vi.mocked(port.send).mockResolvedValue({
      kind: 'state',
      state: { ...state, hasRecovery: true },
    })
    const { fixture, facade, element } = await setup(port)
    const refusal = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Отказаться от автокопии'),
    )!
    refusal.click()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(port.send).toHaveBeenCalledTimes(1)
    expect(element.textContent).toContain('Удалить автокопию?')
    expect(facade.pendingOpen()).toEqual({ kind: 'recover', accept: false })
    const input = element.querySelector('#work-place')!
    expect(input.closest('fieldset')?.disabled).toBe(true)
    const indicator = [...element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Добавить показатель',
    )!
    expect(indicator.closest('fieldset')?.disabled).toBe(true)
    facade.addIndicator()
    expect(facade.indicatorDraft()).toBeNull()
  })
  it('загружает редакции, проверяет год и требует выбора перед заменой незавершённого ввода', async () => {
    const { facade, port, fixture, element } = await setup()
    facade.patch({ note: 'Не потерять при создании' })
    vi.mocked(port.send).mockResolvedValueOnce({
      kind: 'editions',
      editions: [{ id: 7, number: 7, date: '2027-01-01', label: '<Учебная>', status: 'active' }],
    })
    await facade.loadEditions()
    fixture.detectChanges()
    expect(element.textContent).toContain('<Учебная>')
    expect(element.querySelector('учебная')).toBeNull()
    expect(facade.newEdition()).toBe(7)
    facade.newYear.set('2027,5')
    await facade.create()
    expect(facade.error()).toContain('год плана')
    expect(port.send).toHaveBeenCalledTimes(2)
    facade.newYear.set('2028')
    await facade.create()
    expect(facade.pendingOpen()).toEqual({ kind: 'create', editionId: 7, year: 2028 })
    expect(port.send).toHaveBeenCalledTimes(2)
    facade.pendingOpen.set(null)
    expect(facade.form().note).toBe('Не потерять при создании')
    await facade.create()
    vi.mocked(port.send).mockRejectedValueOnce(new Error('Нет видов работ'))
    await facade.discardAndOpen()
    expect(facade.form().note).toBe('Не потерять при создании')
    expect(facade.error()).toBe('Нет видов работ')
    await facade.create()
    vi.mocked(port.send).mockResolvedValueOnce({
      kind: 'state',
      state: {
        ...state,
        dirty: true,
        hasFile: false,
        revision: 2,
        view: { ...state.view!, year: 2028, canUndo: false },
      },
    })
    await facade.discardAndOpen()
    expect(facade.formDirty()).toBe(false)
    expect(facade.state()?.view?.year).toBe(2028)
  })
  it('отмена сохранения перед созданием оставляет текущий план и выбранное действие', async () => {
    const { facade, port } = await setup()
    facade.state.set({ ...state, dirty: true })
    facade.newEdition.set(7)
    facade.editionsLoaded.set(true)
    facade.editions.set([
      { id: 7, number: 7, date: '2027-01-01', label: 'Учебная', status: 'active' },
    ])
    facade.newYear.set('2028')
    await facade.create()
    vi.mocked(port.send).mockResolvedValueOnce({ kind: 'cancelled' })
    await facade.saveAndOpen()
    expect(facade.pendingOpen()?.kind).toBe('create')
    expect(facade.view()?.year).toBe(2027)
    expect(vi.mocked(port.send).mock.calls.filter(([c]) => c.kind === 'create')).toHaveLength(0)
  })
  it('ошибка повторной загрузки редакций отключает создание и сохраняет ввод', async () => {
    const { facade, port, fixture, element } = await setup()
    vi.mocked(port.send).mockResolvedValueOnce({ kind: 'editions', editions: [] })
    await facade.loadEditions()
    fixture.detectChanges()
    expect(element.textContent).toContain('Нет введённых в действие редакций')
    facade.newYear.set('2028')
    vi.mocked(port.send).mockRejectedValueOnce(new Error('Нет доступа к паспорту'))
    await facade.loadEditions()
    fixture.detectChanges()
    expect(facade.newYear()).toBe('2028')
    expect(element.querySelector<HTMLButtonElement>('#create-plan')?.disabled).toBe(true)
  })
})
