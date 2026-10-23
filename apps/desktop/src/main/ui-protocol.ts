import { net, protocol } from 'electron'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_SCHEME, contentSecurityPolicy, resolveAppFile } from './security'

/** Общая выдача ресурсов для основного окна и изолированного окна PDF. */
export function registerUiProtocol(root: string): void {
  const csp = contentSecurityPolicy()
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppFile(request.url, root, join, sep)
    if (!file) return new Response('Not found', { status: 404 })
    const response = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', csp)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(response.body, { status: response.status, headers })
  })
}
