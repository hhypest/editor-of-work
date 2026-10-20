import { join, sep } from 'node:path'
import {
  APP_ORIGIN,
  contentSecurityPolicy,
  isAllowedNavigation,
  resolveAppFile,
  secureWebPreferences,
} from './security'

describe('настройки окна', () => {
  it('renderer изолирован от Node', () => {
    const prefs = secureWebPreferences('/app/preload.js')
    expect(prefs).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    })
  })
})

describe('CSP', () => {
  it('в рабочем режиме разрешает только свой источник', () => {
    const csp = contentSecurityPolicy()
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain('http')
  })

  it('в режиме разработки добавляет dev-сервер и его websocket', () => {
    const csp = contentSecurityPolicy('http://localhost:4200')
    expect(csp).toContain("script-src 'self' http://localhost:4200")
    expect(csp).toContain('ws://localhost:4200')
  })
})

describe('навигация', () => {
  it('разрешена внутри своего источника', () => {
    expect(isAllowedNavigation(`${APP_ORIGIN}/passport`, APP_ORIGIN)).toBe(true)
  })

  it('запрещена на внешние адреса и другие схемы', () => {
    expect(isAllowedNavigation('https://example.com/', APP_ORIGIN)).toBe(false)
    expect(isAllowedNavigation('file:///C:/Windows/', APP_ORIGIN)).toBe(false)
    expect(isAllowedNavigation('app://other/', APP_ORIGIN)).toBe(false)
    expect(isAllowedNavigation('не адрес', APP_ORIGIN)).toBe(false)
  })
})

describe('файлы интерфейса по app://', () => {
  const root = join(sep, 'opt', 'eow', 'ui')

  it('корень отдаёт index.html', () => {
    expect(resolveAppFile('app://ui/', root, join, sep)).toBe(join(root, 'index.html'))
  })

  it('отдаёт файлы внутри папки интерфейса', () => {
    expect(resolveAppFile('app://ui/main-ABC.js', root, join, sep)).toBe(join(root, 'main-ABC.js'))
  })

  it('не выпускает за пределы папки', () => {
    const attempts = [
      'app://ui/../secret.txt',
      'app://ui/%2e%2e/%2e%2e/secret.txt',
      'app://ui/a/..%5C..%5C..%5Csecret.txt',
      'app://ui/%00index.html',
    ]
    const escaped = attempts
      .map((url) => resolveAppFile(url, root, join, sep))
      .filter((file) => file !== null && !file.startsWith(root + sep))
    expect(escaped).toEqual([])
    expect(resolveAppFile('app://ui/a/..%5C..%5Csecret.txt', root, join, sep)).toBeNull()
  })

  it('отклоняет чужой хост и схему', () => {
    expect(resolveAppFile('app://other/index.html', root, join, sep)).toBeNull()
    expect(resolveAppFile('file:///etc/passwd', root, join, sep)).toBeNull()
  })
})
