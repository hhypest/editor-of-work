import { TestBed } from '@angular/core/testing'
import { ok } from '@eow/shared/kernel'
import type { ExportWizardClient, ExportWizardOutcome, ExportReview } from '@eow/import/application'
import { ExportWizardComponent } from './export-wizard.component'
import {
  EXPORT_WIZARD_CLIENT,
  ExportWizardFacade,
  EXPORT_TEXT as text,
} from './export-wizard.facade'

const editions = [
  { id: 1, number: 1, date: '2026-01-01', label: 'Учебная', status: 'active' as const },
  { id: 2, number: 2, date: '2027-01-01', label: 'Следующая', status: 'draft' as const },
]
const token = '302cdd1e-4999-4d2a-9aa1-c384f11d81d2'
const review: ExportReview = {
  token,
  editionId: 2,
  group: 'org',
  files: [{ name: 'Учебная.xls', form: 'boundaries', rows: 7 }],
  previousRows: 3,
  incomingRows: 5,
  remarks: ['Учебная.xls: строка 8 — проверьте пересечение'],
  exclusionCandidates: [],
}
const choices: ExportWizardOutcome = {
  status: 'choices',
  token,
  editionId: 2,
  choices: [
    {
      code: 'ПД-1',
      type: 'ПД',
      parent: 'ПЧУ-1',
      validFrom: '2026-01-01',
      segments: 1,
      overlapsWith: ['ПД-11'],
      suggested: true,
      note: null,
    },
  ],
}
function client(): ExportWizardClient {
  return {
    list: vi.fn<ExportWizardClient['list']>(async () => ok(editions)),
    run: vi.fn<ExportWizardClient['run']>(async (r) =>
      r.action === 'choose'
        ? choices
        : r.action === 'review'
          ? { status: 'preview', review }
          : r.action === 'apply'
            ? { status: 'applied' }
            : { status: 'discarded' },
    ),
    progress: vi.fn<ExportWizardClient['progress']>(async () => null),
    cancel: vi.fn<ExportWizardClient['cancel']>(async () => undefined),
  }
}
async function setup(port = client()) {
  await TestBed.configureTestingModule({
    imports: [ExportWizardComponent],
    providers: [{ provide: EXPORT_WIZARD_CLIENT, useValue: port }],
  }).compileComponents()
  const fixture = TestBed.createComponent(ExportWizardComponent)
  await fixture.whenStable()
  fixture.detectChanges()
  return {
    fixture,
    port,
    facade: fixture.debugElement.injector.get(ExportWizardFacade),
    element: fixture.nativeElement as HTMLElement,
  }
}
const button = (element: HTMLElement, label: string): HTMLButtonElement =>
  [...element.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!

describe('Мастер выгрузок в интерфейсе', () => {
  it('показывает три шага и требует явного выбора действующих подразделений', async () => {
    const { facade, fixture, element, port } = await setup()
    expect(element.querySelector('nav')?.textContent).toContain('3. Станции и переезды')
    button(element, text.choose).click()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(element.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false)
    expect(element.textContent).toContain('ПД-11')
    expect(button(element, text.review).disabled).toBe(true)
    const checkbox = element.querySelector<HTMLInputElement>('input[type=checkbox]')!
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))
    fixture.detectChanges()
    button(element, text.review).click()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(port.run).toHaveBeenLastCalledWith({
      action: 'review',
      editionId: 2,
      token,
      selected: ['ПД-1'],
    })
    expect(element.textContent).toContain('Границы подразделений')
    expect(element.textContent).toContain('строка 8')
    expect(port.run).toHaveBeenCalledTimes(2)
    expect(facade.review()?.incomingRows).toBe(5)
    button(element, text.apply).click()
    await fixture.whenStable()
    expect(port.run).toHaveBeenLastCalledWith({ action: 'apply', editionId: 2, token })
    expect(facade.review()).toBeNull()
    expect(facade.message()).toBe(text.success)
  })
  it('во время предпросмотра блокирует смену редакции и шага; отмена не вызывает запись', async () => {
    const { facade, port } = await setup()
    await facade.run('choose')
    facade.selectEdition(1)
    facade.selectGroup('stations')
    expect(facade.editionId()).toBe(2)
    expect(facade.group()).toBe('org')
    await facade.run('discard')
    expect(port.run).toHaveBeenLastCalledWith({ action: 'discard', editionId: 2, token })
    expect(facade.locked()).toBe(false)
    await facade.run('apply')
    expect(port.run).toHaveBeenCalledTimes(2)
  })
  it('после ошибки выбора сохраняет отмеченные подразделения для исправления', async () => {
    const { facade, port } = await setup()
    await facade.run('choose')
    facade.toggle('ПД-1', true)
    vi.mocked(port.run).mockResolvedValueOnce({ status: 'error', message: 'Проверьте выбор' })
    await facade.run('review')
    expect(facade.choices()).not.toBeNull()
    expect(facade.selected()).toEqual(['ПД-1'])
    await facade.run('review')
    expect(facade.review()).toEqual(review)
  })
  it('кандидаты на исключение только показаны; станции не исключаются автоматически', async () => {
    const { facade, fixture, element, port } = await setup()
    facade.selectGroup('stations')
    vi.mocked(port.run).mockResolvedValueOnce({
      status: 'preview',
      review: { ...review, group: 'stations', exclusionCandidates: ['УЧЕБНАЯ'] },
    })
    await facade.run('choose')
    fixture.detectChanges()
    expect(element.textContent).toContain('автоматически не исключаются')
    expect(element.textContent).toContain('УЧЕБНАЯ')
    expect(port.run).toHaveBeenCalledTimes(1)
  })
  it('действующая редакция не позволяет выбрать файлы', async () => {
    const { facade, fixture, element, port } = await setup()
    facade.selectEdition(1)
    fixture.detectChanges()
    expect(button(element, text.choose).disabled).toBe(true)
    await facade.run('choose')
    expect(port.run).not.toHaveBeenCalled()
  })
  it('устаревший предпросмотр сбрасывается после отказа записи, повторная загрузка доступна', async () => {
    const { facade, port } = await setup()
    await facade.run('choose')
    facade.toggle('ПД-1', true)
    await facade.run('review')
    vi.mocked(port.run).mockResolvedValueOnce({ status: 'error', message: 'Паспорт изменился' })
    await facade.run('apply')
    expect(facade.error()).toBe('Паспорт изменился')
    expect(facade.locked()).toBe(false)
    await facade.run('choose')
    expect(facade.choices()).not.toBeNull()
  })
  it('ожидание IPC блокирует повтор и переключение; разрыв IPC снимает блокировку', async () => {
    const { facade, port } = await setup()
    let finish!: (r: ExportWizardOutcome) => void
    vi.mocked(port.run).mockReturnValueOnce(
      new Promise((complete) => {
        finish = complete
      }),
    )
    const pending = facade.run('choose')
    facade.selectEdition(1)
    facade.selectGroup('segments')
    await facade.run('choose')
    expect(facade.editionId()).toBe(2)
    expect(port.run).toHaveBeenCalledTimes(1)
    finish({ status: 'cancelled' })
    await pending
    vi.mocked(port.run).mockRejectedValueOnce(new Error('IPC'))
    await facade.run('choose')
    expect(facade.locked()).toBe(false)
    expect(facade.error()).toContain('выберите файлы заново')
  })
  it('во время чтения показывает ход по файлам, останавливается кнопкой и сообщает, что ничего не записано', async () => {
    const port = client()
    const { facade, fixture, element } = await setup(port)
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      let finish!: (value: ExportWizardOutcome) => void
      vi.mocked(port.run).mockImplementationOnce(
        () => new Promise<ExportWizardOutcome>((done) => (finish = done)),
      )
      vi.mocked(port.progress).mockResolvedValue({
        stage: 'parsing',
        done: 2,
        total: 17,
        file: '90000103.xls',
        cancellable: true,
        cancelling: false,
      })
      const running = facade.run('choose')
      fixture.detectChanges()
      expect(element.textContent).toContain(text.busy)
      await vi.advanceTimersByTimeAsync(450)
      fixture.detectChanges()
      expect(element.textContent).toContain('Разбор форм: 3 из 17 — 90000103.xls')
      button(element, text.stop).click()
      await vi.advanceTimersByTimeAsync(0)
      fixture.detectChanges()
      expect(port.cancel).toHaveBeenCalledOnce()
      expect(element.textContent).toContain(text.stopping)
      expect(button(element, text.stop).disabled).toBe(true)
      finish({ status: 'cancelled' })
      await running
      fixture.detectChanges()
      expect(facade.message()).toBe(text.stopped)
      expect(facade.progress()).toBeNull()
      // Опрос хода прекращается вместе с операцией.
      const polls = vi.mocked(port.progress).mock.calls.length
      await vi.advanceTimersByTimeAsync(2000)
      expect(port.progress).toHaveBeenCalledTimes(polls)
    } finally {
      vi.useRealTimers()
    }
  })
  it('запись нельзя остановить: кнопки нет, отмена диалога выбора файлов — без сообщения', async () => {
    const port = client()
    const { facade, fixture, element } = await setup(port)
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      let finish!: (value: ExportWizardOutcome) => void
      vi.mocked(port.run).mockImplementationOnce(
        () => new Promise<ExportWizardOutcome>((done) => (finish = done)),
      )
      vi.mocked(port.progress).mockResolvedValue({
        stage: 'saving',
        done: 0,
        total: 0,
        file: null,
        cancellable: false,
        cancelling: false,
      })
      const running = facade.run('choose')
      await vi.advanceTimersByTimeAsync(450)
      fixture.detectChanges()
      expect(element.textContent).toContain('Запись в базу паспорта…')
      expect(button(element, text.stop)).toBeUndefined()
      await facade.stop()
      expect(port.cancel).not.toHaveBeenCalled()
      finish({ status: 'cancelled' })
      await running
      expect(facade.message()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
