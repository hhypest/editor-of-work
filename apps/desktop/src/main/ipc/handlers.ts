import { channels } from '@eow/ipc/contracts'
import { registerHandler, type IpcMainLike } from './register'

export interface AppInfoSource {
  getName(): string
  getVersion(): string
}

/** Регистрирует все обработчики IPC. Composition root адаптеров main. */
export function registerIpcHandlers(ipc: IpcMainLike, app: AppInfoSource): void {
  registerHandler(ipc, channels.appInfo, () => ({ name: app.getName(), version: app.getVersion() }))
}
