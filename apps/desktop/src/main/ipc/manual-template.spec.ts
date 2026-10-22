import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { channels } from '@eow/ipc/contracts'
import { XlsxManualDataTemplate } from '@eow/import/infrastructure'
import { openPassportDatabase, type PassportDatabase } from '@eow/passport/infrastructure'
import type { Result } from '@eow/shared/kernel'
import { registerManualTemplateHandlers, type ManualTemplateDialogs } from './manual-template'

const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error('Ошибка учебного хранилища')
  return r.value
}

describe('Диалоги и подтверждение шаблона ручных данных', () => {
  let root: string, store: PassportDatabase, id: number, path: string
  let handler: (event: unknown, ...args: unknown[]) => unknown
  let dialogs: ManualTemplateDialogs
  let clock: Date
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-manual-ipc-'))
    store = await openPassportDatabase(
      join(root, 'passport.sqlite'),
      resolve(import.meta.dirname, '../../../../../libs/passport/infrastructure/migrations'),
    )
    id = value(await store.createDraft({ date: '2027-01-01', label: 'Учебная редакция' })).id
    path = join(root, 'Учебная.xlsx')
    dialogs = {
      open: vi.fn<ManualTemplateDialogs['open']>(async () => path),
      save: vi.fn<ManualTemplateDialogs['save']>(async () => path),
    }
    clock = new Date('2027-01-01T12:00:00Z')
    registerManualTemplateHandlers(
      {
        handle: (_name, listener) => {
          handler = listener
        },
      },
      store,
      new XlsxManualDataTemplate(),
      dialogs,
      () => clock,
    )
  })
  afterEach(async () => {
    await store.close()
    await rm(root, { recursive: true, force: true })
  })
  const invoke = async (request: unknown) =>
    channels.manualTemplate.response.parse(await handler(undefined, request))
  async function prepare() {
    expect(await invoke({ action: 'export', editionId: id })).toEqual({ status: 'exported' })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(await readFile(path)).buffer)
    wb.getWorksheet('Виды работ')!.addRow(['УЧ', 'Вымышленная работа', 'км', 'текущее'])
    await writeFile(path, new Uint8Array(await wb.xlsx.writeBuffer()))
    const response = await invoke({ action: 'prepare', editionId: id })
    if (response.status !== 'preview') throw new Error(JSON.stringify(response))
    return response.review
  }
  it('выдаёт книгу, показывает итоги без записи и применяет только подтверждённую команду один раз', async () => {
    const review = await prepare()
    expect(review.fileName).toBe('Учебная.xlsx')
    expect(review.changes).toContainEqual({ sheet: 'Виды работ', added: 1, changed: 0, removed: 0 })
    expect(JSON.stringify(review)).not.toContain(root)
    expect(value(await store.manualBasis(id)).data.workKinds).toHaveLength(0)
    const request = { action: 'apply', editionId: id, token: review.token }
    expect(await invoke(request)).toEqual({ status: 'applied' })
    expect(value(await store.manualBasis(id)).data.workKinds).toHaveLength(1)
    expect(value(await store.manualImportReport(id))).toHaveLength(1)
    expect(await invoke(request)).toMatchObject({ status: 'error' })
  })
  it('отмена выбора или предпросмотра не пишет данные и журнал', async () => {
    vi.mocked(dialogs.open).mockResolvedValueOnce(undefined)
    expect(await invoke({ action: 'prepare', editionId: id })).toEqual({ status: 'cancelled' })
    vi.mocked(dialogs.save).mockResolvedValueOnce(undefined)
    expect(await invoke({ action: 'export', editionId: id })).toEqual({ status: 'cancelled' })
    const review = await prepare()
    const request = { editionId: id, token: review.token }
    expect(await invoke({ ...request, action: 'discard' })).toEqual({ status: 'discarded' })
    expect(await invoke({ ...request, action: 'apply' })).toMatchObject({ status: 'error' })
    expect(value(await store.manualImportReport(id))).toEqual([])
  })
  it('не принимает путь, данные или неправильный токен из renderer', async () => {
    await expect(invoke({ action: 'prepare', editionId: id, path })).rejects.toThrow(
      'неверный запрос',
    )
    await expect(
      invoke({ action: 'apply', editionId: id, token: 'bad', data: {} }),
    ).rejects.toThrow('неверный запрос')
    expect(dialogs.open).not.toHaveBeenCalled()
    const review = await prepare()
    expect(await invoke({ action: 'apply', editionId: id + 1, token: review.token })).toMatchObject(
      { status: 'error' },
    )
    expect(value(await store.manualImportReport(id))).toEqual([])
  })
  it('отклоняет устаревшую основу после предпросмотра без потери новых данных', async () => {
    const review = await prepare()
    const basis = value(await store.manualBasis(id))
    value(
      await store.applyManualData(id, {
        basisToken: basis.token,
        date: basis.date,
        data: {
          ...basis.data,
          tolerances: [
            {
              id: 'other',
              code: 'Т',
              name: 'Учебный допуск',
              value: 3,
              unit: 'мм',
              conditions: null,
              validFrom: null,
              validTo: null,
            },
          ],
        },
        file: {
          id: 'other',
          form: 'manual-data',
          name: 'Другая.xlsx',
          importedAt: clock.toISOString(),
          sha256: 'a'.repeat(64),
          rowCount: 1,
          warnings: [],
        },
      }),
    )
    expect(await invoke({ action: 'apply', editionId: id, token: review.token })).toMatchObject({
      status: 'error',
    })
    const saved = value(await store.manualBasis(id)).data
    expect(saved.workKinds).toEqual([])
    expect(saved.tolerances[0]?.value).toBe(3)
  })
  it('защищает введённую в действие редакцию до выбора файла и после предпросмотра', async () => {
    const review = await prepare()
    value(await store.activate(id))
    vi.mocked(dialogs.open).mockClear()
    expect(await invoke({ action: 'apply', editionId: id, token: review.token })).toMatchObject({
      status: 'error',
    })
    expect(await invoke({ action: 'prepare', editionId: id })).toMatchObject({ status: 'error' })
    expect(dialogs.open).not.toHaveBeenCalled()
    expect(value(await store.manualImportReport(id))).toEqual([])
  })
  it('просроченный предпросмотр и новая подготовка отменяют старый токен', async () => {
    const first = await prepare()
    const second = await invoke({ action: 'prepare', editionId: id })
    expect(second.status).toBe('preview')
    expect(await invoke({ action: 'apply', editionId: id, token: first.token })).toMatchObject({
      status: 'error',
    })
    if (second.status !== 'preview') throw new Error('Нет предпросмотра')
    clock = new Date(clock.getTime() + 10 * 60 * 1000)
    expect(
      await invoke({ action: 'apply', editionId: id, token: second.review.token }),
    ).toMatchObject({ status: 'error', message: expect.stringContaining('истекло') })
    expect(value(await store.manualImportReport(id))).toEqual([])
  })
  it('показывает расположение ошибки книги без записи', async () => {
    await invoke({ action: 'export', editionId: id })
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(await readFile(path)).buffer)
    wb.getWorksheet('Допуски')!.addRow(['Т', 'Учебный допуск', 'ошибка', 'мм'])
    await writeFile(path, new Uint8Array(await wb.xlsx.writeBuffer()))
    expect(await invoke({ action: 'prepare', editionId: id })).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/Допуски.*строка 2/u),
    })
    expect(value(await store.manualImportReport(id))).toEqual([])
  })
  it('сбой доступа не раскрывает путь, повтор операции возможен', async () => {
    vi.mocked(dialogs.open).mockRejectedValueOnce(new Error(`Доступ запрещён: ${root}`))
    const response = await invoke({ action: 'prepare', editionId: id })
    expect(response.status).toBe('error')
    expect(JSON.stringify(response)).not.toContain(root)
    await prepare()
  })
  it('повторный запрос во время диалога отклоняется', async () => {
    let finish!: (value: undefined) => void
    vi.mocked(dialogs.open).mockReturnValueOnce(
      new Promise((complete) => {
        finish = complete
      }),
    )
    const pending = invoke({ action: 'prepare', editionId: id })
    await vi.waitFor(() => expect(dialogs.open).toHaveBeenCalled())
    expect(await invoke({ action: 'export', editionId: id })).toMatchObject({
      status: 'error',
      message: expect.stringContaining('Дождитесь'),
    })
    finish(undefined)
    expect(await pending).toEqual({ status: 'cancelled' })
  })
})
