import { channels } from '@eow/ipc/contracts'
import type { PassportEditionData } from '@eow/passport/application'
import { registerHandler, type IpcMainLike } from './register'

export function registerPassportDataHandlers(ipc: IpcMainLike, store: PassportEditionData): void {
  registerHandler(ipc, channels.passportData, async ({ editionId }) => {
    const result = await store.editionData(editionId)
    return channels.passportData.response.parse(
      result.ok
        ? { status: 'ok', data: result.value }
        : { status: 'error', message: result.error.message },
    )
  })
}
