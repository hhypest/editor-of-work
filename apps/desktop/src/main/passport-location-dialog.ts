import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import type { PassportLocations } from '@eow/passport/infrastructure'

/** Диалог до открытия SQLite; отсутствие выбора означает отмену запуска. */
export async function choosePassportLocation(
  locations: PassportLocations,
  showMessageBox: (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>,
): Promise<'portable' | 'local' | undefined> {
  const { response } = await showMessageBox({
    type: 'warning',
    title: 'Выбор базы паспорта',
    message: 'Найдены две базы паспорта',
    detail: [
      'После временной недоступности папки программы данные могли сохраняться в другой базе. Выберите базу для этого запуска.',
      `Рядом с программой:\n${locations.portablePath}`,
      `На этом компьютере:\n${locations.localPath}`,
      'Автоматического объединения и переноса данных нет. Если не уверены в выборе, закройте программу и сохраните обе базы вместе с их журналами перед переносом данных.',
    ].join('\n\n'),
    buttons: ['Закрыть программу', 'Рядом с программой', 'На этом компьютере'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  if (response === 1) return 'portable'
  if (response === 2) return 'local'
  return undefined
}
