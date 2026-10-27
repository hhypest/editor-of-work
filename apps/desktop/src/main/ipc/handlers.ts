import { channels } from '@eow/ipc/contracts'
import { PLAN_FORMAT_VERSION } from '@eow/planning/infrastructure'
import { registerHandler, type IpcMainLike } from './register'

export interface AppInfoSource {
  getName(): string
  getVersion(): string
}

/** Регистрирует все обработчики IPC. Composition root адаптеров main. */
export function registerIpcHandlers(ipc: IpcMainLike, app: AppInfoSource): void {
  registerHandler(ipc, channels.appInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    planFormat: PLAN_FORMAT_VERSION,
  }))
}
