const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Сущности XML и HTML: &amp;, &#1040;, &#x41;, &nbsp;. */
export function decodeEntities(s: string): string {
  return s.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X'))
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)))
    return NAMED[code.toLowerCase()] ?? whole
  })
}

/** Экранирование символов в строках OOXML: «_x000D_» → «\r». */
export function decodeOoxmlEscapes(s: string): string {
  return s.replaceAll(/_x([0-9A-Fa-f]{4})_/gu, (_, hex: string) =>
    String.fromCodePoint(Number.parseInt(hex, 16)),
  )
}

/** Атрибуты открывающего тега: name="value" или name='value'. */
export function attributes(tag: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/gu)) {
    const [, name, , dq, sq] = m
    if (name) out.set(name, decodeEntities(dq ?? sq ?? ''))
  }
  return out
}
