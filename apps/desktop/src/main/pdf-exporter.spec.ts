import { mkdtemp, readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mm, type SheetPage } from '@eow/documents/application'
import { pdfBatchWriter, pdfExporter, writePdfAtomically } from './pdf-exporter'
const page: SheetPage = { width: mm(420), height: mm(297), number: 2, primitives: [] }
const bytes = new TextEncoder().encode('%PDF-учебный')
let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'eow-pdf-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
it('записывает PDF атомарно по выбранному пути без временного файла', async () => {
  const path = join(directory, 'учебный.pdf')
  const render = vi.fn<(p: readonly SheetPage[]) => Promise<Uint8Array>>(async () => bytes)
  expect(await pdfExporter(async () => path, render).export(page)).toEqual({
    ok: true,
    value: 'saved',
  })
  expect(await readFile(path)).toEqual(Buffer.from(bytes))
  await writePdfAtomically(path, bytes)
  expect(await readdir(directory)).toEqual(['учебный.pdf'])
  expect(render).toHaveBeenCalledExactlyOnceWith([page])
})
it('не дописывает расширение после диалога и не обходит подтверждение замены другого файла', async () => {
  const path = join(directory, 'учебный')
  await writeFile(`${path}.pdf`, 'прежний PDF')
  const render = vi.fn<(p: readonly SheetPage[]) => Promise<Uint8Array>>(async () => bytes)
  expect(await pdfExporter(async () => path, render).export(page)).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining('.pdf') },
  })
  expect(render).not.toHaveBeenCalled()
  expect(await readFile(`${path}.pdf`, 'utf8')).toBe('прежний PDF')
})
it('отмена диалога не печатает и не записывает файл', async () => {
  const render = vi.fn<(p: readonly SheetPage[]) => Promise<Uint8Array>>(async () => bytes)
  expect(await pdfExporter(async () => undefined, render).export(page)).toEqual({
    ok: true,
    value: 'cancelled',
  })
  expect(render).not.toHaveBeenCalled()
  expect(await readdir(directory)).toEqual([])
})
it.each(['render', 'invalid', 'write'] as const)(
  'отказ %s сохраняет прежний файл',
  async (failure) => {
    const path = join(directory, 'учебный.pdf')
    await writeFile(path, 'прежний файл')
    const render = async () => {
      if (failure === 'render') throw new Error('учебный отказ')
      return failure === 'invalid' ? new Uint8Array([0]) : bytes
    }
    const write = async () => {
      throw new Error('учебный отказ записи')
    }
    expect(
      (
        await pdfExporter(
          async () => path,
          render,
          failure === 'write' ? write : writePdfAtomically,
        ).export(page)
      ).ok,
    ).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('прежний файл')
    expect(await readdir(directory)).toEqual(['учебный.pdf'])
  },
)
it('неудачное переименование убирает временный файл, сохраняя существующую цель', async () => {
  const path = join(directory, 'учебный.pdf')
  await mkdir(path)
  await expect(writePdfAtomically(path, bytes)).rejects.toMatchObject({
    code: expect.stringMatching(/EISDIR|EPERM|EACCES/u),
  })
  expect(await readdir(directory)).toEqual(['учебный.pdf'])
})
describe('запись пакета PDF', () => {
  const dialogs = { chooseFile: async () => undefined, chooseFolder: async () => undefined }
  it('называет занятые имена в папке и пишет все листы одним файлом атомарно', async () => {
    await writeFile(join(directory, 'ПД-1.pdf'), 'прежний')
    const render = vi.fn<(p: readonly SheetPage[]) => Promise<Uint8Array>>(async () => bytes)
    const writer = pdfBatchWriter(dialogs, render)
    expect(await writer.existing(directory, ['ПД-1.pdf', 'ПД-2.pdf'])).toEqual(['ПД-1.pdf'])
    const target = writer.join(directory, 'ПД-2.pdf')
    expect(await writer.write(target, [page, { ...page, number: 3 }])).toEqual({
      ok: true,
      value: undefined,
    })
    expect(render).toHaveBeenCalledExactlyOnceWith([page, { ...page, number: 3 }])
    expect(await readFile(target)).toEqual(Buffer.from(bytes))
    expect((await readdir(directory)).sort()).toEqual(['ПД-1.pdf', 'ПД-2.pdf'])
  })
  it.each(['render', 'invalid', 'write'] as const)(
    'отказ %s не оставляет файла',
    async (failure) => {
      const writer = pdfBatchWriter(
        dialogs,
        async () => {
          if (failure === 'render') throw new Error('учебный отказ')
          return failure === 'invalid' ? new Uint8Array([0]) : bytes
        },
        async () => {
          throw new Error('учебный отказ записи')
        },
      )
      expect((await writer.write(join(directory, 'ПД.pdf'), [page])).ok).toBe(false)
      expect(await readdir(directory)).toEqual([])
    },
  )
})
