import { pdfSheetSchema, type EowApi } from '@eow/ipc/contracts'
import type { SheetPdfClient } from '@eow/documents/application'
import { err, ok } from '@eow/shared/kernel'

/** PDF паспортных схем через main: renderer передаёт готовые листы. */
export function sheetPdfClient(api: Pick<EowApi, 'sheetPdf'> | undefined): SheetPdfClient {
  return {
    async save(fileName, pages) {
      if (!api) return err({ message: 'PDF доступен в настольной программе editor-of-work.' })
      const result = await api.sheetPdf({
        fileName,
        pages: pages.map((page) => pdfSheetSchema.parse(page)),
      })
      return result.status === 'error' ? err({ message: result.message }) : ok(result.status)
    },
  }
}
