import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectedExportFile } from './export-files'

describe('Доступ к частям frameset', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-export-paths-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })
  it('читает соседнюю папку, не разрешая выход за её пределы и абсолютные адреса', async () => {
    const selected = join(root, 'selected')
    await mkdir(join(selected, 'book.files'), { recursive: true })
    await writeFile(join(selected, 'book.xls'), '<frameset>')
    await writeFile(join(selected, 'book.files/sheet.htm'), 'учебный лист')
    await writeFile(join(root, 'outside.htm'), 'другие данные')
    const file = await selectedExportFile(join(selected, 'book.xls'))
    expect(new TextDecoder().decode(await file.sibling?.('book.files/sheet.htm'))).toBe(
      'учебный лист',
    )
    for (const part of [
      '../outside.htm',
      '..\\outside.htm',
      join(root, 'outside.htm'),
      'file:///outside.htm',
      'C:\\outside.htm',
    ])
      expect(await file.sibling?.(part)).toBeUndefined()
  })
  it('символьная ссылка на чужую папку не расширяет область чтения', async () => {
    const selected = join(root, 'selected')
    await mkdir(selected)
    await mkdir(join(root, 'outside'))
    await writeFile(join(root, 'outside/sheet.htm'), 'за пределами выбранной папки')
    await writeFile(join(selected, 'book.xls'), '<frameset>')
    await symlink(join(root, 'outside'), join(selected, 'book.files'), 'junction')
    const file = await selectedExportFile(join(selected, 'book.xls'))
    expect(await file.sibling?.('book.files/sheet.htm')).toBeUndefined()
  })
})
