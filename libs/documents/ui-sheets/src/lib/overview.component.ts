import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { SheetA3Component } from './sheet-a3.component'
import { OverviewFacade, OVERVIEW_TEXT } from './overview.facade'

@Component({
  selector: 'eow-overview',
  imports: [SheetA3Component],
  providers: [OverviewFacade],
  templateUrl: './overview.component.html',
  styleUrl: './overview.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent {
  protected readonly facade = inject(OverviewFacade)
  protected readonly text = OVERVIEW_TEXT
  constructor() {
    void this.facade.load()
  }
  protected select(event: Event): void {
    if (event.target instanceof HTMLSelectElement)
      void this.facade.select(Number(event.target.value))
  }
  protected scale(event: Event): void {
    if (event.target instanceof HTMLSelectElement) this.facade.setScale(Number(event.target.value))
  }
  protected zoom(event: Event): void {
    if (event.target instanceof HTMLInputElement) this.facade.setZoom(Number(event.target.value))
  }
}
