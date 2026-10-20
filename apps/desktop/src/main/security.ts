/**
 * Политика безопасности окон Electron (docs/architecture.md, раздел 12).
 * Модуль не импортирует electron, чтобы его можно было проверять тестами.
 */

/** Схема, по которой main отдаёт собранный интерфейс: app://ui/… */
export const APP_SCHEME = 'app'
export const APP_HOST = 'ui'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

export interface SecureWebPreferences {
  readonly preload: string
  readonly contextIsolation: true
  readonly nodeIntegration: false
  readonly nodeIntegrationInWorker: false
  readonly nodeIntegrationInSubFrames: false
  readonly sandbox: true
  readonly webSecurity: true
  readonly allowRunningInsecureContent: false
  readonly webviewTag: false
  readonly spellcheck: false
}

export function secureWebPreferences(preloadPath: string): SecureWebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
  }
}

/**
 * Content-Security-Policy. Стили Angular вставляются тегами <style>,
 * поэтому style-src допускает 'unsafe-inline'; скрипты — только свои.
 * В режиме разработки разрешено соединение с dev-сервером (перезагрузка).
 */
export function contentSecurityPolicy(devServerOrigin?: string): string {
  const self = devServerOrigin ? `'self' ${devServerOrigin}` : "'self'"
  const connect = devServerOrigin
    ? `'self' ${devServerOrigin} ${devServerOrigin.replace(/^http/, 'ws')}`
    : "'self'"
  return [
    "default-src 'self'",
    `script-src ${self}`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:`,
    `font-src ${self} data:`,
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
  ].join('; ')
}

/** Можно ли окну перейти по адресу: только внутри своего источника. */
export function isAllowedNavigation(url: string, allowedOrigin: string): boolean {
  try {
    const target = new URL(url)
    const allowed = new URL(allowedOrigin)
    // Сравниваем схему, хост и порт явно: у нестандартных схем (app:, file:) origin равен "null".
    return (
      target.protocol === allowed.protocol && target.host === allowed.host && target.host !== ''
    )
  } catch {
    return false
  }
}

/**
 * Путь к файлу интерфейса для запроса app://ui/… .
 * Возвращает null, если путь выходит за папку интерфейса.
 */
export function resolveAppFile(
  url: string,
  uiRoot: string,
  join: (...p: string[]) => string,
  sep: string,
): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return null
  const decoded = decodeURIComponent(parsed.pathname)
  if (decoded.includes('\0')) return null
  const relative = decoded.replace(/^\/+/, '') || 'index.html'
  const parts = relative.split(/[\\/]+/)
  if (parts.some((p) => p === '..')) return null
  const file = join(uiRoot, ...parts)
  const root = uiRoot.endsWith(sep) ? uiRoot : uiRoot + sep
  return file.startsWith(root) ? file : null
}
