import { OVERVIEW_CLIENT, SHEET_MEASURER } from '@eow/documents/ui-sheets'
import { prepareSheetMeasurer } from '@eow/documents/infrastructure'
import { overviewClient } from './overview-client'
import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter, withHashLocation } from '@angular/router'
import { appRoutes } from './app.routes'
import { PASSPORT_CLIENT, REPAIR_REPORT_CLIENT } from '@eow/passport/feature-ui'
import { repairReportClient } from './repair-report-client'
import { exportWizardClient } from './export-wizard-client'
import { EXPORT_WIZARD_CLIENT, MANUAL_TEMPLATE_CLIENT } from '@eow/import/feature-ui'
import { manualTemplateClient } from './manual-template-client'
import { passportClient } from './passport-client'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: OVERVIEW_CLIENT, useFactory: () => overviewClient(window.eow) },
    { provide: SHEET_MEASURER, useValue: () => prepareSheetMeasurer(document) },
    { provide: EXPORT_WIZARD_CLIENT, useFactory: () => exportWizardClient(window.eow) },
    { provide: MANUAL_TEMPLATE_CLIENT, useFactory: () => manualTemplateClient(window.eow) },
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
