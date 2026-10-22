import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as FileSystem from 'node:fs/promises'
import { passportLocation, type PassportLocationChooser } from './passport-location'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>()
  return { ...original, stat: vi.fn<typeof original.stat>(original.stat) }
})

afterEach(() => vi.clearAllMocks())

describe('недоступная локальная база', () => {
  it.each(['EACCES', 'EPERM', 'EROFS', 'EIO'])(
    'при отсутствии переносной и ошибке %s не создаёт пустую базу',
    async (code) => {
      const root = await mkdtemp(join(tmpdir(), 'eow-location-'))
      try {
        vi.mocked(stat)
          .mockRejectedValueOnce(
            Object.assign(new Error('Нет переносной базы'), { code: 'ENOENT' }),
          )
          .mockRejectedValueOnce(
            Object.assign(new Error('Нельзя проверить локальную базу'), { code }),
          )
        const choose = vi.fn<PassportLocationChooser>(async () => 'portable')
        await expect(
          passportLocation(join(root, 'portable'), join(root, 'local'), choose),
        ).rejects.toMatchObject({ code })
        expect(choose).not.toHaveBeenCalled()
        expect(await readdir(root)).toEqual([])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
})
