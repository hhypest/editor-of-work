import { pdSheetClient } from './pd-sheet-client'
import {
  PD_SHEET_CLIENT,
  OVERVIEW_CLIENT,
  SHEET_MEASURER,
  EDITOR_SHEET_CLIENT,
} from '@eow/documents/ui-sheets'
import { editorSheetClient } from './editor-sheet-client'
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
import { PLAN_EDITOR_CLIENT } from '@eow/planning/feature-ui'
import { planEditorClient } from './plan-editor-client'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: EDITOR_SHEET_CLIENT, useFactory: () => editorSheetClient(window.eow) },
    { provide: PD_SHEET_CLIENT, useFactory: () => pdSheetClient(window.eow) },
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
    { provide: PLAN_EDITOR_CLIENT, useFactory: () => planEditorClient(window.eow) },
  ],
}
