import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { fieldLabel } from './passport-view'
import { PASSPORT_TEXT, PassportFacade, type PassportMode } from './passport.facade'
import { PassportBackupsComponent } from './passport-backups.component'

@Component({
  selector: 'eow-passport',
  imports: [PassportBackupsComponent],
  providers: [PassportFacade],
  templateUrl: './passport.component.html',
  styleUrl: './passport.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PassportComponent {
  protected readonly facade = inject(PassportFacade)
  protected readonly text = PASSPORT_TEXT
  protected readonly fieldLabel = fieldLabel
  protected readonly draftDate = signal('')
  protected readonly draftLabel = signal('')
  constructor() {
    void this.facade.load()
  }
  protected select(event: Event): void {
    if (event.target instanceof HTMLSelectElement)
      void this.facade.select(Number(event.target.value))
  }
  protected selectCompare(event: Event): void {
    if (event.target instanceof HTMLSelectElement)
      void this.facade.selectCompare(Number(event.target.value))
  }
  protected setMode(mode: PassportMode): void {
    void this.facade.setMode(mode)
  }
  protected inputDate(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.draftDate.set(event.target.value)
  }
  protected inputLabel(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.draftLabel.set(event.target.value)
  }
  /** После восстановления копии база другая: редакции и выбранная редакция перечитываются. */
  protected reload(): void {
    void this.facade.load()
  }
  protected createDraft(): void {
    void this.facade.createDraft(this.draftDate(), this.draftLabel())
  }
}
