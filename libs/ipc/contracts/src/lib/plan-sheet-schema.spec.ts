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
