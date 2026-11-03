import { workbookSchema, type EowApi } from '@eow/ipc/contracts'
import type { SpreadsheetClient } from '@eow/documents/application'
import { err, ok } from '@eow/shared/kernel'

/** Книга xlsx через main: renderer передаёт модель книги, путь выбирает и пишет main. */
export function spreadsheetClient(api: Pick<EowApi, 'spreadsheet'> | undefined): SpreadsheetClient {
  return {
    async save(fileName, workbook) {
      if (!api) return err({ message: 'Excel доступен в настольной программе editor-of-work.' })
      const checked = workbookSchema.safeParse(workbook)
      if (!checked.success)
        return err({ message: 'Книга не прошла проверку перед записью. Сообщите разработчику.' })
      const result = await api.spreadsheet({ fileName, workbook: checked.data })
      return result.status === 'error' ? err({ message: result.message }) : ok(result.status)
    },
  }
}
