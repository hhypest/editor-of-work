import { z } from 'zod'
import { defineChannel } from './channel'
import { planFile } from './plan-file-channel'

/** Сведения о программе: имя и версия. Первый канал, на котором проверяется контракт. */
export const appInfo = defineChannel(
  'app:info',
  z.object({}).strict(),
  z
    .object({
      name: z.string().min(1),
      version: z.string().min(1),
    })
    .strict(),
)

/** Все каналы контракта. Новый канал добавляется сюда — тогда его увидят main, preload и renderer. */
export const channels = {
  appInfo,
  planFile,
} as const

export type Channels = typeof channels
export type ChannelKey = keyof Channels
