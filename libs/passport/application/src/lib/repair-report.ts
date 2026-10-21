import {
  calculateRepairReport,
  type RepairSnapshot,
  type RepairReport,
  type PassportError,
} from '@eow/passport/domain'
import type { Result } from '@eow/shared/kernel'

export interface RepairReportSource {
  /** Один согласованный срез, включая периоды, нормы и конструкции выбранной редакции. */
  repairSnapshot(editionId: number): Promise<Result<RepairSnapshot, PassportError>>
}
export interface RepairReports {
  report(editionId: number): Promise<Result<RepairReport, PassportError>>
}
export function repairReports(source: RepairReportSource): RepairReports {
  return {
    async report(id) {
      const snapshot = await source.repairSnapshot(id)
      return snapshot.ok ? calculateRepairReport(snapshot.value) : snapshot
    },
  }
}
export type {
  RepairSnapshot,
  RepairReport,
  RepairReportRow,
  RepairAssessment,
  RepairLocation,
} from '@eow/passport/domain'
