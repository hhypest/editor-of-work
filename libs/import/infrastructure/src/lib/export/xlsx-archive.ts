import { Unzip, UnzipInflate, unzipSync, type UnzipFileInfo } from 'fflate'

/** Resource limits for one workbook, independent of its compressed size. */
export const XLSX_LIMITS = {
  compressedBytes: 64 * 1024 * 1024,
  partBytes: 32 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  entries: 4096,
}

// A small compressed chunk bounds transient inflater output even with lying ZIP sizes.
const INPUT_CHUNK_BYTES = 1024

export class XlsxArchive {
  private readonly index = new Map<string, UnzipFileInfo>()
  private total = 0

  constructor(
    private readonly bytes: Uint8Array,
    private readonly limits: Readonly<typeof XLSX_LIMITS> = XLSX_LIMITS,
  ) {
    if (bytes.length > limits.compressedBytes)
      throw new Error('Размер файла xlsx превышает 64 МиБ.')
    // Read the central directory without allocating or inflating any entry.
    unzipSync(bytes, {
      filter: (file) => {
        if (this.index.size >= limits.entries)
          throw new Error('В xlsx слишком много частей ZIP (лимит 4096).')
        if (this.index.has(file.name)) throw new Error(`Повтор части ZIP в xlsx: ${file.name}`)
        for (const size of [file.size, file.originalSize])
          if (!Number.isSafeInteger(size) || size < 0)
            throw new Error('Неверный размер части ZIP в xlsx.')
        this.index.set(file.name, file)
        return false
      },
    })
  }

  read(wanted: (path: string) => boolean): ReadonlyMap<string, Uint8Array> {
    const selected = new Map([...this.index].filter(([path]) => wanted(path)))
    let declared = this.total
    for (const file of selected.values()) {
      this.checkPart(file.originalSize)
      declared += file.originalSize
      this.checkTotal(declared)
    }
    const files = new Map<string, Uint8Array>()
    const seen = new Set<string>()
    const unzip = new Unzip((file) => {
      const info = this.index.get(file.name)
      if (!info || seen.has(file.name)) throw new Error('Неверный список частей ZIP в xlsx.')
      seen.add(file.name)
      if (!selected.has(file.name)) return
      if (
        file.compression !== info.compression ||
        (file.size !== undefined && file.size !== info.size) ||
        (file.originalSize !== undefined && file.originalSize !== info.originalSize)
      )
        throw new Error(`Заголовки части ZIP не совпадают: ${file.name}`)
      const chunks: Uint8Array[] = []
      let size = 0
      file.ondata = (error, chunk, final) => {
        if (error) throw error
        size += chunk.length
        this.checkPart(size)
        this.checkTotal(this.total + chunk.length)
        if (size > info.originalSize)
          throw new Error(`Неверный распакованный размер части ZIP: ${file.name}`)
        this.total += chunk.length
        chunks.push(chunk)
        if (final) {
          if (size !== info.originalSize)
            throw new Error(`Неверный распакованный размер части ZIP: ${file.name}`)
          const out = new Uint8Array(size)
          let offset = 0
          for (const part of chunks) {
            out.set(part, offset)
            offset += part.length
          }
          files.set(file.name, out)
        }
      }
      file.start()
    })
    unzip.register(UnzipInflate)
    for (let offset = 0; offset < this.bytes.length; offset += INPUT_CHUNK_BYTES) {
      const end = Math.min(offset + INPUT_CHUNK_BYTES, this.bytes.length)
      unzip.push(this.bytes.subarray(offset, end), end === this.bytes.length)
    }
    if (seen.size !== this.index.size || files.size !== selected.size)
      throw new Error('Неполный набор частей ZIP в xlsx.')
    return files
  }

  private checkPart(size: number): void {
    if (size > this.limits.partBytes)
      throw new Error('Часть xlsx после распаковки превышает лимит 32 МиБ.')
  }

  private checkTotal(size: number): void {
    if (size > this.limits.totalBytes)
      throw new Error('Общий размер распакованных частей xlsx превышает лимит 128 МиБ.')
  }
}
