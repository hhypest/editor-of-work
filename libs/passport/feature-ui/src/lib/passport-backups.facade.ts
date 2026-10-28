import { inject, Injectable, signal } from '@angular/core'
import type { PassportBackup } from '@eow/passport/application'
import { PASSPORT_CLIENT } from './passport.facade'

export const BACKUP_TEXT = {
  title: 'Резервные копии базы',
  intro:
    'Программа сохраняет копию базы паспорта перед обновлением схемы, перед вводом редакции в действие и перед восстановлением. Хранятся 10 последних копий в папке backups рядом с базой. Файлы планов копии не затрагивают.',
  show: 'Показать копии',
  refresh: 'Обновить список',
  empty: 'Копий пока нет.',
  created: 'Создана',
  reason: 'Повод',
  editions: 'Редакции в копии',
  size: 'Размер',
  restore: 'Восстановить',
  confirm: 'Восстановить базу',
  cancel: 'Отмена',
  reasons: {
    migration: 'Перед обновлением схемы',
    activation: 'Перед вводом редакции',
    restore: 'Перед восстановлением',
  },
  status: { draft: 'черновик', active: 'действующая', archived: 'архивная' },
} as const

/** Дата и время копии по часам компьютера: «28.10.2026, 10:05». */
export function backupTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Редакции копии одной строкой: «№ 1 · 2026-10-22 · Первая — действующая; …». */
export function backupEditions(backup: PassportBackup): string {
  return backup.editions
    .map((e) => `№ ${e.number} · ${e.date} · ${e.label} — ${BACKUP_TEXT.status[e.status]}`)
    .join('; ')
}

export function backupSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}

@Injectable()
export class PassportBackupsFacade {
  private readonly client = inject(PASSPORT_CLIENT)
  readonly backups = signal<readonly PassportBackup[] | null>(null)
  readonly busy = signal(false)
  readonly error = signal<string | null>(null)
  readonly status = signal<string | null>(null)
  /** Копия, восстановление которой ждёт подтверждения. */
  readonly confirming = signal<PassportBackup | null>(null)

  async load(): Promise<void> {
    if (this.busy()) return
    this.busy.set(true)
    this.error.set(null)
    try {
      const result = await this.client.backups()
      if (result.ok) this.backups.set(result.value)
      else this.error.set(result.error.message)
    } catch {
      this.error.set('Не удалось получить список копий. Повторите попытку.')
    } finally {
      this.busy.set(false)
    }
  }

  request(backup: PassportBackup): void {
    if (!this.busy() && !backup.problem) {
      this.status.set(null)
      this.confirming.set(backup)
    }
  }
  cancel(): void {
    this.confirming.set(null)
  }

  /** true — база заменена, редакции нужно перечитать. */
  async confirm(): Promise<boolean> {
    const backup = this.confirming()
    if (!backup || this.busy()) return false
    this.confirming.set(null)
    this.busy.set(true)
    this.error.set(null)
    this.status.set(null)
    let restored = false
    try {
      const result = await this.client.restoreBackup(backup.id)
      if (result.ok) {
        restored = true
        this.status.set(
          `База восстановлена из копии от ${backupTime(backup.createdAt)}. Прежняя база сохранена копией «${BACKUP_TEXT.reasons.restore}».`,
        )
      } else this.error.set(result.error.message)
    } catch {
      this.error.set('Не удалось восстановить копию. Повторите попытку.')
    } finally {
      this.busy.set(false)
    }
    if (restored) await this.load()
    return restored
  }
}
