import { ChangeDetectionStrategy, Component, effect, inject, output, signal } from '@angular/core'
import type { PlanPreviewContext } from '@eow/planning/sheet-api'
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
  readonly previewContext = output<PlanPreviewContext>()
  protected readonly facade = inject(PlanEditorFacade)
  protected readonly editionNumber = signal('')
  protected readonly editionDate = signal('')
  constructor() {
    effect(() => {
      const state = this.facade.state()
      this.previewContext.emit({
        revision: state?.revision ?? 0,
        area: this.facade.area(),
        hasPlan: state?.view !== null && state?.view !== undefined,
        hasRecovery: state?.hasRecovery ?? false,
        busy: this.facade.busy(),
        pending: this.facade.pending(),
      })
    })
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
