import { mm, type PdfBatchWriter, type SheetPage } from '@eow/documents/application'
import { err, ok } from '@eow/shared/kernel'
import { pdfBatchJobs } from './pdf-batch-job'

const page: SheetPage = { width: mm(420), height: mm(297), number: 1, primitives: [] }
function setup() {
  const writer: PdfBatchWriter = {
    chooseFile: vi.fn<PdfBatchWriter['chooseFile']>(async (name) => `/учебная/${name}`),
    chooseFolder: vi.fn<PdfBatchWriter['chooseFolder']>(async () => '/учебная'),
    existing: vi.fn<PdfBatchWriter['existing']>(async () => []),
    write: vi.fn<PdfBatchWriter['write']>(async () => ok(undefined)),
    join: (folder, name) => `${folder}/${name}`,
  }
  return { writer, jobs: pdfBatchJobs(writer) }
}
const value = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}

describe('Пакетное задание PDF в main', () => {
  it('режим «файл» копит листы всех ПД и пишет один файл только при завершении', async () => {
    const { writer, jobs } = setup()
    const started = value(await jobs.start(3, 'file', ['a', 'b'], ['ПД-1', 'ПД-2'], 'ПД 2027.pdf'))
    if (started === 'cancelled') throw new Error('отмена')
    expect(started).toMatchObject({ total: 2, done: 0 })
    expect(writer.chooseFile).toHaveBeenCalledExactlyOnceWith('ПД 2027.pdf')
    expect(value(await jobs.add(started.job, 3, 'a', [page]))).toMatchObject({ done: 1 })
    expect(
      value(await jobs.add(started.job, 3, 'b', [page, { ...page, number: 2 }])),
    ).toMatchObject({ done: 2 })
    expect(writer.write).not.toHaveBeenCalled()
    expect(await jobs.finish(started.job, 3)).toEqual({ ok: true, value: undefined })
    expect(writer.write).toHaveBeenCalledExactlyOnceWith('/учебная/ПД 2027.pdf', [
      page,
      page,
      { ...page, number: 2 },
    ])
    expect((await jobs.finish(started.job, 3)).ok).toBe(false)
  })
  it('режим «папка» пишет файл на каждый ПД и не перезаписывает существующие', async () => {
    const { writer, jobs } = setup()
    vi.mocked(writer.existing).mockResolvedValueOnce(['ПД-1.pdf'])
    expect(await jobs.start(3, 'folder', ['a'], ['ПД-1'], '')).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('«ПД-1.pdf»') },
    })
    const started = value(await jobs.start(3, 'folder', ['a', 'b'], ['ПД:1', 'ПД:1'], ''))
    if (started === 'cancelled') throw new Error('отмена')
    expect(writer.existing).toHaveBeenLastCalledWith('/учебная', ['ПД_1.pdf', 'ПД_1 (2).pdf'])
    await jobs.add(started.job, 3, 'a', [page])
    await jobs.add(started.job, 3, 'b', [page])
    expect(vi.mocked(writer.write).mock.calls.map(([path]) => path)).toEqual([
      '/учебная/ПД_1.pdf',
      '/учебная/ПД_1 (2).pdf',
    ])
    expect(await jobs.finish(started.job, 3)).toEqual({ ok: true, value: undefined })
  })
  it('отмена диалога не создаёт задания', async () => {
    const { writer, jobs } = setup()
    vi.mocked(writer.chooseFile).mockResolvedValueOnce(undefined)
    expect(await jobs.start(3, 'file', ['a'], ['ПД-1'], 'ПД-1.pdf')).toEqual({
      ok: true,
      value: 'cancelled',
    })
    vi.mocked(writer.chooseFile).mockResolvedValueOnce('/учебная/без расширения')
    expect((await jobs.start(3, 'file', ['a'], ['ПД-1'], 'ПД-1.pdf')).ok).toBe(false)
    expect((await jobs.start(3, 'file', ['a', 'a'], ['ПД-1', 'ПД-1'], 'x.pdf')).ok).toBe(false)
  })
  it.each(['revision', 'order', 'unknown', 'cancel', 'reset', 'write'] as const)(
    'нарушение %s снимает задание и называет записанные файлы',
    async (problem) => {
      const { writer, jobs } = setup()
      const started = value(await jobs.start(3, 'folder', ['a', 'b'], ['ПД-1', 'ПД-2'], ''))
      if (started === 'cancelled') throw new Error('отмена')
      await jobs.add(started.job, 3, 'a', [page])
      if (problem === 'cancel') jobs.cancel(started.job)
      if (problem === 'reset') jobs.reset()
      if (problem === 'write')
        vi.mocked(writer.write).mockResolvedValueOnce(err({ message: 'Учебный отказ.' }))
      const result = await jobs.add(
        problem === 'unknown' ? crypto.randomUUID() : started.job,
        problem === 'revision' ? 4 : 3,
        problem === 'order' ? 'a' : 'b',
        [page],
      )
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error.message.includes('Сохранено файлов: 1.')).toBe(
        ['revision', 'order', 'write'].includes(problem),
      )
      expect((await jobs.add(started.job, 3, 'b', [page])).ok).toBe(problem === 'unknown')
    },
  )
  it('ограничивает число листов одного PDF', async () => {
    const { jobs } = setup()
    const started = value(await jobs.start(3, 'file', ['a', 'b'], ['ПД-1', 'ПД-2'], 'x.pdf'))
    if (started === 'cancelled') throw new Error('отмена')
    await jobs.add(
      started.job,
      3,
      'a',
      Array.from({ length: 200 }, () => page),
    )
    expect(
      await jobs.add(
        started.job,
        3,
        'b',
        Array.from({ length: 101 }, () => page),
      ),
    ).toMatchObject({ ok: false, error: { message: expect.stringContaining('не более 300') } })
  })
})
