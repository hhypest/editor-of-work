import { zlibSync } from 'fflate'
import { FICTIONAL_GLYPH_WIDTH, type FictionalScheme } from '@eow/import/application/testing'

/**
 * PDF вымышленной схемы в том виде, в каком его пишет PDFsharp у ЕК АСУИ: перевёрнутая ось y,
 * масштаб единиц схемы через `cm`, текст с `Tz -100` и отрицательным кеглем, шрифт Type0
 * Identity-H с картой ToUnicode, сжатые потоки и классическая таблица ссылок.
 */
export function fictionalSchemePdf(
  scheme: FictionalScheme,
  options: { compress?: boolean } = {},
): Uint8Array {
  const compress = options.compress ?? true
  const chars = [...new Set(scheme.commands.flatMap((c) => (c.kind === 'text' ? [...c.text] : [])))]
  const gid = new Map(chars.map((ch, i) => [ch, i + 1]))
  const hex = (n: number, digits = 4) => n.toString(16).padStart(digits, '0')
  const f = (n: number) => Number(n.toFixed(4)).toString()
  const ops: string[] = [
    `1 0 0 -1 0 ${f(scheme.height)} cm -100 Tz`,
    `q ${f(scheme.scale)} 0 0 ${f(scheme.scale)} ${f(scheme.offset[0])} ${f(scheme.offset[1])} cm`,
  ]
  for (const c of scheme.commands) {
    const [r, g, b] = c.color
    if (c.kind === 'line') {
      const [first, ...rest] = c.points
      if (!first) continue
      ops.push(
        `${f(c.width)} w [${(c.dash ?? []).map(f).join(' ')}]0 d ${f(r)} ${f(g)} ${f(b)} RG`,
        `${f(first[0])} ${f(first[1])} m ${f(first[0])} ${f(first[1])} l`,
        ...rest.map(([x, y]) => `${f(x)} ${f(y)} l`),
        'S',
      )
      continue
    }
    const a = ((c.angle ?? 0) * Math.PI) / 180
    const codes = [...c.text].map((ch) => hex(gid.get(ch) ?? 0)).join('')
    ops.push(
      `q ${f(Math.cos(a))} ${f(Math.sin(a))} ${f(-Math.sin(a))} ${f(Math.cos(a))} ${f(c.x)} ${f(c.y)} cm`,
      `BT ${f(r)} ${f(g)} ${f(b)} rg /F0 ${f(-c.size)} Tf 0 0 Td <${codes}> Tj ET Q`,
    )
  }
  ops.push('Q')
  const content = new TextEncoder().encode(ops.join('\n'))
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    `${chars.length} beginbfchar`,
    ...chars.map((ch) => `<${hex(gid.get(ch) ?? 0)}> <${hex(ch.charCodeAt(0))}>`),
    'endbfchar endcmap end end',
  ].join('\n')
  const width = Math.round(FICTIONAL_GLYPH_WIDTH * 1000)
  const objects: (string | { dict: string; data: Uint8Array })[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(scheme.width)} ${f(scheme.height)}] /Resources << /Font << /F0 5 0 R >> >> /Contents 4 0 R >>`,
    stream(content, compress),
    '<< /Type /Font /Subtype /Type0 /BaseFont /Fictional /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 7 0 R >>',
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Fictional /DW ${width} /W [1 [${chars.map(() => width).join(' ')}]] >>`,
    stream(new TextEncoder().encode(cmap), compress),
  ]
  return assemble(objects)
}

function stream(data: Uint8Array, compress: boolean): { dict: string; data: Uint8Array } {
  const body = compress ? zlibSync(data) : data
  return {
    dict: `<< /Length ${body.length}${compress ? ' /Filter /FlateDecode' : ''} >>`,
    data: body,
  }
}

function assemble(objects: readonly (string | { dict: string; data: Uint8Array })[]): Uint8Array {
  const parts: Uint8Array[] = []
  const enc = new TextEncoder()
  let size = 0
  const push = (p: Uint8Array) => {
    parts.push(p)
    size += p.length
  }
  push(enc.encode('%PDF-1.4\n'))
  const offsets: number[] = []
  objects.forEach((o, i) => {
    offsets.push(size)
    if (typeof o === 'string') push(enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`))
    else {
      push(enc.encode(`${i + 1} 0 obj\n${o.dict}\nstream\n`))
      push(o.data)
      push(enc.encode('\nendstream\nendobj\n'))
    }
  })
  const xref = size
  push(
    enc.encode(
      [
        'xref',
        `0 ${objects.length + 1}`,
        '0000000000 65535 f ',
        ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `),
        'trailer',
        `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
        'startxref',
        String(xref),
        '%%EOF',
      ].join('\n'),
    ),
  )
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
