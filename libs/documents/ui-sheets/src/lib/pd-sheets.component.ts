import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { SheetA3Component } from './sheet-a3.component'
import { PdSheetsFacade } from './pd-sheets.facade'

@Component({
  selector: 'eow-pd-sheets',
  imports: [SheetA3Component],
  providers: [PdSheetsFacade],
  templateUrl: './pd-sheets.component.html',
  styleUrl: './overview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdSheetsComponent {
  protected readonly facade = inject(PdSheetsFacade)
  constructor() {
    void this.facade.load(false)
  }
  protected select(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.facade.select(event.target.value)
  }
  protected scale(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.facade.setScale(Number(event.target.value))
  }
  protected zoom(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.facade.setZoom(Number(event.target.value))
  }
}
