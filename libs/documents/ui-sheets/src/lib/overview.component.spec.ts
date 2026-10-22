import { TestBed } from '@angular/core/testing'
import { err, ok } from '@eow/shared/kernel'
import {
  mm,
  type OverviewClient,
  type OverviewSource,
  type TextMeasurer,
} from '@eow/documents/application'
import { OverviewComponent } from './overview.component'
import { OVERVIEW_CLIENT, SHEET_MEASURER, OverviewFacade } from './overview.facade'

const editions = [1, 2].map((id) => ({ id, number: id, label: 'Учебная', date: '2027-01-01' }))
const source: OverviewSource = {
  edition: editions[0]!,
  lines: [
    {
      id: 'l',
      name: '<УЧЕБНОЕ>',
      extents: [{ from: { km: 0, m: 0 }, to: { km: 100, m: 0 } }],
      kmLengths: [],
    },
  ],
  axes: [],
  boundaries: [],
  warnings: ['Учебное замечание'],
}
const measurer: TextMeasurer = { width: (text, font) => mm(text.length * font.size.value * 0.5) }
const client = (): OverviewClient => ({
  editions: vi.fn<OverviewClient['editions']>(async () => ok(editions)),
  source: vi.fn<OverviewClient['source']>(async () => ok(source)),
})
function providers(port: OverviewClient) {
  return [
    { provide: OVERVIEW_CLIENT, useValue: port },
    { provide: SHEET_MEASURER, useValue: async () => measurer },
  ]
}
describe('Предпросмотр А3', () => {
  it('рисует безопасный SVG и меняет просмотр без изменения геометрии', async () => {
    const port = client()
    await TestBed.configureTestingModule({
      imports: [OverviewComponent],
      providers: providers(port),
    }).compileComponents()
    const fixture = TestBed.createComponent(OverviewComponent)
    await fixture.whenStable()
    fixture.detectChanges()
    const element = fixture.nativeElement as HTMLElement
    expect(element.textContent).toContain('<УЧЕБНОЕ>')
    expect(element.querySelector('учебное')).toBeNull()
    expect(element.textContent).toContain('Учебное замечание')
    const svg = element.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 420 297')
    const geometry = svg.innerHTML
    const slider = element.querySelector('input')!
    slider.value = '1'
    slider.dispatchEvent(new Event('input'))
    fixture.detectChanges()
    expect(svg.getAttribute('width')).toBe('420mm')
    expect(svg.innerHTML).toBe(geometry)
    const scale = element.querySelector<HTMLSelectElement>('#sheet-scale')!
    scale.value = '25000'
    scale.dispatchEvent(new Event('change'))
    fixture.detectChanges()
    expect(svg.innerHTML).not.toBe(geometry)
    expect(port.source).toHaveBeenCalledTimes(1)
  })
  it('управляет страницами и сбрасывает страницу при новом масштабе', async () => {
    TestBed.configureTestingModule({ providers: [OverviewFacade, ...providers(client())] })
    const facade = TestBed.inject(OverviewFacade)
    await facade.load()
    expect(facade.busy()).toBe(false)
    expect(facade.document()!.pages.length).toBeGreaterThan(1)
    facade.move(1)
    expect(facade.pageIndex()).toBe(1)
    facade.setScale(25000)
    expect(facade.pageIndex()).toBe(0)
  })
  it('не заменяет выбранную редакцию запоздавшим ответом', async () => {
    const port = client()
    TestBed.configureTestingModule({ providers: [OverviewFacade, ...providers(port)] })
    const facade = TestBed.inject(OverviewFacade)
    await facade.load()
    let finish!: (value: Awaited<ReturnType<OverviewClient['source']>>) => void
    vi.mocked(port.source).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = facade.select(1)
    await facade.select(2)
    const current = facade.document()
    finish(err({ message: 'Устаревшая ошибка' }))
    await pending
    expect(facade.selected()).toBe(2)
    expect(facade.document()).toBe(current)
    expect(facade.error()).toBeNull()
  })
  it('не строит геометрию до загрузки встроенных шрифтов', async () => {
    const port = client()
    TestBed.configureTestingModule({
      providers: [
        OverviewFacade,
        ...providers(port),
        {
          provide: SHEET_MEASURER,
          useValue: async () => {
            throw new Error('font unavailable')
          },
        },
      ],
    })
    const facade = TestBed.inject(OverviewFacade)
    await facade.load()
    expect(facade.document()).toBeNull()
    expect(facade.error()).toContain('шрифты')
    expect(facade.busy()).toBe(false)
  })
  it('очищает прежний лист при ошибке данных', async () => {
    const port = client()
    TestBed.configureTestingModule({ providers: [OverviewFacade, ...providers(port)] })
    const facade = TestBed.inject(OverviewFacade)
    await facade.load()
    vi.mocked(port.source).mockResolvedValue(err({ message: 'Нет доступа к редакции' }))
    await facade.select(1)
    expect(facade.document()).toBeNull()
    expect(facade.error()).toBe('Нет доступа к редакции')
  })
})
