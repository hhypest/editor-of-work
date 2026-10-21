import type { ExportFileKind } from '@eow/import/application'

const startsWith = (bytes: Uint8Array, sig: readonly number[]): boolean =>
  sig.every((b, i) => bytes[i] === b)

/** Начало файла как текст, без метки порядка байтов. */
export function headText(bytes: Uint8Array, length = 65_536): string {
  const start = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start, start + length))
}

/**
 * Тип файла по содержимому, а не по расширению: «веб-страничный» xls — это HTML,
 * а у настоящих выгрузок расширение бывает и .xls, и .XLSX.
 */
export function detectFileKind(bytes: Uint8Array): ExportFileKind {
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'xlsx'
  // Составной документ OLE: двоичный xls Excel 97–2003.
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'binary-xls'
  const head = headText(bytes).trimStart().toLowerCase()
  if (!head.startsWith('<')) return 'unknown'
  if (/<frameset\b/u.test(head) || /<x:worksheetsource\b/u.test(head)) return 'frameset'
  return /<html\b|<table\b/u.test(head) ? 'web-xls' : 'unknown'
}
