import { channels, type ResponseOf } from '@eow/ipc/contracts'
import type { PassportBackups, PassportStore } from '@eow/passport/application'
import { registerHandler, type IpcMainLike } from './register'

export function registerPassportHandlers(
  ipc: IpcMainLike,
  store: PassportStore & PassportBackups,
): void {
  registerHandler(
    ipc,
    channels.passport,
    async (request): Promise<ResponseOf<typeof channels.passport>> => {
      switch (request.action) {
        case 'createDraft': {
          const result = await store.createDraft({ date: request.date, label: request.label })
          if (!result.ok) return { status: 'error', message: result.error.message }
          break
        }
        case 'activate': {
          const result = await store.activate(request.id)
          if (!result.ok) return { status: 'error', message: result.error.message }
          break
        }
        case 'backups': {
          const [backups, editions] = [await store.backups(), await store.list()]
          if (!backups.ok) return { status: 'error', message: backups.error.message }
          if (!editions.ok) return { status: 'error', message: editions.error.message }
          return {
            status: 'ok',
            editions: [...editions.value],
            backups: backups.value.map((b) => ({ ...b, editions: [...b.editions] })),
          }
        }
        case 'restoreBackup': {
          const result = await store.restoreBackup(request.id)
          if (!result.ok) return { status: 'error', message: result.error.message }
          break
        }
        case 'list':
          break
      }
      const result = await store.list()
      return result.ok
        ? { status: 'ok', editions: [...result.value] }
        : { status: 'error', message: result.error.message }
    },
  )
}
