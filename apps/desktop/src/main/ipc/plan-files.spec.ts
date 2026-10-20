import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { channels, type RequestOf } from '@eow/ipc/contracts'
import { createAnnualPlan, samplePlanBasis } from '@eow/planning/domain'
import { decodePlan, encodePlan, FilePlanStore } from '@eow/planning/infrastructure'
import { registerPlanFileHandlers } from './plan-files'
import type { IpcMainLike } from './register'

function document(year: number): string {
  const p = createAnnualPlan(year, samplePlanBasis())
  if (!p.ok) throw new Error('нет плана')
  const text = encodePlan(p.value, '0.1.0')
  if (!text.ok) throw new Error('нет файла')
  return text.value
}

describe('планы в main', () => {
  let directory: string
  let path: string
  let stop: () => Promise<void>
  let listener: (event: unknown, ...args: unknown[]) => unknown
  const dialogs = {
    openPrototype: vi.fn<() => Promise<string | undefined>>(),
    open: vi.fn<() => Promise<string | undefined>>(),
    save: vi.fn<() => Promise<string | undefined>>(),
  }
  const invoke = async (request: RequestOf<typeof channels.planFile>) =>
    channels.planFile.response.parse(await listener({}, request))

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'eow-main-'))
    path = join(directory, 'test.ppr.json')
    dialogs.open.mockReset().mockResolvedValue(path)
    dialogs.openPrototype.mockReset().mockResolvedValue(path)
    dialogs.save.mockReset().mockResolvedValue(path)
    const ipc: IpcMainLike = {
      handle: (_name, fn) => {
        listener = fn
      },
    }
    stop = registerPlanFileHandlers(ipc, dialogs, '0.1.0')
  })
  afterEach(async () => {
    await stop()
    vi.useRealTimers()
    await rm(directory, { recursive: true, force: true })
  })

  it('выбирает путь диалогом и сохраняет проверенный документ', async () => {
    expect(await invoke({ action: 'save', document: document(2027), saveAs: false })).toMatchObject(
      { status: 'ok' },
    )
    expect(dialogs.save).toHaveBeenCalledTimes(1)
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { year: 2027 },
    })
    await invoke({ action: 'save', document: document(2028), saveAs: false })
    expect(dialogs.save).toHaveBeenCalledTimes(1)
  })

  it('отмена диалога оставляет текущий документ', async () => {
    await invoke({ action: 'update', document: document(2027) })
    dialogs.open.mockResolvedValue(undefined)
    expect(await invoke({ action: 'open' })).toEqual({ status: 'cancelled' })
    expect(await invoke({ action: 'state' })).toMatchObject({
      status: 'ok',
      document: document(2027),
    })
  })

  it('не открывает диалог для повреждённого документа', async () => {
    expect(await invoke({ action: 'save', document: '{', saveAs: true })).toMatchObject({
      status: 'error',
    })
    expect(dialogs.save).not.toHaveBeenCalled()
  })

  it('не принимает путь от renderer', async () => {
    await expect(listener({}, { action: 'open', path: 'arbitrary' })).rejects.toThrow(
      'неверный запрос',
    )
  })

  it('импортирует выбранный JSON в новый план и сохраняет его отдельным файлом', async () => {
    const sourcePath = join(directory, 'legacy.json')
    const source = JSON.stringify({
      v: 1,
      meta: { year: 2027 },
      catalog: [{ id: 'X', name: 'Тест', group: 'cur', unit: 'км', inTable: true }],
      lines: [{ id: 'L', name: 'Тестовая линия', from: 10, to: 20 }],
      stations: [
        {
          id: 'S',
          name: 'Тестовая станция',
          layout: {
            tracks: [{ id: 't', num: 'I', kind: 'главный', row: 2, x1: 4, x2: 40, full: 900 }],
            objects: [{ id: 'o', type: 'здание', text: 'Тест', x: 20, y: -1, w: 3, h: 1 }],
          },
        },
      ],
      works: [{ id: 'w', kind: 'X', line: 'L', rangesText: '11 км — 12 км', qty: null }],
    })
    await writeFile(sourcePath, source)
    dialogs.openPrototype.mockResolvedValue(sourcePath)
    const imported = await invoke({
      action: 'importPrototype',
      edition: { number: 'test', date: '2026-10-20' },
    })
    expect(imported.status).toBe('ok')
    if (imported.status !== 'ok' || !imported.document) throw new Error('нет плана')
    expect(decodePlan(imported.document)).toMatchObject({
      ok: true,
      value: { works: [{ id: 'w' }] },
    })
    await invoke({ action: 'save', document: imported.document, saveAs: false })
    expect(await readFile(sourcePath, 'utf8')).toBe(source)
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { prototype: { source } },
    })
    const reopened = decodePlan(await readFile(path, 'utf8'))
    if (!reopened.ok) throw new Error('нет повторно открытого плана')
    expect(reopened.value.basis.stations.get('S')?.legacyLayout).toMatchObject({
      tracks: [{ id: 't', number: 'I', row: 2, x1: 4, x2: 40, fullMeters: 900 }],
      objects: [{ id: 'o', type: 'здание', x: 20, y: -1, width: 3, height: 1 }],
    })
  })

  it('ошибка импорта оставляет ранее открытый план', async () => {
    await invoke({ action: 'update', document: document(2026) })
    await writeFile(path, '{')
    expect(
      await invoke({ action: 'importPrototype', edition: { number: 'test', date: '2026-10-20' } }),
    ).toMatchObject({ status: 'error' })
    expect(await invoke({ action: 'state' })).toMatchObject({
      status: 'ok',
      document: document(2026),
    })
  })

  it.each(['kind', 'outside', 'duplicate'] as const)(
    'доменная ошибка %s отклоняет весь импорт без смены текущего плана',
    async (change) => {
      await invoke({ action: 'update', document: document(2026) })
      const project = {
        v: 1,
        meta: { year: 2027 },
        catalog: [{ id: 'X', name: 'Тест', group: 'cur', unit: 'км', inTable: true }],
        lines: [{ id: 'L', name: 'Тест', from: 10, to: 20 }],
        works: [{ id: 'w', kind: 'X', line: 'L', rangesText: '11 км — 12 км', qty: null }],
      }
      switch (change) {
        case 'kind':
          project.works[0]!.kind = 'нет'
          break
        case 'outside':
          project.works[0]!.rangesText = '25 км — 26 км'
          break
        case 'duplicate':
          project.works.push({ ...project.works[0]! })
          break
      }
      await writeFile(path, JSON.stringify(project))
      expect(
        await invoke({
          action: 'importPrototype',
          edition: { number: 'test', date: '2026-10-20' },
        }),
      ).toMatchObject({ status: 'error' })
      expect(await invoke({ action: 'state' })).toMatchObject({
        status: 'ok',
        document: document(2026),
      })
    },
  )

  it('открывает основной документ и восстанавливает автокопию только по выбору', async () => {
    await invoke({ action: 'save', document: document(2026), saveAs: false })
    const store = new FilePlanStore(path, '0.1.0')
    const decoded = decodePlan(document(2027))
    if (!decoded.ok) throw new Error('нет плана')
    await store.autosave(decoded.value)
    expect(await invoke({ action: 'open' })).toMatchObject({
      status: 'ok',
      document: document(2026),
      recovery: document(2027),
    })
    expect(await invoke({ action: 'recover', accept: true })).toMatchObject({
      status: 'ok',
      document: document(2027),
    })
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { year: 2026 },
    })
  })

  it('не стирает предложение восстановления минутным таймером после открытия', async () => {
    await invoke({ action: 'save', document: document(2026), saveAs: false })
    const decoded = decodePlan(document(2027))
    if (!decoded.ok) throw new Error('нет плана')
    await new FilePlanStore(path, '0.1.0').autosave(decoded.value)
    await stop()
    vi.useFakeTimers()
    const ipc: IpcMainLike = {
      handle: (_name, fn) => {
        listener = fn
      },
    }
    stop = registerPlanFileHandlers(ipc, dialogs, '0.1.0')
    await invoke({ action: 'open' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await invoke({ action: 'state' })).toMatchObject({
      status: 'ok',
      recovery: document(2027),
    })
  })

  it('минутный таймер записывает обновлённый документ, сохраняя основной файл', async () => {
    await invoke({ action: 'save', document: document(2026), saveAs: false })
    await stop()
    vi.useFakeTimers()
    const ipc: IpcMainLike = {
      handle: (_name, fn) => {
        listener = fn
      },
    }
    stop = registerPlanFileHandlers(ipc, dialogs, '0.1.0')
    await invoke({ action: 'open' })
    await invoke({ action: 'update', document: document(2027) })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await invoke({ action: 'state' })).toMatchObject({
      status: 'ok',
      recovery: document(2027),
    })
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { year: 2026 },
    })
  })
})
