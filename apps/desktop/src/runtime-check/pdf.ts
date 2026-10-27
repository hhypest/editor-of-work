import { BrowserWindow, ipcMain, protocol } from 'electron'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { mm, type SheetPage } from '@eow/documents/application'
import { electronPdfRenderer } from '../main/electron-pdf'
import { registerUiProtocol } from '../main/ui-protocol'
import { APP_ORIGIN, APP_SCHEME } from '../main/security'
import type { IpcMainLike } from '../main/ipc/register'

// Вызывается до app.whenReady, как в production main.
export function registerPdfProbeScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ])
}
export async function checkPdf(): Promise<{
  pages: number
  widthMm: number
  heightMm: number
  embeddedFonts: number
  svgMatches: boolean
}> {
  registerUiProtocol(join(__dirname, 'ui'))
  const page: SheetPage = {
    number: 7,
    width: mm(420),
    height: mm(297),
    primitives: [
      { kind: 'line', x1: mm(10), y1: mm(10), x2: mm(410), y2: mm(10), dashed: false },
      {
        kind: 'rect',
        x: mm(10),
        y: mm(15),
        width: mm(400),
        height: mm(40),
        shade: true,
        border: true,
      },
      { kind: 'circle', x: mm(30), y: mm(70), radius: mm(3) },
      ...(['PT Sans', 'PT Sans Narrow'] as const).flatMap((family, i) =>
        ([400, 700] as const).map((weight, j) => ({
          kind: 'text' as const,
          x: mm(15),
          y: mm(25 + 7 * (i * 2 + j)),
          text: `Учебный лист ${family} ${weight} <script>обычный текст</script>`,
          font: { family, weight, size: mm(4) },
        })),
      ),
    ],
  }
  let inspected = false
  const ipc: IpcMainLike = {
    handle(name, handler) {
      ipcMain.handle(name, async (event, ...args: unknown[]) => {
        if (
          args.some(
            (arg) =>
              typeof arg === 'object' && arg !== null && 'action' in arg && arg.action === 'ready',
          )
        ) {
          const view: {
            width: string
            height: string
            viewBox: string
            text: string[]
            primitives: number
            sheets: number
            fonts: string
            nav: boolean
            scripts: number
            nodeAccess: boolean
          } = await event.sender.executeJavaScript(`(() => {
            const svg = document.querySelector('svg');
            return { width: svg?.getAttribute('width'), height: svg?.getAttribute('height'), viewBox: svg?.getAttribute('viewBox'),
              text: [...document.querySelectorAll('svg text')].map(t => t.textContent.trim()),
              primitives: svg?.querySelector('g').children.length, sheets: document.querySelectorAll('svg').length,
              fonts: document.fonts.status,
              nav: !!document.querySelector('nav'), scripts: document.querySelectorAll('svg script').length,
              nodeAccess: typeof require !== 'undefined' || typeof process !== 'undefined' };
          })()`)
          assert.equal(view.width, '420mm')
          assert.equal(view.height, '297mm')
          assert.equal(view.viewBox, '0 0 420 297')
          const texts = page.primitives.filter((p) => p.kind === 'text').map((p) => p.text)
          assert.deepEqual(view.text, [...texts, ...texts])
          assert.equal(view.sheets, 2)
          assert.equal(view.primitives, page.primitives.length)
          assert.equal(view.fonts, 'loaded')
          assert.equal(view.nav, false)
          assert.equal(view.scripts, 0)
          assert.equal(view.nodeAccess, false)
          inspected = true
        }
        return handler(event, ...args)
      })
    },
  }
  const render = electronPdfRenderer(ipc, join(__dirname, 'preload.js'), `${APP_ORIGIN}/`)
  // Два листа одним вызовом printToPDF: пакетный PDF (ADR-0039).
  const data = await render([page, { ...page, number: 8 }])
  assert.equal(inspected, true, 'Нужна реальная отрисовка Angular, а не пустой PDF')
  assert.equal(BrowserWindow.getAllWindows().length, 0, 'Окно печати должно быть освобождено')
  const pdf = await PDFDocument.load(data)
  assert.equal(pdf.getPageCount(), 2, 'Каждый лист — одна страница, без пустой последней')
  const sizes = pdf.getPages().map((p) => p.getSize())
  const first = pdf.getPage(0).getSize()
  const widthMm = (first.width * 25.4) / 72,
    heightMm = (first.height * 25.4) / 72
  for (const sheet of sizes)
    assert.ok(
      Math.abs((sheet.width * 25.4) / 72 - 420) < 0.5 &&
        Math.abs((sheet.height * 25.4) / 72 - 297) < 0.5,
      'Требуется А3 альбом на каждой странице',
    )
  const fonts: string[] = []
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFDict &&
      object.get(PDFName.of('Type'))?.toString() === '/FontDescriptor'
    ) {
      const embedded = object.lookup(PDFName.of('FontFile2'))
      assert.ok(embedded instanceof PDFRawStream, 'Шрифт должен быть встроен')
      fonts.push(object.get(PDFName.of('FontName'))?.toString() ?? '')
    }
  }
  for (const suffix of ['PTSans-Regular', 'PTSans-Bold', 'PTSans-Narrow', 'PTSans-NarrowBold'])
    assert.ok(
      fonts.some((name) => name.endsWith(suffix)),
      `Нет встроенного ${suffix}`,
    )
  return { pages: 2, widthMm, heightMm, embeddedFonts: fonts.length, svgMatches: true }
}
