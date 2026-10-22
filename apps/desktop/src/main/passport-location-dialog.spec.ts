import { describe, expect, it, vi } from 'vitest'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { choosePassportLocation } from './passport-location-dialog'

const locations = {
  portablePath: 'C:\\Учебная программа\\data\\passport.sqlite',
  localPath: 'C:\\Учебный профиль\\editor-of-work\\passport.sqlite',
}

describe('предупреждение о двух базах паспорта', () => {
  it.each([
    [0, undefined],
    [1, 'portable'],
    [2, 'local'],
    [-1, undefined],
  ] as const)('кнопка %s возвращает только явный выбор %s', async (response, expected) => {
    const show = vi.fn<(options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>(
      async () => ({
        response,
        checkboxChecked: false,
      }),
    )
    expect(await choosePassportLocation(locations, show)).toBe(expected)
    expect(show).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'warning',
        message: 'Найдены две базы паспорта',
        buttons: ['Закрыть программу', 'Рядом с программой', 'На этом компьютере'],
        defaultId: 0,
        cancelId: 0,
        detail: expect.stringContaining(locations.portablePath),
      }),
    )
    expect(show.mock.calls[0]![0].detail).toContain(locations.localPath)
  })

  it('не превращает ошибку системного диалога в выбор базы', async () => {
    await expect(
      choosePassportLocation(locations, async () => {
        throw new Error('Учебная ошибка окна')
      }),
    ).rejects.toThrow('Учебная ошибка окна')
  })
})
