import { z } from 'zod'
import { defineChannel } from './channel'
import { planFile } from './plan-file-channel'
import { passport } from './passport-channel'
import { passportData } from './passport-data-channel'
import { exportWizard } from './export-wizard-channel'
import { manualTemplate } from './manual-template-channel'
import { printHost } from './pdf-sheet-schema'
import { repairs } from './repair-report-channel'

/**
 * Сведения о программе для диагностики: имя, версия продукта из package.json
 * и версия формата файла плана, который программа записывает.
 */
export const appInfo = defineChannel(
  'app:info',
  z.object({}).strict(),
  z
    .object({
      name: z.string().min(1),
      version: z.string().min(1),
      planFormat: z.number().int().positive(),
    })
    .strict(),
)

/** Все каналы контракта. Новый канал добавляется сюда — тогда его увидят main, preload и renderer. */
export const channels = {
  appInfo,
  printHost,
  planFile,
  passport,
  passportData,
  repairs,
  manualTemplate,
  exportWizard,
} as const

export type Channels = typeof channels
export type ChannelKey = keyof Channels
