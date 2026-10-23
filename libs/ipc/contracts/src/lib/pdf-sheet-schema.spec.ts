import { channels } from './channels'
import { pdfSheetSchema } from './pdf-sheet-schema'
const mm = (value: number) => ({ unit: 'mm', value })
const page = {
  number: 1,
  width: mm(420),
  height: mm(297),
  primitives: [
    {
      kind: 'text',
      x: mm(10),
      y: mm(20),
      text: 'Учебный <script>текст</script>',
      font: { family: 'PT Sans', size: mm(4), weight: 400 },
    },
  ],
}
describe('PDF IPC', () => {
  it('передаёт только готовую страницу А3 и ревизию, без пути, HTML и zoom', () => {
    const request = { action: 'exportEditorSheet', revision: 2, pd: 'a', page }
    expect(channels.planFile.request.safeParse(request).success).toBe(true)
    for (const patch of [
      { path: 'C:/private' },
      { zoom: 0.5 },
      { html: '<svg />' },
      { pd: '' },
      { revision: -1 },
    ])
      expect(channels.planFile.request.safeParse({ ...request, ...patch }).success).toBe(false)
    expect(channels.printHost.request.safeParse({ action: 'ready', page }).success).toBe(false)
  })
  it('ограничивает размер, координаты, шрифты и формы примитивов', () => {
    for (const patch of [
      { width: mm(297) },
      { number: 201 },
      { number: 0 },
      { height: mm(NaN) },
      { primitives: [{ kind: 'script', text: 'code' }] },
      { primitives: [{ ...page.primitives[0], x: mm(Infinity) }] },
      { primitives: [{ ...page.primitives[0], x: mm(-1) }] },
      {
        primitives: [
          { ...page.primitives[0], font: { family: 'remote', weight: 400, size: mm(4) } },
        ],
      },
      { primitives: [{ ...page.primitives[0], text: 'x'.repeat(10001) }] },
      { primitives: Array.from({ length: 20001 }, () => page.primitives[0]) },
      {
        primitives: Array.from({ length: 500 }, () => ({
          ...page.primitives[0],
          text: 'x'.repeat(10000),
        })),
      },
    ])
      expect(pdfSheetSchema.safeParse({ ...page, ...patch }).success).toBe(false)
  })
})
