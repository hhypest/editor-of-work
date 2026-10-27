import { InjectionToken } from '@angular/core'
import type { EowApi } from '@eow/ipc/contracts'

/** Версия продукта и формата плана для шапки окна и сообщений об ошибках. */
export interface AppInfo {
  readonly version: string
  readonly planFormat: number
}
/** null — программа открыта вне Electron (разработка интерфейса) или main не ответил. */
export type AppInfoSource = () => Promise<AppInfo | null>
export const APP_INFO = new InjectionToken<AppInfoSource>('Сведения о программе')

export function appInfoSource(api: EowApi | undefined): AppInfoSource {
  return async () => {
    if (!api) return null
    try {
      const info = await api.appInfo({})
      return { version: info.version, planFormat: info.planFormat }
    } catch {
      return null
    }
  }
}
