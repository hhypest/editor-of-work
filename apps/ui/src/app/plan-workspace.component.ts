import { ChangeDetectionStrategy, Component, signal } from '@angular/core'
import { PlanEditorComponent } from '@eow/planning/feature-ui'
import { EditorSheetsComponent } from '@eow/documents/ui-sheets'
import type { PlanPageSelection, PlanPreviewContext } from '@eow/planning/sheet-api'

/** Composition root связывает контексты без зависимости Планирования от Документов. */
@Component({
  selector: 'eow-plan-workspace',
  imports: [PlanEditorComponent, EditorSheetsComponent],
  template: `<eow-plan-editor
    #editor
    (printRequested)="sheets.exportPdf()"
    (previewContext)="context.set($event)"
    [pageSelection]="pageSelection()"
  >
    <eow-editor-sheets
      #sheets
      planPreview
      [context]="context()"
      (pageSelection)="pageSelection.set($event)"
      (saveScale)="editor.savePdScale($event)"
    />
  </eow-plan-editor>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlanWorkspaceComponent {
  protected readonly context = signal<PlanPreviewContext | null>(null)
  protected readonly pageSelection = signal<PlanPageSelection | null>(null)
}
