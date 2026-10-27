import type { PlanSheetData } from '@eow/planning/sheet-api'
import { err, ok } from '@eow/shared/kernel'
import { exportPdBatch, type PdfBatchInput } from './pdf-batch'
import { pdfFileNames, type PdfBatchClient } from './pdf-exporter'
import type { EditorSheetClient } from './pd-layout'
import { tableMeasurer } from './testing/table-measurer'

const span = (from: number, to: number) => ({
  line: 'l',
  from: { km: from, m: 0 },
  to: { km: to, m: 0 },
})
const source: PlanSheetData = {
  year: 2027,
  edition: { number: '7', date: '2027-01-01' },
  approval: { title: 'Учебная должность', name: '', year: 2026 },
  lines: [{ id: 'l', name: 'УЧЕБНОЕ', extents: [span(10, 30)], kmLengths: [] }],
  pds: [
    {
      id: 'a',
      name: 'ПД-1',
      pchu: 'ПЧУ',
      scale: 25000,
      segments: [span(10, 20)],
      works: [],
      tables: [],
    },
    { id: 'b', name: 'ПД-2', pchu: 'ПЧУ', segments: [span(20, 30)], works: [], tables: [] },
  ],
}
function setup(overrides: Partial<PdfBatchClient> = {}) {
  const client: PdfBatchClient = {
    start: vi.fn<PdfBatchClient['start']>(async (_revision, _mode, pds) =>
      ok({ job: 'j', total: pds.length }),
    ),
    add: vi.fn<PdfBatchClient['add']>(async () => ok(undefined)),
    finish: vi.fn<PdfBatchClient['finish']>(async () => ok(undefined)),
    cancel: vi.fn<PdfBatchClient['cancel']>(async () => undefined),
    ...overrides,
  }
  const sheets: EditorSheetClient = {
    source: vi.fn<EditorSheetClient['source']>(async () => ok(source)),
  }
  const progress = vi.fn<PdfBatchInput['progress']>()
  let stop = false
  const input = (mode: 'file' | 'folder' = 'file'): PdfBatchInput => ({
    client,
    sheets,
    measurer: tableMeasurer,
    revision: 4,
    mode,
    pds: ['a', 'b'],
    progress,
    stopped: () => stop,
  })
  return { client, sheets, progress, input, stopAfter: () => (stop = true) }
}

describe('Пакетный PDF листов ПД', () => {
  it('раскладывает каждый ПД в масштабе плана по одной ревизии и печатает общий файл', async () => {
    const { client, sheets, progress, input } = setup()
    const result = await exportPdBatch(input())
    expect(result).toMatchObject({ ok: true, value: { outcome: 'saved', files: 1 } })
    expect(client.start).toHaveBeenCalledExactlyOnceWith(4, 'file', ['a', 'b'])
    expect(vi.mocked(sheets.source).mock.calls).toEqual([
      [4, 'a'],
      [4, 'b'],
    ])
    const added = vi.mocked(client.add).mock.calls
    expect(added.map(([job, revision, pd]) => [job, revision, pd])).toEqual([
      ['j', 4, 'a'],
      ['j', 4, 'b'],
    ])
    expect(added.every(([, , , pages]) => pages.length > 0)).toBe(true)
    expect(client.finish).toHaveBeenCalledExactlyOnceWith('j', 4)
    expect(client.cancel).not.toHaveBeenCalled()
    expect(progress.mock.calls.map(([p]) => [p.phase, p.pd, p.done])).toEqual([
      ['prepare', 'a', 0],
      ['prepare', 'b', 1],
      ['print', null, 2],
    ])
  })
  it('в режиме папки сообщает число файлов', async () => {
    const { input } = setup()
    expect(await exportPdBatch(input('folder'))).toMatchObject({
      ok: true,
      value: { outcome: 'saved', files: 2 },
    })
  })
  it('отмена диалога ничего не раскладывает', async () => {
    const { client, sheets, input } = setup({ start: async () => ok('cancelled' as const) })
    expect(await exportPdBatch(input())).toEqual({
      ok: true,
      value: { outcome: 'cancelled', files: 0, pages: 0 },
    })
    expect(sheets.source).not.toHaveBeenCalled()
    expect(client.add).not.toHaveBeenCalled()
  })
  it('остановка между ПД отменяет задание и называет записанные файлы', async () => {
    const { client, input, stopAfter } = setup()
    vi.mocked(client.add).mockImplementationOnce(async () => {
      stopAfter()
      return ok(undefined)
    })
    expect(await exportPdBatch(input('folder'))).toMatchObject({
      ok: true,
      value: { outcome: 'cancelled', files: 1 },
    })
    expect(client.add).toHaveBeenCalledTimes(1)
    expect(client.cancel).toHaveBeenCalledExactlyOnceWith('j')
    expect(client.finish).not.toHaveBeenCalled()
  })
  it.each(['source', 'add'] as const)('ошибка %s отменяет задание', async (where) => {
    const { client, sheets, input } = setup()
    if (where === 'source')
      vi.mocked(sheets.source).mockResolvedValueOnce(err({ message: 'План изменился.' }))
    else vi.mocked(client.add).mockResolvedValueOnce(err({ message: 'Учебный отказ записи' }))
    const result = await exportPdBatch(input())
    expect(result).toMatchObject({ ok: false, error: { files: 0 } })
    expect(client.cancel).toHaveBeenCalledExactlyOnceWith('j')
    expect(client.finish).not.toHaveBeenCalled()
  })
})

describe('Имена файлов PDF по ПД', () => {
  it('убирает недопустимые для Windows символы, края и зарезервированные имена, нумерует повторы', () => {
    expect(
      pdfFileNames(['ПД-1', 'ПД:1', 'ПД/1', ' ..ПД 2.. ', 'CON', 'lpt1', '', '???', 'пд-1']),
    ).toEqual([
      'ПД-1.pdf',
      'ПД_1.pdf',
      'ПД_1 (2).pdf',
      'ПД 2.pdf',
      '_CON.pdf',
      '_lpt1.pdf',
      'ПД.pdf',
      '___.pdf',
      'пд-1 (2).pdf',
    ])
  })
})
