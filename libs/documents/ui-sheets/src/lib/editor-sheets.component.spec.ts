import { TestBed } from '@angular/core/testing'
import { err, ok } from '@eow/shared/kernel'
import { mm, type EditorSheetClient, type TextMeasurer } from '@eow/documents/application'
import type { PlanPreviewContext, PlanSheetData } from '@eow/planning/sheet-api'
import { EDITOR_SHEET_CLIENT, EditorSheetsFacade } from './editor-sheets.facade'
import { EditorSheetsComponent } from './editor-sheets.component'
import { SHEET_MEASURER } from './overview.facade'

const context: PlanPreviewContext = {
  revision: 1,
  area: 'pd:a',
  hasPlan: true,
  hasRecovery: false,
  busy: false,
  pending: false,
}
const source: PlanSheetData = {
  year: 2027,
  edition: { number: '1', date: '2027-01-01' },
  approval: { title: '', name: '', year: 2026 },
  lines: [],
  pds: ['a', 'b'].map((id) => ({
    id,
    name: `Учебный ПД ${id}`,
    pchu: 'Учебный',
    segments: [],
    works: [],
    tables: [],
  })),
}
const measurer: TextMeasurer = { width: (text, font) => mm(text.length * font.size.value * 0.5) }
const client = (): EditorSheetClient => ({
  source: vi.fn<EditorSheetClient['source']>(async () => ok(source)),
})
const providers = (port: EditorSheetClient, prepare = async () => measurer) => [
  { provide: EDITOR_SHEET_CLIENT, useValue: port },
  { provide: SHEET_MEASURER, useValue: prepare },
]
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function facade(port = client(), prepare = async () => measurer) {
  TestBed.configureTestingModule({ providers: [EditorSheetsFacade, ...providers(port, prepare)] })
  return { facade: TestBed.inject(EditorSheetsFacade), port }
}
const longSource: PlanSheetData = {
  ...source,
  pds: source.pds.map((pd) => ({
    ...pd,
    tables: [
      {
        title: 'Учебная ведомость',
        columns: [{ title: 'Работа', width: 390 }],
        rows: Array.from({ length: 80 }, (_, i) => [`Учебная работа ${i}`]),
      },
    ],
  })),
}

describe('Лист в редакторе плана', () => {
  it('показывает SVG и незавершённый ввод, не перезагружая ту же ревизию', async () => {
    const port = client()
    await TestBed.configureTestingModule({
      imports: [EditorSheetsComponent],
      providers: providers(port),
    }).compileComponents()
    const fixture = TestBed.createComponent(EditorSheetsComponent)
    fixture.componentRef.setInput('context', context)
    await fixture.whenStable()
    fixture.detectChanges()
    const element = fixture.nativeElement as HTMLElement
    expect(element.querySelector('svg')?.textContent).toContain('Учебный ПД a')
    fixture.componentRef.setInput('context', { ...context, pending: true })
    await fixture.whenStable()
    expect(element.textContent).toContain('Есть незавершённый ввод')
    expect(port.source).toHaveBeenCalledTimes(1)
    fixture.componentRef.setInput('context', { ...context, area: 'station:s' })
    await fixture.whenStable()
    expect(element.querySelector('svg')).toBeNull()
    expect(element.textContent).toContain('выберите ПД')
  })
  it.each(['load', 'fonts'] as const)(
    'ответ прежнего ПД во время ожидания %s не заменяет новый лист',
    async (phase) => {
      const old = deferred<Awaited<ReturnType<EditorSheetClient['source']>>>()
      const fonts = deferred<TextMeasurer>()
      const port = client()
      if (phase === 'load') vi.mocked(port.source).mockImplementationOnce(() => old.promise)
      const prepare = vi.fn<() => Promise<TextMeasurer>>(async () => measurer)
      if (phase === 'fonts') prepare.mockImplementationOnce(() => fonts.promise)
      const { facade: f } = facade(port, prepare)
      const pending = f.sync(context)
      await Promise.resolve()
      await f.sync({ ...context, revision: 2, area: 'pd:b' })
      old.resolve(ok(source))
      fonts.resolve(measurer)
      await pending
      expect(f.selected()).toBe('b')
      expect(
        f.page()?.primitives.some((p) => p.kind === 'text' && p.text.includes('Учебный ПД b')),
      ).toBe(true)
      expect(f.busy()).toBe(false)
    },
  )
  it('операция редактора скрывает старый лист и не принимает ответ прежней ревизии', async () => {
    const { facade: f, port } = facade()
    await f.sync(context)
    const old = deferred<Awaited<ReturnType<EditorSheetClient['source']>>>()
    vi.mocked(port.source).mockImplementationOnce(() => old.promise)
    const pending = f.sync({ ...context, revision: 2 })
    await f.sync({ ...context, revision: 2, busy: true })
    expect(f.document()).toBeNull()
    old.resolve(ok(source))
    await pending
    expect(f.document()).toBeNull()
    await f.sync({ ...context, revision: 3 })
    expect(f.document()).not.toBeNull()
  })
  it.each(['result', 'throw', 'fonts'] as const)(
    'ошибка %s очищает лист; масштаб и zoom не возвращают старые данные, повтор доступен',
    async (failure) => {
      const port = client()
      const prepare = vi.fn<() => Promise<TextMeasurer>>(async () => measurer)
      if (failure === 'fonts') prepare.mockRejectedValueOnce(new Error('Шрифты'))
      const { facade: f } = facade(port, prepare)
      if (failure !== 'fonts') {
        await f.sync(context)
        if (failure === 'result')
          vi.mocked(port.source).mockResolvedValueOnce(err({ message: 'Учебная ошибка' }))
        else vi.mocked(port.source).mockRejectedValueOnce(new Error('IPC'))
      }
      const next = { ...context, revision: 2 }
      await f.sync(next)
      const error = f.error()
      expect(error).toBeTruthy()
      f.setScale(25000)
      f.setZoom(1)
      expect(f.document()).toBeNull()
      expect(f.error()).toBe(error)
      await f.retry(next)
      expect(f.document()).not.toBeNull()
      expect(f.error()).toBeNull()
    },
  )
  it('сохраняет страницу при правке того же ПД, ограничивает индекс после сокращения, сбрасывает при смене ПД', async () => {
    const { facade: f, port } = facade()
    vi.mocked(port.source).mockResolvedValue(ok(longSource))
    await f.sync(context)
    expect(f.document()!.pages.length).toBeGreaterThan(1)
    f.move(1)
    await f.sync({ ...context, revision: 2 })
    expect(f.index()).toBe(1)
    vi.mocked(port.source).mockResolvedValueOnce(ok(source))
    await f.sync({ ...context, revision: 3 })
    expect(f.index()).toBe(0)
    await f.sync({ ...context, revision: 4 })
    f.move(1)
    await f.sync({ ...context, area: 'pd:b', revision: 4 })
    expect(f.index()).toBe(0)
    const document = f.document()
    f.setZoom(1)
    expect(f.document()).toBe(document)
  })
  it('отсутствие плана или найденная автокопия скрывают лист без запроса и игнорируют прежнюю загрузку', async () => {
    const { facade: f, port } = facade()
    const old = deferred<Awaited<ReturnType<EditorSheetClient['source']>>>()
    vi.mocked(port.source).mockImplementationOnce(() => old.promise)
    const pending = f.sync(context)
    await f.sync({ ...context, hasPlan: false })
    old.resolve(ok(source))
    await pending
    expect(f.document()).toBeNull()
    await f.sync({ ...context, hasRecovery: true })
    expect(port.source).toHaveBeenCalledTimes(1)
  })
})
