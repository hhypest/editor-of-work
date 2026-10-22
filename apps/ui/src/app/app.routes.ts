import { type Route } from '@angular/router'
import { PassportComponent, RepairReportComponent } from '@eow/passport/feature-ui'

export const appRoutes: Route[] = [
  { path: '', component: PassportComponent },
  { path: 'repairs', component: RepairReportComponent },
]
