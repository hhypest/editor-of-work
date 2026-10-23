import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core'
import type { PlanPageSelection, PlanPreviewContext } from '@eow/planning/sheet-api'
import { SheetA3Component } from './sheet-a3.component'
import { EditorSheetsFacade } from './editor-sheets.facade'

@Component({
  selector: 'eow-editor-sheets',
  imports: [SheetA3Component],
  providers: [EditorSheetsFacade],
  templateUrl: './editor-sheets.component.html',
  styleUrl: './overview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorSheetsComponent {
  readonly context = input<PlanPreviewContext | null>(null)
  readonly pageSelection = output<PlanPageSelection | null>()
  protected readonly facade = inject(EditorSheetsFacade)
  constructor() {
    effect(() => {
      const context = this.context()
      untracked(() => {
        void this.facade.sync(context)
      })
    })
    effect(() => this.pageSelection.emit(this.facade.selection()))
  }
  protected scale(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.facade.setScale(Number(event.target.value))
  }
  protected zoom(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.facade.setZoom(Number(event.target.value))
  }
}
