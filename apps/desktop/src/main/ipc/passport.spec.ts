import { describe, expect, it, vi } from 'vitest'
import { channels } from '@eow/ipc/contracts'
import type { PassportBackups, PassportStore } from '@eow/passport/application'
import { err, ok } from '@eow/shared/kernel'
import { registerPassportHandlers } from './passport'
import type { IpcMainLike } from './register'

const edition = {
  id: 1,
  number: 1,
  date: '2027-01-01',
  label: 'Учебная редакция',
  status: 'draft',
} as const
const backup = {
  id: 'passport-activation-2026-10-28T07-05-09.123Z-00000000-0000-4000-8000-000000000000.sqlite',
  reason: 'activation',
  createdAt: '2026-10-28T07:05:09.123Z',
  bytes: 4096,
  editions: [{ number: 1, date: '2027-01-01', label: 'Учебная редакция', status: 'draft' }],
} as const
function setup() {
  const store: PassportStore & PassportBackups = {
    backups: vi.fn<PassportBackups['backups']>(async () => ok([backup])),
    restoreBackup: vi.fn<PassportBackups['restoreBackup']>(async () => ok(undefined)),
    list: vi.fn<PassportStore['list']>(async () => ok([edition])),
    createDraft: vi.fn<PassportStore['createDraft']>(async () => ok(edition)),
    activate: vi.fn<PassportStore['activate']>(async () =>
      ok({ ...edition, status: 'active' } as const),
    ),
  }
  let handler: ((event: unknown, ...args: unknown[]) => unknown) | undefined
  const ipc: IpcMainLike = {
    handle: (name, listener) => {
      expect(name).toBe(channels.passport.name)
      handler = listener
    },
  }
  registerPassportHandlers(ipc, store)
  return { store, invoke: async (request: unknown) => handler!(undefined, request) }
}

describe('IPC редакций паспорта', () => {
  it('возвращает список DTO и передаёт только дату и название нового черновика', async () => {
    const { store, invoke } = setup()
    expect(await invoke({ action: 'list' })).toEqual({ status: 'ok', editions: [edition] })
    expect(
      await invoke({ action: 'createDraft', date: edition.date, label: edition.label }),
    ).toMatchObject({ status: 'ok' })
    expect(store.createDraft).toHaveBeenCalledWith({ date: edition.date, label: edition.label })
    await invoke({ action: 'activate', id: edition.id })
    expect(store.activate).toHaveBeenCalledWith(edition.id)
  })
  it('показывает копии и после восстановления возвращает редакции восстановленной базы', async () => {
    const { store, invoke } = setup()
    expect(await invoke({ action: 'backups' })).toEqual({
      status: 'ok',
      editions: [edition],
      backups: [backup],
    })
    expect(await invoke({ action: 'restoreBackup', id: backup.id })).toEqual({
      status: 'ok',
      editions: [edition],
    })
    expect(store.restoreBackup).toHaveBeenCalledExactlyOnceWith(backup.id)
    vi.mocked(store.restoreBackup).mockResolvedValueOnce(
      err({ kind: 'not-found', message: 'Резервная копия не найдена.' }),
    )
    expect(await invoke({ action: 'restoreBackup', id: 'x.sqlite' })).toEqual({
      status: 'error',
      message: 'Резервная копия не найдена.',
    })
  })
  it.each([
    { action: 'list', path: 'arbitrary.sqlite' },
    { action: 'restoreBackup', id: '' },
    { action: 'restoreBackup', id: 'x'.repeat(201) },
    { action: 'backups', path: 'C:/data' },
    { action: 'activate', id: -1 },
    { action: 'activate', id: 1.5 },
    { action: 'createDraft', date: '2027-02-30', label: 'Учебная' },
    { action: 'createDraft', date: edition.date, label: 'x'.repeat(201) },
  ])('отклоняет неправильный запрос до обращения к базе', async (request) => {
    const { store, invoke } = setup()
    await expect(invoke(request)).rejects.toThrow('неверный запрос')
    expect(store.list).not.toHaveBeenCalled()
    expect(store.createDraft).not.toHaveBeenCalled()
    expect(store.activate).not.toHaveBeenCalled()
    expect(store.restoreBackup).not.toHaveBeenCalled()
  })
  it('возвращает пользователю ошибку хранилища без данных базы', async () => {
    const { store, invoke } = setup()
    const failure = err({ kind: 'storage', message: 'Не удалось создать копию.' } as const)
    vi.mocked(store.activate).mockResolvedValue(failure)
    expect(await invoke({ action: 'activate', id: 1 })).toEqual({
      status: 'error',
      message: failure.error.message,
    })
    expect(store.list).not.toHaveBeenCalled()
    vi.mocked(store.createDraft).mockResolvedValue(failure)
    expect(
      await invoke({ action: 'createDraft', date: edition.date, label: edition.label }),
    ).toMatchObject({ status: 'error' })
    vi.mocked(store.list).mockResolvedValue(failure)
    expect(await invoke({ action: 'list' })).toMatchObject({ status: 'error' })
  })
})
