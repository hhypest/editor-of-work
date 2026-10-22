import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { PlanEditorFacade } from './plan-editor.facade'
@Component({
  selector: 'eow-plan-editor',
  imports: [FormsModule],
  templateUrl: './plan-editor.component.html',
  styleUrl: './plan-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'key($event)' },
})
export class PlanEditorComponent {
  protected readonly facade = inject(PlanEditorFacade)
  protected readonly editionNumber = signal('')
  protected readonly editionDate = signal('')
  constructor() {
    void this.facade.initialize()
  }
  protected key(event: KeyboardEvent): void {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey) return
    const key = event.code,
      target = event.target,
      editable =
        target instanceof HTMLElement &&
        (target.matches('input,textarea,select') || target.isContentEditable)
    if (key === 'KeyS') {
      event.preventDefault()
      void this.facade.save(event.shiftKey)
    } else if (key === 'KeyP') {
      event.preventDefault()
      this.facade.printUnavailable()
    } else if (!editable && key === 'KeyZ') {
      event.preventDefault()
      void this.facade.history(event.shiftKey ? 'redo' : 'undo')
    } else if (!editable && key === 'KeyY') {
      event.preventDefault()
      void this.facade.history('redo')
    }
  }
  protected import(): void {
    void this.facade.requestOpen({
      kind: 'import',
      edition: { number: this.editionNumber(), date: this.editionDate() },
    })
  }
}
