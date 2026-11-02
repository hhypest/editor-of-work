import { planSheetDataSchema } from './plan-sheet-schema'
const table = {
  title: 'Учебная ведомость',
  columns: [{ title: 'Работа', width: 390 }],
  rows: [['Учебная работа']],
}
const source = (entry: unknown, stations: unknown[] = []) => ({
  year: 2027,
  edition: { number: '1', date: '2027-01-01' },
  approval: { title: '', name: '', year: 2026 },
  lines: [],
  pds: [
    {
      id: 'pd',
      name: 'Учебный ПД',
      pchu: 'Учебный',
      segments: [],
      works: [],
      tables: [entry],
      stations,
    },
  ],
})
const layout = {
  version: 1,
  nodes: [
    { id: 'a', col: 0, row: 0, kind: 'end', end: 'open' },
    { id: 'b', col: 4, row: 0, kind: 'end' },
  ],
  tracks: [
    {
      id: 't',
      number: '1',
      kind: 'main',
      state: 'normal',
      nodes: ['a', 'b'],
      fullLength: null,
      capacity: null,
    },
  ],
  switches: [],
  derailers: [],
  bridges: [],
  crossings: [],
}
const station = {
  id: 's',
  name: 'Учебная',
  layout,
  works: [
    {
      id: 'w',
      name: 'Учебная работа',
      object: { kind: 'track', number: '1' },
      volume: 1,
      unit: 'км',
      note: '',
      callout: true,
    },
  ],
  tables: [table],
}
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
it('срез листа принимает станцию с раскладкой или без неё и отклоняет неверный объект', () => {
  expect(planSheetDataSchema.safeParse(source(table, [station])).success).toBe(true)
  expect(planSheetDataSchema.safeParse(source(table, [{ ...station, layout: null }])).success).toBe(
    true,
  )
  for (const invalid of [
    { ...station, layout: { ...layout, version: 2 } },
    { ...station, works: [{ ...station.works[0], object: { kind: 'axis', number: '1' } }] },
    { ...station, extra: true },
  ])
    expect(planSheetDataSchema.safeParse(source(table, [invalid])).success).toBe(false)
  const { stations: _, ...withoutStations } = source(table).pds[0]!
  expect(planSheetDataSchema.safeParse({ ...source(table), pds: [withoutStations] }).success).toBe(
    false,
  )
})
