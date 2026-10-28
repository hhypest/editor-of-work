import type { PassportEdition, PassportError } from '@eow/passport/domain'
import type { Result } from '@eow/shared/kernel'

/** Повод копии: до миграции схемы, до ввода редакции в действие, до восстановления другой копии. */
export type PassportBackupReason = 'migration' | 'activation' | 'restore'

/** Резервная копия базы паспорта в папке backups рядом с базой (ADR-0043). */
export interface PassportBackup {
  /** Имя файла копии; другого способа сослаться на файл у интерфейса нет. */
  readonly id: string
  readonly reason: PassportBackupReason
  /** Время создания копии, ISO 8601 UTC. */
  readonly createdAt: string
  readonly bytes: number
  /** Редакции в копии; пусто, если копию нельзя прочитать или восстановить. */
  readonly editions: readonly Omit<PassportEdition, 'id'>[]
  /** Почему копию нельзя восстановить; undefined — можно. */
  readonly problem?: string | undefined
}

/** Список копий и восстановление базы из копии. Текущая база перед заменой тоже копируется. */
export interface PassportBackups {
  backups(): Promise<Result<readonly PassportBackup[], PassportError>>
  restoreBackup(id: string): Promise<Result<void, PassportError>>
}
