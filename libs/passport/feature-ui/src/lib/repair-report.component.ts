import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { DecimalPipe } from '@angular/common'
import { REPAIR_TEXT, RepairReportFacade } from './repair-report.facade'

@Component({
  selector: 'eow-repair-report',
  imports: [DecimalPipe],
  providers: [RepairReportFacade],
  templateUrl: './repair-report.component.html',
  styleUrl: './repair-report.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepairReportComponent {
  protected readonly facade = inject(RepairReportFacade)
  protected readonly text = REPAIR_TEXT
  constructor() {
    void this.facade.load()
  }
  protected select(event: Event): void {
    if (event.target instanceof HTMLSelectElement)
      void this.facade.select(Number(event.target.value))
  }
  protected refresh(): void {
    void this.facade.load()
  }
}
