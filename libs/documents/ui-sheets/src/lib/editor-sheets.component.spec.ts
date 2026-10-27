import { TestBed } from '@angular/core/testing'
import { err, ok } from '@eow/shared/kernel'
import {
  mm,
  type EditorSheetClient,
  type EditorPdfClient,
  type PdfBatchClient,
  type TextMeasurer,
} from '@eow/documents/application'
import type {
  PlanPageSelection,
  PlanPdScaleChange,
  PlanPreviewContext,
  PlanSheetData,
} from '@eow/planning/sheet-api'
import {
  EDITOR_SHEET_CLIENT,
  EDITOR_PDF_CLIENT,
  EDITOR_PDF_BATCH_CLIENT,
  EditorSheetsFacade,
} from './editor-sheets.facade'
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

function batchClient(): PdfBatchClient {
  return {
    start: vi.fn<PdfBatchClient['start']>(async (_r, _m, pds) =>
      ok({ job: 'j', total: pds.length }),
    ),
    add: vi.fn<PdfBatchClient['add']>(async () => ok(undefined)),
    finish: vi.fn<PdfBatchClient['finish']>(async () => ok(undefined)),
    cancel: vi.fn<PdfBatchClient['cancel']>(async () => undefined),
  }
}
function batchSetup(batch = batchClient(), port = client()) {
  TestBed.configureTestingModule({
    providers: [
      EditorSheetsFacade,
      ...providers(port),
      { provide: EDITOR_PDF_BATCH_CLIENT, useValue: batch },
    ],
  })
  return { facade: TestBed.inject(EditorSheetsFacade), batch, port }
}

describe('Пакетный PDF в редакторе плана', () => {
  it.each([
    ['pd', 'file', ['a']],
    ['all', 'file', ['a', 'b']],
    ['folder', 'folder', ['a', 'b']],
  ] as const)('режим %s передаёт ПД и ревизию готового листа', async (kind, mode, pds) => {
    const { facade, batch } = batchSetup()
    expect(facade.canExportBatch(context)).toBe(false)
    await facade.sync(context)
    expect(facade.canExportBatch(context)).toBe(true)
    expect(facade.canExportBatch({ ...context, pending: true })).toBe(false)
    expect(facade.canExportBatch({ ...context, revision: 2 })).toBe(false)
    await facade.exportBatch(kind, context)
    expect(batch.start).toHaveBeenCalledExactlyOnceWith(1, mode, pds)
    expect(vi.mocked(batch.add).mock.calls.map(([, revision, pd]) => [revision, pd])).toEqual(
      pds.map((pd) => [1, pd]),
    )
    expect(batch.finish).toHaveBeenCalledExactlyOnceWith('j', 1)
    expect(facade.pdfStatus()).toBe(
      mode === 'folder'
        ? 'PDF сохранены: файлов 2, листов 2.'
        : `PDF сохранён: листов ${pds.length}.`,
    )
    expect(facade.exporting()).toBe(false)
  })
  it('остановка между ПД отменяет задание и сообщает о сохранённых файлах', async () => {
    const { facade, batch } = batchSetup()
    await facade.sync(context)
    vi.mocked(batch.add).mockImplementationOnce(async () => {
      expect(facade.batchRunning()).toBe(true)
      facade.stopBatch()
      return ok(undefined)
    })
    await facade.exportBatch('folder', context)
    expect(batch.cancel).toHaveBeenCalledExactlyOnceWith('j')
    expect(batch.finish).not.toHaveBeenCalled()
    expect(facade.pdfStatus()).toBe('Сохранение PDF остановлено. Сохранено файлов: 1.')
    expect(facade.batchRunning()).toBe(false)
  })
  it('ошибка задания показывает сообщение один раз, без повторного счёта файлов', async () => {
    const batch = batchClient()
    vi.mocked(batch.add)
      .mockResolvedValueOnce(ok(undefined))
      .mockResolvedValueOnce(err({ message: 'Учебный отказ. Сохранено файлов: 1.' }))
    const { facade } = batchSetup(batch)
    await facade.sync(context)
    await facade.exportBatch('folder', context)
    expect(facade.pdfError()).toBe('Учебный отказ. Сохранено файлов: 1.')
    expect(facade.pdfStatus()).toBeNull()
  })
})

describe('Лист в редакторе плана', () => {
  it('экспортирует готовую текущую страницу без zoom, блокирует черновик, гонки и повторный клик', async () => {
    const pdf: EditorPdfClient = {
      export: vi.fn<EditorPdfClient['export']>(async () => ok('saved')),
    }
    TestBed.configureTestingModule({
      providers: [
        EditorSheetsFacade,
        ...providers(client()),
        { provide: EDITOR_PDF_CLIENT, useValue: pdf },
      ],
    })
    const f = TestBed.inject(EditorSheetsFacade)
    expect(f.canExport(context)).toBe(false)
    await f.sync(context)
    const page = f.page()
    f.setZoom(1.5)
    for (const changed of [
      null,
      { ...context, pending: true },
      { ...context, busy: true },
      { ...context, hasRecovery: true },
      { ...context, revision: 2 },
      { ...context, area: 'pd:b' },
    ]) {
      await f.exportPdf(changed)
      expect(pdf.export).not.toHaveBeenCalled()
    }
    const done = deferred<Awaited<ReturnType<EditorPdfClient['export']>>>()
    vi.mocked(pdf.export).mockImplementationOnce(() => done.promise)
    const pending = f.exportPdf(context)
    expect(f.exporting()).toBe(true)
    await f.exportPdf(context)
    expect(pdf.export).toHaveBeenCalledExactlyOnceWith({ revision: 1, pd: 'a', page })
    done.resolve(ok('saved'))
    await pending
    expect(f.exporting()).toBe(false)
    expect(f.pdfStatus()).toContain('сохранён')
    vi.mocked(pdf.export).mockResolvedValueOnce(ok('cancelled'))
    await f.exportPdf(context)
    expect(f.pdfStatus()).toContain('отменено')
    vi.mocked(pdf.export).mockResolvedValueOnce(err({ message: 'Учебная ошибка' }))
    await f.exportPdf(context)
    expect(f.pdfError()).toBe('Учебная ошибка')
    expect(f.page()).toBe(page)
    vi.mocked(pdf.export).mockRejectedValueOnce(new Error('IPC'))
    await f.exportPdf(context)
    expect(f.pdfError()).toContain('Повторите')
    expect(f.exporting()).toBe(false)
  })
  it('восстанавливает сохранённый масштаб, сохраняет временный при правке работ и сбрасывает для другого плана', async () => {
    const { facade: f } = facade()
    await f.sync({ ...context, pdScale: 50000, planEpoch: 0 })
    f.setScale(25000)
    await f.sync({ ...context, revision: 2, pdScale: 50000, planEpoch: 0 })
    expect(f.scale()).toBe(25000)
    expect(f.savedScale()).toBe(50000)
    await f.sync({ ...context, revision: 3, pdScale: 100000, planEpoch: 0 })
    expect(f.scale()).toBe(100000)
    expect(f.index()).toBe(0)
    await f.sync({ ...context, revision: 4, pdScale: 50000, planEpoch: 0 })
    expect(f.scale()).toBe(50000)
    f.setScale(25000)
    await f.sync({ ...context, revision: 5, pdScale: 50000, planEpoch: 1 })
    expect(f.scale()).toBe(50000)
    await f.sync({ ...context, revision: 5, area: 'pd:b', pdScale: 25000, planEpoch: 1 })
    expect(f.scale()).toBe(25000)
  })
  it('закрепляет масштаб только явной кнопкой, блокируя незавершённый ввод', async () => {
    await TestBed.configureTestingModule({
      imports: [EditorSheetsComponent],
      providers: providers(client()),
    }).compileComponents()
    const fixture = TestBed.createComponent(EditorSheetsComponent)
    const changes = vi.fn<(change: PlanPdScaleChange) => void>()
    fixture.componentInstance.saveScale.subscribe(changes)
    fixture.componentRef.setInput('context', { ...context, pdScale: 25000 })
    await fixture.whenStable()
    fixture.detectChanges()
    const element = fixture.nativeElement as HTMLElement
    const select = element.querySelector<HTMLSelectElement>('#editor-sheet-scale')!
    expect(select.value).toBe('25000')
    select.value = '100000'
    select.dispatchEvent(new Event('change'))
    await fixture.whenStable()
    fixture.detectChanges()
    expect(changes).not.toHaveBeenCalled()
    const button = [...element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Сохранить масштаб в плане',
    )!
    fixture.componentRef.setInput('context', { ...context, pdScale: 25000, pending: true })
    await fixture.whenStable()
    fixture.detectChanges()
    expect(button.disabled).toBe(true)
    button.click()
    expect(changes).not.toHaveBeenCalled()
    fixture.componentRef.setInput('context', { ...context, pdScale: 25000 })
    await fixture.whenStable()
    fixture.detectChanges()
    button.click()
    expect(changes).toHaveBeenCalledExactlyOnceWith({ revision: 1, area: 'pd:a', scale: 100000 })
  })
  it('показывает SVG и незавершённый ввод, не перезагружая ту же ревизию', async () => {
    const port = client()
    await TestBed.configureTestingModule({
      imports: [EditorSheetsComponent],
      providers: providers(port),
    }).compileComponents()
    const fixture = TestBed.createComponent(EditorSheetsComponent)
    const selections: (PlanPageSelection | null)[] = []
    fixture.componentInstance.pageSelection.subscribe((selection) => selections.push(selection))
    fixture.componentRef.setInput('context', context)
    await fixture.whenStable()
    fixture.detectChanges()
    const element = fixture.nativeElement as HTMLElement
    expect(element.querySelector('svg')?.textContent).toContain('Учебный ПД a')
    expect(selections.at(-1)).toEqual({ revision: 1, area: 'pd:a', page: 1, workIds: [] })
    fixture.componentRef.setInput('context', { ...context, pending: true })
    await fixture.whenStable()
    expect(element.textContent).toContain('Есть незавершённый ввод')
    expect(port.source).toHaveBeenCalledTimes(1)
    fixture.componentRef.setInput('context', { ...context, area: 'station:s' })
    await fixture.whenStable()
    expect(element.querySelector('svg')).toBeNull()
    expect(selections.at(-1)).toBeNull()
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
    expect(f.selection()).toBeNull()
    old.resolve(ok(source))
    await pending
    expect(f.document()).toBeNull()
    await f.sync({ ...context, revision: 3 })
    expect(f.document()).not.toBeNull()
    expect(f.selection()).toMatchObject({ revision: 3, area: 'pd:a' })
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
      expect(f.selection()).toBeNull()
      expect(f.error()).toBe(error)
      await f.retry(next)
      expect(f.document()).not.toBeNull()
      expect(f.selection()).toMatchObject({ revision: 2, area: 'pd:a' })
      expect(f.error()).toBeNull()
    },
  )
  it('сохраняет страницу при правке того же ПД, ограничивает индекс после сокращения, сбрасывает при смене ПД', async () => {
    const { facade: f, port } = facade()
    vi.mocked(port.source).mockResolvedValue(ok(longSource))
    await f.sync(context)
    expect(f.document()!.pages.length).toBeGreaterThan(1)
    f.move(1)
    expect(f.selection()?.page).toBe(2)
    await f.sync({ ...context, revision: 2 })
    expect(f.index()).toBe(1)
    vi.mocked(port.source).mockResolvedValueOnce(ok(source))
    await f.sync({ ...context, revision: 3 })
    expect(f.index()).toBe(0)
    expect(f.selection()).toMatchObject({ revision: 3, page: 1 })
    await f.sync({ ...context, revision: 4 })
    f.move(1)
    await f.sync({ ...context, area: 'pd:b', revision: 4 })
    expect(f.index()).toBe(0)
    expect(f.selection()).toMatchObject({ area: 'pd:b', page: 1 })
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
