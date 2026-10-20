import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerIpcHandlers } from './ipc/handlers';
import {
  APP_ORIGIN,
  APP_SCHEME,
  contentSecurityPolicy,
  isAllowedNavigation,
  resolveAppFile,
  secureWebPreferences,
} from './security';

const devServerUrl = process.env['EOW_DEV_SERVER_URL'];
const startUrl = devServerUrl ?? `${APP_ORIGIN}/`;
const devOrigin = devServerUrl ? new URL(devServerUrl).origin : undefined;

/** Папка собранного интерфейса: в установленной программе — resources/ui, при разработке — dist. */
function uiRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'ui') : resolve(__dirname, '../ui/browser');
}

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol(): void {
  const root = uiRoot();
  const csp = contentSecurityPolicy();
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppFile(request.url, root, join, sep);
    if (!file) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString());
    // Заголовок CSP ставится здесь: webRequest не обрабатывает ответы собственных схем.
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', csp);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  });
}

function applySecurity(): void {
  const csp = contentSecurityPolicy(devOrigin);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
  });
  // Разрешений (камера, геолокация, уведомления) программе не нужно.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url, devOrigin ?? APP_ORIGIN)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'editor-of-work',
    webPreferences: secureWebPreferences(join(__dirname, 'preload.js')),
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(startUrl);
  return win;
}

// Второй экземпляр программы не запускается: фокус уходит в уже открытое окно.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    applySecurity();
    registerAppProtocol();
    registerIpcHandlers(ipcMain, app);
    createMainWindow();
  });

  app.on('window-all-closed', () => app.quit());
}

