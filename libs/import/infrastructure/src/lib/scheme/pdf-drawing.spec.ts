import { describe, expect, it } from 'vitest'
import { zlibSync } from 'fflate'
import { fictionalDrawing, fictionalScheme } from '@eow/import/application/testing'
import { recognizeScheme } from '@eow/import/application'
import { fictionalSchemePdf } from '../testing/scheme/scheme-pdf'
import { readSchemeDrawing } from './pdf-drawing'
import { PDF_LIMITS, PdfFile } from './pdf-file'
import { parseToUnicode } from './pdf-font'

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 2)

describe('Чтение PDF схемы станции', () => {
  const scheme = fictionalScheme()
  const expected = fictionalDrawing(scheme)

  it('переводит линии в пункты листа с осью y вниз', () => {
    const drawing = readSchemeDrawing(fictionalSchemePdf(scheme))
    expect(drawing.width).toBe(scheme.width)
    expect(drawing.paths).toHaveLength(expected.paths.length)
    drawing.paths.forEach((p, i) => {
      const e = expected.paths[i]!
      close(p.width, e.width)
      expect(p.stroke).toEqual(e.stroke)
      expect(p.dash.length).toBe(e.dash.length)
      const first = p.subpaths[0]![0]!,
        want = e.subpaths[0]![0]!
      close(first.x, want.x)
      close(first.y, want.y)
    })
  })

  it('читает текст через ToUnicode с перевёрнутым кеглем и поворотом', () => {
    const drawing = readSchemeDrawing(fictionalSchemePdf(scheme))
    const title = drawing.texts.find((t) => t.text === 'ст.Озёрная')!
    const want = expected.texts.find((t) => t.text === 'ст.Озёрная')!
    expect(title.color).toEqual(want.color)
    close(title.origin.x, want.origin.x)
    close(title.origin.y, want.origin.y)
    close(title.size, want.size)
    close(title.width, want.width)
    close(title.angle, 0)
    const crossing = drawing.texts.find((t) => t.text.startsWith('переезд'))!
    close(crossing.angle, -Math.PI / 2)
  })

  it('убирает пробелы по краям подписи и сдвигает её начало', () => {
    const padded = {
      ...scheme,
      commands: [
        { kind: 'text', text: '  3 ав', x: 100, y: 100, size: 50, color: [0, 0, 0] } as const,
      ],
    }
    const [text] = readSchemeDrawing(fictionalSchemePdf(padded)).texts
    expect(text?.text).toBe('3 ав')
    close(text!.origin.x, scheme.offset[0] + (100 + 2 * 30) * scheme.scale)
  })

  it('читает несжатые потоки так же, как сжатые', () => {
    const plain = readSchemeDrawing(fictionalSchemePdf(scheme, { compress: false }))
    expect(plain.texts.map((t) => t.text)).toEqual(expected.texts.map((t) => t.text))
  })

  it('распознаёт станцию по прочитанному PDF так же, как по чертежу', () => {
    const fromPdf = recognizeScheme(readSchemeDrawing(fictionalSchemePdf(scheme)))
    const direct = recognizeScheme(expected)
    expect(fromPdf.ok && direct.ok).toBe(true)
    if (!fromPdf.ok || !direct.ok) return
    expect(fromPdf.value.tracks.map((t) => t.number)).toEqual(
      direct.value.tracks.map((t) => t.number),
    )
    expect(fromPdf.value.switches.map((s) => s.number)).toEqual(
      direct.value.switches.map((s) => s.number),
    )
  })

  it('отклоняет файл без заголовка PDF', () => {
    expect(() => readSchemeDrawing(new TextEncoder().encode('<html></html>'))).toThrow(
      'не является PDF',
    )
  })

  it('отклоняет PDF без таблицы ссылок', () => {
    expect(() =>
      readSchemeDrawing(new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n')),
    ).toThrow('startxref')
  })

  it('отклоняет зашифрованный PDF', () => {
    const pdf = new TextDecoder('latin1').decode(fictionalSchemePdf(scheme, { compress: false }))
    const encrypted = pdf.replace('/Root 1 0 R', '/Root 1 0 R /Encrypt 1 0 R')
    expect(() => readSchemeDrawing(Uint8Array.from(encrypted, (c) => c.charCodeAt(0)))).toThrow(
      'Зашифрованные',
    )
  })

  it('останавливает распаковку потока сверх лимита', () => {
    const bomb = zlibSync(new Uint8Array(4096))
    const header = '%PDF-1.4\n'
    const obj = `1 0 obj\n<< /Length ${bomb.length} /Filter /FlateDecode >>\nstream\n`
    const tail = '\nendstream\nendobj\n'
    const xrefAt = header.length + obj.length + bomb.length + tail.length
    const xref = `xref\n0 2\n0000000000 65535 f \n${String(header.length).padStart(10, '0')} 00000 n \ntrailer\n<< /Size 2 >>\nstartxref\n${xrefAt}\n%%EOF`
    const enc = new TextEncoder()
    const bytes = new Uint8Array([...enc.encode(header + obj), ...bomb, ...enc.encode(tail + xref)])
    const file = new PdfFile(bytes, { ...PDF_LIMITS, streamBytes: 1024 })
    expect(() => file.stream({ kind: 'ref', num: 1, gen: 0 })).toThrow('32 МиБ')
  })

  it('разбирает диапазоны bfrange карты ToUnicode', () => {
    const cmap = new TextEncoder().encode(
      'begincodespacerange <0000> <FFFF> endcodespacerange\n1 beginbfrange <0010> <0012> <0410> endbfrange',
    )
    const { map, codeBytes } = parseToUnicode(cmap)
    expect(codeBytes).toBe(2)
    expect([map.get(0x10), map.get(0x12)]).toEqual(['А', 'В'])
  })
})
