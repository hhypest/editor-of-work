import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter, withHashLocation } from '@angular/router'
import { appRoutes } from './app.routes'
import { PASSPORT_CLIENT, REPAIR_REPORT_CLIENT } from '@eow/passport/feature-ui'
import { repairReportClient } from './repair-report-client'
import { passportClient } from './passport-client'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withHashLocation()),
    {
      provide: REPAIR_REPORT_CLIENT,
      useFactory: () => repairReportClient(window.eow),
    },
    {
      provide: PASSPORT_CLIENT,
      useFactory: () => passportClient(window.eow),
    },
  ],
}
