import { TestBed } from '@angular/core/testing'
import { ok } from '@eow/shared/kernel'
import type { ManualTemplateClient, ManualTemplateOutcome } from '@eow/import/application'
import { ManualTemplateComponent } from './manual-template.component'
import {
  MANUAL_TEMPLATE_CLIENT,
  MANUAL_TEMPLATE_TEXT as text,
  ManualTemplateFacade,
} from './manual-template.facade'

const editions = [
  { id: 1, number: 1, date: '2027-01-01', label: 'Учебная', status: 'active' as const },
  { id: 2, number: 2, date: '2028-01-01', label: 'Новая учебная', status: 'draft' as const },
]
const review = {
  token: '68adc4d0-265b-4f28-a1e3-b5c2c2d6f145',
  editionId: 2,
  fileName: 'Учебная.xlsx',
  changes: [{ sheet: 'Виды работ', added: 1, changed: 2, removed: 3 }],
}
const client = (): ManualTemplateClient => ({
  list: vi.fn<ManualTemplateClient['list']>(async () => ok(editions)),
  run: vi.fn<ManualTemplateClient['run']>(async (request) =>
    request.action === 'prepare'
      ? { status: 'preview', review }
      : request.action === 'export'
        ? { status: 'exported' }
        : request.action === 'apply'
          ? { status: 'applied' }
          : { status: 'discarded' },
  ),
})
async function setup(port = client()) {
  await TestBed.configureTestingModule({
    imports: [ManualTemplateComponent],
    providers: [{ provide: MANUAL_TEMPLATE_CLIENT, useValue: port }],
  }).compileComponents()
  const fixture = TestBed.createComponent(ManualTemplateComponent)
  await fixture.whenStable()
  fixture.detectChanges()
  return {
    fixture,
    port,
    facade: fixture.debugElement.injector.get(ManualTemplateFacade),
    element: fixture.nativeElement as HTMLElement,
  }
}
function button(element: HTMLElement, label: string): HTMLButtonElement {
  return [...element.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!
}

describe('Ручные данные: выдача, предпросмотр и подтверждение', () => {
  it('передаёт выдачу шаблона и выбирает черновик по умолчанию', async () => {
    const { facade, port } = await setup()
    expect(facade.selected()).toBe(2)
    await facade.run('export')
    expect(port.run).toHaveBeenCalledWith({ action: 'export', editionId: 2 })
    expect(facade.message()).toBe(text.exported)
  })
  it('показывает итоги и отправляет запись только по подтверждению', async () => {
    const { fixture, facade, port, element } = await setup()
    button(element, text.prepare).click()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(element.textContent).toContain('Учебная.xlsx')
    expect(element.querySelector('tbody')?.textContent).toContain('Виды работ')
    expect(port.run).toHaveBeenCalledTimes(1)
    expect(element.querySelector<HTMLSelectElement>('#manual-edition')?.disabled).toBe(true)
    facade.select(1)
    expect(facade.selected()).toBe(2)
    button(element, text.confirm).click()
    await fixture.whenStable()
    expect(port.run).toHaveBeenLastCalledWith({
      action: 'apply',
      editionId: 2,
      token: review.token,
    })
    expect(facade.review()).toBeNull()
    expect(facade.message()).toBe(text.applied)
  })
  it('отмена очищает предпросмотр без запроса записи', async () => {
    const { facade, port } = await setup()
    await facade.run('prepare')
    await facade.run('discard')
    expect(port.run).toHaveBeenLastCalledWith({
      action: 'discard',
      editionId: 2,
      token: review.token,
    })
    expect(facade.review()).toBeNull()
    await facade.run('apply')
    expect(port.run).toHaveBeenCalledTimes(2)
  })
  it('действующая редакция допускает выдачу, загрузка заблокирована', async () => {
    const { fixture, facade, port, element } = await setup()
    facade.select(1)
    fixture.detectChanges()
    expect(button(element, text.prepare).disabled).toBe(true)
    expect(element.textContent).toContain(text.immutable)
    await facade.run('prepare')
    expect(port.run).not.toHaveBeenCalled()
  })
  it('сохраняет выбранную редакцию при ожидающем IPC и не отправляет повторные действия', async () => {
    const { facade, port } = await setup()
    let finish!: (value: ManualTemplateOutcome) => void
    vi.mocked(port.run).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const pending = facade.run('prepare')
    facade.select(1)
    await facade.run('export')
    expect(facade.selected()).toBe(2)
    expect(port.run).toHaveBeenCalledTimes(1)
    finish({ status: 'cancelled' })
    await pending
    expect(facade.review()).toBeNull()
    expect(facade.busy()).toBe(false)
  })
  it('ошибка записи сбрасывает токен, повторная загрузка возможна', async () => {
    const { facade, port } = await setup()
    await facade.run('prepare')
    vi.mocked(port.run).mockResolvedValueOnce({ status: 'error', message: 'Книга устарела' })
    await facade.run('apply')
    expect(facade.error()).toBe('Книга устарела')
    expect(facade.review()).toBeNull()
    await facade.run('prepare')
    expect(facade.review()).toEqual(review)
  })
  it('разрыв IPC не оставляет экран заблокированным', async () => {
    const { facade, port } = await setup()
    vi.mocked(port.run).mockRejectedValueOnce(new Error('Сбой'))
    await facade.run('prepare')
    expect(facade.busy()).toBe(false)
    expect(facade.error()).toContain('загрузите книгу заново')
  })
})
