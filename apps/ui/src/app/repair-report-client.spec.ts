import { channels, type EowApi } from '@eow/ipc/contracts'
import { repairReportClient } from './repair-report-client'

describe('Порт отчёта через preload', () => {
  it('сообщает об отсутствии настольного соединения', async () => {
    const client = repairReportClient(undefined)
    expect(await client.list()).toMatchObject({ ok: false })
    expect(await client.report(1)).toMatchObject({ ok: false })
  })
  it('передаёт идентификатор и принимает DTO', async () => {
    const api: EowApi = {
      appInfo: async () => ({ name: 'editor-of-work', version: '0' }),
      planFile: async () => ({ status: 'cancelled' }),
      passport: vi.fn<EowApi['passport']>(async () => ({ status: 'ok', editions: [] })),
      repairs: vi.fn<EowApi['repairs']>(async () =>
        channels.repairs.response.parse({ status: 'ok', report: { date: '2027-01-01', rows: [] } }),
      ),
    }
    const client = repairReportClient(api)
    expect(await client.list()).toEqual({ ok: true, value: [] })
    expect(await client.report(2)).toMatchObject({ ok: true, value: { date: '2027-01-01' } })
    expect(api.repairs).toHaveBeenCalledWith({ editionId: 2 })
  })
})
