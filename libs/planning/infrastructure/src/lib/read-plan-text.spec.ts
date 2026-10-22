import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  MAX_PLAN_FILE_BYTES,
  PlanTextReadError,
  readBoundedPlanText,
  readPlanText,
} from './read-plan-text'
const file = (text: string, size = Buffer.byteLength(text)) => {
  const bytes = Buffer.from(text)
  let position = 0
  return {
    stat: async () => ({ size, isFile: () => true }),
    read: vi.fn<(buffer: Uint8Array) => Promise<{ bytesRead: number }>>(async (buffer) => {
      const n = Math.min(buffer.length, bytes.length - position)
      buffer.set(bytes.subarray(position, position + n))
      position += n
      return { bytesRead: n }
    }),
  }
}
describe('Бюджет чтения плана и прототипа', () => {
  it('читает UTF-8, не путая байты с длиной строки; граница включительна', async () => {
    expect(await readBoundedPlanText(file('Я😀'), 6)).toBe('Я😀')
    expect(await readBoundedPlanText(file(''), 1)).toBe('')
  })
  it('отклоняет заявленное превышение до чтения и растущий файл до сборки строки', async () => {
    const oversized = file('12345')
    await expect(readBoundedPlanText(oversized, 4)).rejects.toBeInstanceOf(PlanTextReadError)
    expect(oversized.read).not.toHaveBeenCalled()
    const growing = file('12345', 1)
    await expect(readBoundedPlanText(growing, 4)).rejects.toBeInstanceOf(PlanTextReadError)
    expect(growing.read.mock.calls[0]?.[0].length).toBe(5)
  })
  it('отклоняет каталог до чтения', async () => {
    const source = file('')
    source.stat = async () => ({ size: 0, isFile: () => false })
    await expect(readBoundedPlanText(source)).rejects.toBeInstanceOf(PlanTextReadError)
    expect(source.read).not.toHaveBeenCalled()
  })
  it('закрывает файл при отказе и различает отсутствие файла', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eow-bounded-read-'))
    const path = join(root, 'test.json')
    try {
      expect(await readPlanText(path)).toBeUndefined()
      await writeFile(path, 'Учебный текст')
      expect(await readPlanText(path)).toBe('Учебный текст')
      const handle = await open(path, 'w')
      try {
        await handle.truncate(MAX_PLAN_FILE_BYTES + 1)
      } finally {
        await handle.close()
      }
      await expect(readPlanText(path)).rejects.toThrow('80 МиБ')
      await rm(path)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
