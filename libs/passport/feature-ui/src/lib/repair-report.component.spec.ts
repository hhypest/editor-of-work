import { TestBed } from '@angular/core/testing'
import { err, ok } from '@eow/shared/kernel'
import type { RepairReport } from '@eow/passport/application'
import { RepairReportComponent } from './repair-report.component'
import {
  REPAIR_REPORT_CLIENT,
  REPAIR_TEXT,
  RepairReportFacade,
  type RepairReportClient,
} from './repair-report.facade'

const editions = [
  { id: 1, number: 1, date: '2027-01-01', label: 'Учебная', status: 'active' },
  { id: 2, number: 2, date: '2028-01-01', label: 'Следующая', status: 'draft' },
] as const
const report: RepairReport = {
  date: '2027-01-01',
  rows: [
    {
      location: {
        kind: 'line',
        lineId: 'line',
        lineName: '<Учебное направление>',
        from: { km: 700, m: 0 },
        to: { km: 701, m: 0 },
        lengthM: 1250,
      },
      lastRepairYear: 2000,
      tonnageAfter: 120,
      assessments: [
        {
          workCode: 'repair',
          workName: 'Учебный ремонт',
          normId: 'norm',
          status: 'due',
          dueYear: 2027,
          yearIsUpperBound: true,
          overdueYears: 0,
          overdueMillionTons: 20,
          reason: null,
        },
      ],
    },
  ],
}
function client(): RepairReportClient {
  return {
    list: vi.fn<RepairReportClient['list']>(async () => ok(editions)),
    report: vi.fn<RepairReportClient['report']>(async () => ok(report)),
  }
}
describe('Отчёт о ремонтах в паспорте', () => {
  it('показывает расчёт, верхнюю границу года и безопасный текст места', async () => {
    const port = client()
    await TestBed.configureTestingModule({
      imports: [RepairReportComponent],
      providers: [{ provide: REPAIR_REPORT_CLIENT, useValue: port }],
    }).compileComponents()
    const fixture = TestBed.createComponent(RepairReportComponent)
    await fixture.whenStable()
    fixture.detectChanges()
    const element = fixture.nativeElement as HTMLElement
    expect(element.textContent).toContain(REPAIR_TEXT.title)
    expect(element.textContent).toContain('<Учебное направление>')
    expect(element.querySelector('учебное')).toBeNull()
    expect(element.textContent).toContain('1250 м')
    expect(element.textContent).toContain(REPAIR_TEXT.due)
    expect(element.querySelector('tbody')?.textContent).toMatch(/Не позднее\s+2027/)
    const select = element.querySelector('select')!
    select.value = '2'
    select.dispatchEvent(new Event('change'))
    await fixture.whenStable()
    expect(port.report).toHaveBeenLastCalledWith(2)
    element.querySelector('button')!.click()
    await fixture.whenStable()
    expect(port.list).toHaveBeenCalledTimes(2)
  })
  it('показывает пустую базу и ошибку, не выдавая их за отсутствие потребности', async () => {
    const port = client()
    vi.mocked(port.list).mockResolvedValue(ok([]))
    await TestBed.configureTestingModule({
      imports: [RepairReportComponent],
      providers: [{ provide: REPAIR_REPORT_CLIENT, useValue: port }],
    }).compileComponents()
    const fixture = TestBed.createComponent(RepairReportComponent)
    await fixture.whenStable()
    fixture.detectChanges()
    expect(fixture.nativeElement.textContent).toContain(REPAIR_TEXT.emptyEditions)
    vi.mocked(port.list).mockResolvedValue(
      err({ kind: 'storage', message: 'Учебная ошибка доступа' }),
    )
    fixture.nativeElement.querySelector('button').click()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Учебная ошибка доступа',
    )
  })
  it('не заменяет отчёт выбранной редакции запоздавшим ответом', async () => {
    const port = client()
    TestBed.configureTestingModule({
      providers: [RepairReportFacade, { provide: REPAIR_REPORT_CLIENT, useValue: port }],
    })
    const facade = TestBed.inject(RepairReportFacade)
    await facade.load()
    let finish: ((value: Awaited<ReturnType<RepairReportClient['report']>>) => void) | undefined
    vi.mocked(port.report).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const slow = facade.select(1)
    await facade.select(2)
    finish!(ok({ date: '2020-01-01', rows: [] }))
    await slow
    expect(facade.selected()).toBe(2)
    expect(facade.report()?.date).toBe('2027-01-01')
    expect(facade.busy()).toBe(false)
  })
})
