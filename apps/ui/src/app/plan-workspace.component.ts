import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import { PlanEditorComponent } from '@eow/planning/feature-ui'
import { EditorSheetsComponent } from '@eow/documents/ui-sheets'
import type { PlanPreviewContext } from '@eow/planning/sheet-api'

/** Composition root связывает контексты без зависимости Планирования от Документов. */
@Component({
  selector: 'eow-plan-workspace',
  imports: [PlanEditorComponent, EditorSheetsComponent],
  template: `<eow-plan-editor (previewContext)="context.set($event)">
    <eow-editor-sheets planPreview [context]="context()" />
  </eow-plan-editor>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanWorkspaceComponent {
  protected readonly context = signal<PlanPreviewContext | null>(null)
}
