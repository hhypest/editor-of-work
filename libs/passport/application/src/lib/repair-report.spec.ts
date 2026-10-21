import { err, ok } from '@eow/shared/kernel'
import { repairReports, type RepairSnapshot, type RepairReportSource } from './repair-report'

describe('Запрос отчёта о ремонтах', () => {
  it('получает свежий срез при каждом показе и передаёт выбранную редакцию', async () => {
    const snapshot: RepairSnapshot = {
      date: '2027-01-01',
      lines: [],
      segments: [],
      tracks: [],
      norms: [],
    }
    const source = {
      repairSnapshot: vi.fn<RepairReportSource['repairSnapshot']>(async () => ok(snapshot)),
    }
    const reports = repairReports(source)
    expect(await reports.report(7)).toEqual(ok({ date: snapshot.date, rows: [] }))
    await reports.report(7)
    expect(source.repairSnapshot).toHaveBeenCalledTimes(2)
    expect(source.repairSnapshot).toHaveBeenCalledWith(7)
  })
  it('сохраняет понятную ошибку порта', async () => {
    const failure = err({ kind: 'not-found', message: 'Редакция не найдена.' } as const)
    expect(await repairReports({ repairSnapshot: async () => failure }).report(7)).toEqual(failure)
  })
})
