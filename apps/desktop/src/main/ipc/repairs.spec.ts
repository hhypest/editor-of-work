import { channels } from '@eow/ipc/contracts'
import type { RepairReports } from '@eow/passport/application'
import { err, ok } from '@eow/shared/kernel'
import { registerRepairHandlers } from './repairs'

function setup() {
  const reports: RepairReports = {
    report: vi.fn<RepairReports['report']>(async () => ok({ date: '2027-01-01', rows: [] })),
  }
  let handler: ((event: unknown, ...args: unknown[]) => unknown) | undefined
  registerRepairHandlers(
    {
      handle(name, listener) {
        expect(name).toBe(channels.repairs.name)
        handler = listener
      },
    },
    reports,
  )
  return { reports, invoke: async (input: unknown) => handler!(undefined, input) }
}
describe('IPC потребности в ремонте', () => {
  it('возвращает DTO для выбранной редакции', async () => {
    const { reports, invoke } = setup()
    expect(await invoke({ editionId: 3 })).toEqual({
      status: 'ok',
      report: { date: '2027-01-01', rows: [] },
    })
    expect(reports.report).toHaveBeenCalledWith(3)
  })
  it.each([{ editionId: -1 }, { editionId: 1.5 }, { editionId: 1, path: 'arbitrary.sqlite' }, {}])(
    'отклоняет запрос до расчёта',
    async (input) => {
      const { reports, invoke } = setup()
      await expect(invoke(input)).rejects.toThrow('неверный запрос')
      expect(reports.report).not.toHaveBeenCalled()
    },
  )
  it('передаёт понятную ошибку без содержимого базы', async () => {
    const { reports, invoke } = setup()
    vi.mocked(reports.report).mockResolvedValue(
      err({ kind: 'not-found', message: 'Редакция не найдена.' }),
    )
    expect(await invoke({ editionId: 1 })).toEqual({
      status: 'error',
      message: 'Редакция не найдена.',
    })
  })
})
