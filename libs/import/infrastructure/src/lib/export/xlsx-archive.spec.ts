import { strToU8, Zip, ZipDeflate, zipSync } from 'fflate'
import { XlsxArchive, XLSX_LIMITS } from './xlsx-archive'

/** Change sizes without allocating the declared output; all content is fictitious. */
function sizes(bytes: Uint8Array, size: number, local = true): Uint8Array {
  const out = bytes.slice()
  const view = new DataView(out.buffer)
  for (let i = 0; i + 46 <= out.length; i++) {
    const signature = view.getUint32(i, true)
    if (local && signature === 0x04034b50) view.setUint32(i + 22, size, true)
    if (signature === 0x02014b50) view.setUint32(i + 24, size, true)
  }
  return out
}

function streamed(parts: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const zip = new Zip((error, chunk) => {
    if (error) throw error
    chunks.push(chunk)
  })
  for (const part of parts) {
    const file = new ZipDeflate(part.name)
    zip.add(file)
    file.push(part.data, true)
  }
  zip.end()
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

describe('Бюджет распаковки xlsx', () => {
  it('принимает точную границу части и общий бюджет между проходами, включая несжатые части', () => {
    const archive = new XlsxArchive(
      zipSync({ meta: strToU8('12345678'), sheet: strToU8('аб') }, { level: 0 }),
      { ...XLSX_LIMITS, partBytes: 8, totalBytes: 12 },
    )
    expect(archive.read((p) => p === 'meta').get('meta')).toEqual(strToU8('12345678'))
    expect(archive.read((p) => p === 'sheet').get('sheet')).toEqual(strToU8('аб'))
  })

  it('отклоняет огромный заявленный размер до выделения буфера', () => {
    const bytes = sizes(zipSync({ sheet: strToU8('маленький файл') }), 0x7fffffff)
    expect(bytes.length).toBeLessThan(1024)
    expect(() => new XlsxArchive(bytes).read(() => true)).toThrow('лимит 32 МиБ')
  })

  it('складывает размеры метаданных и листов в один бюджет', () => {
    const archive = new XlsxArchive(zipSync({ meta: strToU8('123456'), sheet: strToU8('12345') }), {
      ...XLSX_LIMITS,
      partBytes: 8,
      totalBytes: 10,
    })
    archive.read((p) => p === 'meta')
    expect(() => archive.read((p) => p === 'sheet')).toThrow('Общий размер')
  })

  it('не возвращает обрезанный XML при заниженных размерах обоих ZIP-заголовков', () => {
    const bytes = sizes(zipSync({ sheet: strToU8('a'.repeat(100_000)) }), 1)
    expect(bytes.length).toBeLessThan(1024)
    expect(() => new XlsxArchive(bytes).read(() => true)).toThrow('распакованный размер')
  })

  it('отклоняет неполный вывод при завышенном размере', () => {
    const bytes = sizes(zipSync({ sheet: strToU8('abc') }), 4)
    expect(() => new XlsxArchive(bytes).read(() => true)).toThrow('распакованный размер')
  })

  it('проверяет фактический бюджет при data descriptor без размера в локальном заголовке', () => {
    const bytes = sizes(streamed([{ name: 'sheet', data: strToU8('a'.repeat(100_000)) }]), 1)
    expect(() =>
      new XlsxArchive(bytes, { ...XLSX_LIMITS, partBytes: 100, totalBytes: 100 }).read(() => true),
    ).toThrow('лимит 32 МиБ')
  })

  it('читает обычный data descriptor и отклоняет несовпадающие заголовки', () => {
    const bytes = streamed([{ name: 'sheet', data: strToU8('учебный лист') }])
    expect(new XlsxArchive(bytes).read(() => true).get('sheet')).toEqual(strToU8('учебный лист'))
    const mismatch = sizes(zipSync({ sheet: strToU8('abc') }), 2, false)
    expect(() => new XlsxArchive(mismatch).read(() => true)).toThrow('не совпадают')
  })

  it('проверяет общий бюджет по фактическому выводу при ложном data descriptor', () => {
    const bytes = sizes(streamed([{ name: 'sheet', data: strToU8('a'.repeat(100_000)) }]), 1)
    const archive = new XlsxArchive(bytes, {
      ...XLSX_LIMITS,
      partBytes: 200_000,
      totalBytes: 10,
    })
    expect(archive.read(() => false).size).toBe(0)
    expect(() => archive.read(() => true)).toThrow('Общий размер')
  })

  it('не распаковывает невыбранные части, даже если они больше бюджета', () => {
    const archive = new XlsxArchive(
      zipSync({ visible: strToU8('123'), hidden: strToU8('a'.repeat(100_000)) }),
      { ...XLSX_LIMITS, partBytes: 8, totalBytes: 8 },
    )
    expect([...archive.read((p) => p === 'visible').keys()]).toEqual(['visible'])
    expect(() => archive.read((p) => p === 'hidden')).toThrow('лимит 32 МиБ')
  })

  it('ограничивает количество всех частей, включая невыбранные', () => {
    expect(
      () =>
        new XlsxArchive(zipSync({ a: strToU8(''), b: strToU8('') }), {
          ...XLSX_LIMITS,
          entries: 1,
        }),
    ).toThrow('слишком много частей')
  })

  it('отклоняет повтор имени, вместо выбора последней части', () => {
    const bytes = streamed([
      { name: 'sheet', data: strToU8('первый') },
      { name: 'sheet', data: strToU8('второй') },
    ])
    expect(() => new XlsxArchive(bytes)).toThrow('Повтор части ZIP')
  })

  it('ограничивает сжатый ввод и отклоняет повреждённый каталог', () => {
    const bytes = zipSync({ sheet: strToU8('abc') })
    expect(() => new XlsxArchive(bytes, { ...XLSX_LIMITS, compressedBytes: 1 })).toThrow(
      'Размер файла',
    )
    expect(() => new XlsxArchive(bytes.subarray(0, bytes.length - 22))).toThrow('invalid zip data')
  })
})
