import { planSheetDataSchema } from './plan-sheet-schema'
const table = {
  title: 'Учебная ведомость',
  columns: [{ title: 'Работа', width: 390 }],
  rows: [['Учебная работа']],
}
const source = (entry: unknown) => ({
  year: 2027,
  edition: { number: '1', date: '2027-01-01' },
  approval: { title: '', name: '', year: 2026 },
  lines: [],
  pds: [
    { id: 'pd', name: 'Учебный ПД', pchu: 'Учебный', segments: [], works: [], tables: [entry] },
  ],
})
it('срез листа принимает только поддерживаемый сохранённый масштаб', () => {
  const data = source(table)
  const scaled = (scale: unknown) => ({ ...data, pds: data.pds.map((pd) => ({ ...pd, scale })) })
  expect(planSheetDataSchema.safeParse(scaled(25000)).success).toBe(true)
  expect(planSheetDataSchema.safeParse(scaled(75000)).success).toBe(false)
  expect(planSheetDataSchema.safeParse(scaled('25000')).success).toBe(false)
})
it('срез листа принимает необязательные ID строк и отклоняет неверные типы и лишние поля', () => {
  expect(planSheetDataSchema.safeParse(source(table)).success).toBe(true)
  expect(planSheetDataSchema.safeParse(source({ ...table, workIds: ['w'] })).success).toBe(true)
  for (const invalid of [
    { ...table, workIds: [1] },
    { ...table, workIds: [''] },
    { ...table, workIds: 'w' },
    { ...table, path: '/unexpected' },
  ])
    expect(planSheetDataSchema.safeParse(source(invalid)).success).toBe(false)
})
it('срез листа принимает необязательный столбец группы только как неотрицательное целое', () => {
  expect(planSheetDataSchema.safeParse(source({ ...table, groupColumn: 0 })).success).toBe(true)
  for (const groupColumn of [-1, 0.5, '0', null])
    expect(planSheetDataSchema.safeParse(source({ ...table, groupColumn })).success).toBe(false)
})
