import { PdSheetsComponent, OverviewComponent } from '@eow/documents/ui-sheets'
import { ExportWizardComponent, ManualTemplateComponent } from '@eow/import/feature-ui'
import { type Route } from '@angular/router'
import { PassportComponent, RepairReportComponent } from '@eow/passport/feature-ui'

import { PlanEditorComponent } from '@eow/planning/feature-ui'

export const appRoutes: Route[] = [
  { path: 'pd-sheets', component: PdSheetsComponent },
  { path: '', component: PassportComponent },
  { path: 'import', component: ExportWizardComponent },
  { path: 'manual', component: ManualTemplateComponent },
  { path: 'sheets', component: OverviewComponent },
  { path: 'repairs', component: RepairReportComponent },
  { path: 'plan', component: PlanEditorComponent },
]
