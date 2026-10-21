import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter } from '@angular/router'
import { appRoutes } from './app.routes'
import { REPAIR_REPORT_CLIENT } from '@eow/passport/feature-ui'
import { repairReportClient } from './repair-report-client'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    {
      provide: REPAIR_REPORT_CLIENT,
      useFactory: () => repairReportClient(window.eow),
    },
  ],
}
