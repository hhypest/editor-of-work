import { TestBed } from '@angular/core/testing'
import type { EditionData, PassportEdition } from '@eow/passport/application'
import type { SegmentRow } from '@eow/passport/import-api'
import { err, ok } from '@eow/shared/kernel'
import { PassportComponent } from './passport.component'
import {
  PASSPORT_CLIENT,
  PASSPORT_TEXT,
  PassportFacade,
  type PassportClient,
} from './passport.facade'

const editions: readonly PassportEdition[] = [
  { id: 1, number: 1, date: '2027-01-01', label: 'Учебная', status: 'active' },
  { id: 2, number: 2, date: '2028-01-01', label: 'Следующая', status: 'draft' },
]

const classRow = (trackClass: string | null): SegmentRow => ({
  id: '["class","f","s",1]',
  importFileId: 'f1',
  validFrom: null,
  validTo: '9999-12-31',
  form: 'class',
  lineId: 'line-1',
  from: { km: 1, m: 0 },
  to: { km: 10, m: 0 },
  statedLength: null,
  values: { trackClass, group: null, category: null },
})

function editionData(id: number, trackClass: string | null): EditionData {
  return {
    edition: editions.find((e) => e.id === id) ?? editions[0],
    lines: [{ id: 'line-1', name: 'УЧЕБНОЕ', extents: [], kmLengths: [] }],
    segments: [classRow(trackClass)],
    stations: [],
    manual: { workKinds: [], repairNorms: [], tolerances: [], trainPairs: [], kilometres: [] },
    org: { subdivisions: [], boundaries: [], stations: [], tracks: [] },
  }
}

function client(): PassportClient {
  return {
    list: vi.fn<PassportClient['list']>(async () => ok(editions)),
    createDraft: vi.fn<PassportClient['createDraft']>(async () => ok(null)),
    activate: vi.fn<PassportClient['activate']>(async () => ok(null)),
    editionData: vi.fn<PassportClient['editionData']>(async (id) =>
      ok(editionData(id, id === 1 ? '3' : '4')),
    ),
    backups: vi.fn<PassportClient['backups']>(async () => ok([])),
    restoreBackup: vi.fn<PassportClient['restoreBackup']>(async () => ok(null)),
  }
}

async function setup(port: PassportClient) {
  await TestBed.configureTestingModule({
    imports: [PassportComponent],
    providers: [{ provide: PASSPORT_CLIENT, useValue: port }],
  }).compileComponents()
  const fixture = TestBed.createComponent(PassportComponent)
  await fixture.whenStable()
  fixture.detectChanges()
  return fixture
}

describe('Интерфейс паспорта', () => {
  it('показывает редакции и данные выбранной редакции', async () => {
    const port = client()
    const fixture = await setup(port)
    const element = fixture.nativeElement as HTMLElement
    expect(element.textContent).toContain(PASSPORT_TEXT.title)
    expect(element.textContent).toContain('Учебная')
    expect(element.textContent).toContain('Черновик')
    // Открывается черновик: правка и сравнение идут по нему.
    expect(port.editionData).toHaveBeenLastCalledWith(2)
    expect(element.textContent).toContain('УЧЕБНОЕ')
    expect(element.textContent).toContain('Класс пути')
  })

  it('создаёт черновик по дате и названию', async () => {
    const port = client()
    const fixture = await setup(port)
    const element = fixture.nativeElement as HTMLElement
    const date = element.querySelector<HTMLInputElement>('#draft-date')
    const label = element.querySelector<HTMLInputElement>('#draft-label')
    date!.value = '2029-01-01'
    date!.dispatchEvent(new Event('input'))
    label!.value = 'Новая учебная редакция'
    label!.dispatchEvent(new Event('input'))
    fixture.detectChanges()
    const buttons = [...element.querySelectorAll('button')]
    buttons.find((b) => b.textContent?.includes(PASSPORT_TEXT.createDraft))!.click()
    await fixture.whenStable()
    expect(port.createDraft).toHaveBeenCalledWith({
      date: '2029-01-01',
      label: 'Новая учебная редакция',
    })
    expect(port.list).toHaveBeenCalledTimes(2)
  })

  it('вводит черновик в действие только после подтверждения', async () => {
    const port = client()
    const fixture = await setup(port)
    const element = fixture.nativeElement as HTMLElement
    const activate = [...element.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(PASSPORT_TEXT.activate),
    )!
    activate.click()
    fixture.detectChanges()
    expect(port.activate).not.toHaveBeenCalled()
    expect(element.textContent).toContain('резервная копия')
    const confirm = [...element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === PASSPORT_TEXT.confirm,
    )!
    confirm.click()
    await fixture.whenStable()
    expect(port.activate).toHaveBeenCalledWith(2)
  })

  it('сравнивает редакции и показывает изменённое с русскими подписями полей', async () => {
    const port = client()
    const fixture = await setup(port)
    const element = fixture.nativeElement as HTMLElement
    const tabs = [...element.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    tabs.find((t) => t.textContent?.includes(PASSPORT_TEXT.modeCompare))!.click()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(element.textContent).toContain('Характеристики участков')
    const body = element.querySelector('.changed')
    expect(body?.textContent).toContain('Класс пути')
    expect(body?.textContent).toContain('3')
    expect(body?.textContent).toContain('4')
  })

  it('показывает ошибку загрузки, не выдавая её за пустую базу', async () => {
    const port = client()
    vi.mocked(port.list).mockResolvedValue(
      err({ kind: 'storage', message: 'Учебная ошибка доступа' }),
    )
    const fixture = await setup(port)
    const element = fixture.nativeElement as HTMLElement
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Учебная ошибка доступа')
    expect(element.textContent).not.toContain(PASSPORT_TEXT.emptyEditions)
  })
})

describe('выбор редакций при сравнении и записи', () => {
  it('после открытия второй редакции выбирает другую для сравнения', async () => {
    const port = client()
    const fixture = await setup(port)
    const facade = fixture.debugElement.injector.get(PassportFacade)
    await facade.setMode('compare')
    expect(facade.compareWith()).toBe(1)
    await facade.select(1)
    expect(facade.compareWith()).toBe(2)
    expect(port.editionData).toHaveBeenLastCalledWith(2)
    expect(facade.diff()?.sections.some((s) => s.changed.length)).toBe(true)
    expect(facade.busy()).toBe(false)
  })

  it.each(['create', 'activate'] as const)(
    'ожидающая запись %s блокирует переключение и обновляет список после успеха',
    async (operation) => {
      const port = client()
      let finish!: (value: Awaited<ReturnType<PassportClient['activate']>>) => void
      const pending = new Promise<Awaited<ReturnType<PassportClient['activate']>>>((resolve) => {
        finish = resolve
      })
      if (operation === 'create') vi.mocked(port.createDraft).mockReturnValue(pending)
      else vi.mocked(port.activate).mockReturnValue(pending)
      const fixture = await setup(port)
      const facade = fixture.debugElement.injector.get(PassportFacade)
      await facade.setMode('compare')
      facade.requestActivate(2)
      const saving =
        operation === 'create'
          ? facade.createDraft('2029-01-01', 'Учебный черновик')
          : facade.confirmActivate()
      fixture.detectChanges()
      const element = fixture.nativeElement as HTMLElement
      const open = [...element.querySelectorAll('button')].filter(
        (b) => b.textContent?.trim() === PASSPORT_TEXT.open,
      )
      expect(open.every((b) => b.disabled)).toBe(true)
      expect(element.querySelector<HTMLSelectElement>('#compare-edition')?.disabled).toBe(true)
      expect(
        [...element.querySelectorAll<HTMLButtonElement>('[role="tab"]')].every((b) => b.disabled),
      ).toBe(true)
      await facade.select(1)
      await facade.selectCompare(2)
      await facade.setMode('data')
      await facade.load()
      expect(facade.selected()).toBe(2)
      expect(facade.mode()).toBe('compare')
      expect(port.list).toHaveBeenCalledTimes(1)
      finish(ok(null))
      await saving
      expect(port.list).toHaveBeenCalledTimes(2)
      expect(facade.busy()).toBe(false)
    },
  )
})
