import { z } from 'zod'
import { defineChannel } from './channel'

const edition = z
  .object({
    id: z.number().int().positive(),
    number: z.number().int().positive(),
    date: z.iso.date(),
    label: z.string().min(1).max(200),
    status: z.enum(['draft', 'active', 'archived']),
  })
  .strict()

const backup = z
  .object({
    id: z.string().min(1).max(200),
    reason: z.enum(['migration', 'activation', 'restore']),
    createdAt: z.iso.datetime(),
    bytes: z.number().int().nonnegative(),
    editions: z.array(edition.omit({ id: true })),
    problem: z.string().optional(),
  })
  .strict()

/** Редакции, а также резервные копии базы и восстановление из копии (ADR-0043). */
export const passport = defineChannel(
  'passport:editions',
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('list') }).strict(),
    z
      .object({
        action: z.literal('createDraft'),
        date: z.iso.date(),
        label: z.string().min(1).max(200),
      })
      .strict(),
    z.object({ action: z.literal('activate'), id: z.number().int().positive() }).strict(),
    z.object({ action: z.literal('backups') }).strict(),
    // Имя файла копии: путь к файлу renderer не задаёт, main ищет копию только в своей папке.
    z.object({ action: z.literal('restoreBackup'), id: z.string().min(1).max(200) }).strict(),
  ]),
  z.discriminatedUnion('status', [
    z
      .object({
        status: z.literal('ok'),
        editions: z.array(edition),
        // Только в ответе на backups: копии базы, новые сначала.
        backups: z.array(backup).optional(),
      })
      .strict(),
    z.object({ status: z.literal('error'), message: z.string() }).strict(),
  ]),
)
