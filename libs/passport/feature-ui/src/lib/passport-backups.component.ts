import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core'
import {
  BACKUP_TEXT,
  PassportBackupsFacade,
  backupEditions,
  backupSize,
  backupTime,
} from './passport-backups.facade'

/** Раздел «Резервные копии базы» на странице паспорта (ADR-0043). */
@Component({
  selector: 'eow-passport-backups',
  providers: [PassportBackupsFacade],
  templateUrl: './passport-backups.component.html',
  styleUrl: './passport.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PassportBackupsComponent {
  /** База заменена копией: странице нужно перечитать редакции. */
  readonly restored = output<void>()
  protected readonly facade = inject(PassportBackupsFacade)
  protected readonly text = BACKUP_TEXT
  protected readonly time = backupTime
  protected readonly editions = backupEditions
  protected readonly size = backupSize
  protected toggle(event: Event): void {
    if (event.target instanceof HTMLDetailsElement && event.target.open && !this.facade.backups())
      void this.facade.load()
  }
  protected async confirm(): Promise<void> {
    if (await this.facade.confirm()) this.restored.emit()
  }
}
