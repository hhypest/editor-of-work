import { ExportWizardComponent, ManualTemplateComponent } from '@eow/import/feature-ui'
import { type Route } from '@angular/router'
import { PassportComponent, RepairReportComponent } from '@eow/passport/feature-ui'

export const appRoutes: Route[] = [
  { path: '', component: PassportComponent },
  { path: 'import', component: ExportWizardComponent },
  { path: 'manual', component: ManualTemplateComponent },
  { path: 'repairs', component: RepairReportComponent },
]
