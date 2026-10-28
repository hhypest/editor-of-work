import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { FORM_TITLES, PASSPORT_FORMS } from '@eow/import/application'
import { ExportWizardFacade, EXPORT_TEXT, EXPORT_STEPS, progressText } from './export-wizard.facade'

@Component({
  selector: 'eow-export-wizard',
  providers: [ExportWizardFacade],
  templateUrl: './export-wizard.component.html',
  styleUrl: './manual-template.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportWizardComponent {
  protected readonly facade = inject(ExportWizardFacade)
  protected readonly text = EXPORT_TEXT
  protected readonly steps = EXPORT_STEPS
  protected readonly progressText = progressText
  constructor() {
    void this.facade.load()
  }
  protected selectEdition(event: Event): void {
    if (event.target instanceof HTMLSelectElement)
      this.facade.selectEdition(Number(event.target.value))
  }
  protected toggle(code: string, event: Event): void {
    if (event.target instanceof HTMLInputElement) this.facade.toggle(code, event.target.checked)
  }
  protected formTitle(form: string): string {
    const key = PASSPORT_FORMS.find((f) => f === form)
    return key ? FORM_TITLES[key] : form
  }
}
