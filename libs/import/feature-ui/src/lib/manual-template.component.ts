import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { ManualTemplateFacade, MANUAL_TEMPLATE_TEXT } from './manual-template.facade'

@Component({
  selector: 'eow-manual-template',
  providers: [ManualTemplateFacade],
  templateUrl: './manual-template.component.html',
  styleUrl: './manual-template.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManualTemplateComponent {
  protected readonly facade = inject(ManualTemplateFacade)
  protected readonly text = MANUAL_TEMPLATE_TEXT
  constructor() {
    void this.facade.load()
  }
  protected select(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.facade.select(Number(event.target.value))
  }
}
