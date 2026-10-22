import { mkdtemp, mkdir, open, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { selectedExportFile, ExportReadBudget, ExportReadLimitError } from './export-files'

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

describe('Суммарный бюджет чтения выгрузок', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-export-budget-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('общий бюджет ограничивает несколько допустимых файлов, точное равенство разрешено', async () => {
    const a = join(root, 'a.xls'),
      b = join(root, 'b.xls'),
      c = join(root, 'c.xls')
    await writeFile(a, '12345')
    await writeFile(b, '67890')
    await writeFile(c, 'X')
    const budget = new ExportReadBudget(10)
    expect((await selectedExportFile(a, budget)).bytes.byteLength).toBe(5)
    expect((await selectedExportFile(b, budget)).bytes.byteLength).toBe(5)
    await expect(selectedExportFile(c, budget)).rejects.toThrow(ExportReadLimitError)
    // Отмена/ошибка не расходуют бюджет следующего независимого сеанса.
    expect((await selectedExportFile(c, new ExportReadBudget(1))).bytes.byteLength).toBe(1)
  })

  it('связанный лист делит бюджет с оболочкой и другими выбранными файлами', async () => {
    const path = join(root, 'book.xls')
    await writeFile(path, '12345')
    await writeFile(join(root, 'sheet.htm'), '67890')
    const file = await selectedExportFile(path, new ExportReadBudget(9))
    await expect(file.sibling?.('sheet.htm')).rejects.toThrow('Общий размер')
    const exact = await selectedExportFile(path, new ExportReadBudget(10))
    expect(new TextDecoder().decode(await exact.sibling?.('sheet.htm'))).toBe('67890')
  })

  it('размер сверх 64 МиБ отклоняется до выделения буфера', async () => {
    const path = join(root, 'large.xls')
    const file = await open(path, 'w')
    try {
      await file.truncate(64 * 1024 * 1024 + 1)
    } finally {
      await file.close()
    }
    await expect(selectedExportFile(path)).rejects.toThrow('64 МиБ')
  })
})
