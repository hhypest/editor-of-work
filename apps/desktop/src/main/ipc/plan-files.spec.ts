import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
    open: vi.fn<() => Promise<string | undefined>>(),
    save: vi.fn<() => Promise<string | undefined>>(),
  }
  const invoke = async (request: RequestOf<typeof channels.planFile>) =>
    channels.planFile.response.parse(await listener({}, request))

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'eow-main-'))
    path = join(directory, 'test.ppr.json')
    dialogs.open.mockReset().mockResolvedValue(path)
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
