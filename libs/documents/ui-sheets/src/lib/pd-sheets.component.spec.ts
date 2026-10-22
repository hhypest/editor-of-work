import { TestBed } from '@angular/core/testing'
import { err, ok } from '@eow/shared/kernel'
import { mm, type PdSheetClient, type TextMeasurer } from '@eow/documents/application'
import type { PlanSheetData } from '@eow/planning/sheet-api'
import { PD_SHEET_CLIENT, PdSheetsFacade } from './pd-sheets.facade'
import { SHEET_MEASURER } from './overview.facade'
import { PdSheetsComponent } from './pd-sheets.component'
const source: PlanSheetData = {
  year: 2027,
  edition: { number: '1', date: '2027-01-01' },
  approval: { title: '', name: '', year: 2026 },
  lines: [],
  pds: [
    { id: 'a', name: '<ПД-1>', pchu: 'Учебный', segments: [], works: [], tables: [] },
    { id: 'b', name: 'ПД-2', pchu: 'Учебный', segments: [], works: [], tables: [] },
  ],
}
const measurer: TextMeasurer = { width: (text, font) => mm(text.length * font.size.value * 0.5) }
const client = (): PdSheetClient => ({ load: vi.fn<PdSheetClient['load']>(async () => ok(source)) })
const providers = (port: PdSheetClient) => [
  { provide: PD_SHEET_CLIENT, useValue: port },
  { provide: SHEET_MEASURER, useValue: async () => measurer },
]
describe('Предпросмотр ПД', () => {
  it('выбирает ПД и открывает план только для просмотра, рисуя безопасный текст', async () => {
    const port = client()
    await TestBed.configureTestingModule({
      imports: [PdSheetsComponent],
      providers: providers(port),
    }).compileComponents()
    const fixture = TestBed.createComponent(PdSheetsComponent)
    await fixture.whenStable()
    fixture.detectChanges()
    const element = fixture.nativeElement as HTMLElement
    expect(element.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 420 297')
    expect(element.textContent).toContain('<ПД-1>')
    expect(element.querySelector('пд-1')).toBeNull()
    const select = element.querySelector<HTMLSelectElement>('#pd-select')!
    select.value = 'b'
    select.dispatchEvent(new Event('change'))
    fixture.detectChanges()
    expect(element.querySelector('svg')?.textContent).toContain('ПД-2')
    element.querySelector('button')!.click()
    await fixture.whenStable()
    expect(port.load).toHaveBeenLastCalledWith(true)
  })
  it('сохраняет выбранный лист при отмене и сообщает об ошибке', async () => {
    const port = client()
    TestBed.configureTestingModule({ providers: [PdSheetsFacade, ...providers(port)] })
    const facade = TestBed.inject(PdSheetsFacade)
    await facade.load(false)
    facade.select('b')
    const document = facade.document()
    vi.mocked(port.load).mockResolvedValueOnce(ok('cancelled'))
    await facade.load(true)
    expect(facade.document()).toBe(document)
    expect(facade.selected()).toBe('b')
    vi.mocked(port.load).mockResolvedValueOnce(err({ message: 'Учебная ошибка' }))
    await facade.load(true)
    expect(facade.document()).toBeNull()
    expect(facade.error()).toBe('Учебная ошибка')
  })
  it('не заменяет новый план запоздавшим ответом', async () => {
    const port = client()
    TestBed.configureTestingModule({ providers: [PdSheetsFacade, ...providers(port)] })
    const facade = TestBed.inject(PdSheetsFacade)
    let finish!: (r: Awaited<ReturnType<PdSheetClient['load']>>) => void
    vi.mocked(port.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = facade.load(true)
    await facade.load(false)
    finish(ok(null))
    await pending
    expect(facade.source()?.year).toBe(2027)
    expect(facade.busy()).toBe(false)
  })
})
