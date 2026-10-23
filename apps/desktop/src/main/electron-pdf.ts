import { BrowserWindow } from 'electron'
import type { IpcMainLike } from './ipc/register'
import { createPdfRenderer } from './pdf-renderer'
import { isAllowedNavigation, secureWebPreferences } from './security'

export function electronPdfRenderer(ipc: IpcMainLike, preload: string, startUrl: string) {
  const url = new URL(startUrl)
  url.searchParams.set('print', '1')
  url.hash = ''
  return createPdfRenderer(
    ipc,
    () => {
      const win = new BrowserWindow({
        show: false,
        width: 1600,
        height: 1200,
        webPreferences: { ...secureWebPreferences(preload), backgroundThrottling: false },
      })
      win.webContents.on('will-navigate', (event, target) => {
        if (!isAllowedNavigation(target, startUrl)) event.preventDefault()
      })
      win.webContents.on('will-attach-webview', (event) => event.preventDefault())
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      return win
    },
    url.toString(),
  )
}
