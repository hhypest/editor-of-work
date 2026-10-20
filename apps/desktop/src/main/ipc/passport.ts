import { channels, type ResponseOf } from '@eow/ipc/contracts'
import type { PassportStore } from '@eow/passport/application'
import { registerHandler, type IpcMainLike } from './register'

export function registerPassportHandlers(ipc: IpcMainLike, store: PassportStore): void {
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
