import { channels } from '@eow/ipc/contracts'
import type { RepairReports } from '@eow/passport/application'
import { registerHandler, type IpcMainLike } from './register'

export function registerRepairHandlers(ipc: IpcMainLike, reports: RepairReports): void {
  registerHandler(ipc, channels.repairs, async ({ editionId }) => {
    const result = await reports.report(editionId)
    return channels.repairs.response.parse(
      result.ok
        ? { status: 'ok', report: result.value }
        : { status: 'error', message: result.error.message },
    )
  })
}
