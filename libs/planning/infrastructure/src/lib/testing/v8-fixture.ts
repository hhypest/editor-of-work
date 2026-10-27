import { v7Fixture } from './v7-fixture'
/** Закреплённый вымышленный v8: таблица «Показатели» ПД и дистанции, скрытая у ПД. */
export const v8Fixture = {
  ...v7Fixture,
  format: { version: 8, appVersion: '0.5.0-alpha.1' },
  plan: {
    ...v7Fixture.plan,
    pdHiddenTables: [{ pd: 'D', hidden: ['dated', 'works', 'expected', 'isso'] }],
    datedIndicators: [
      {
        area: { kind: 'pd', pd: 'D' },
        rows: [
          { id: 'y1', name: 'Учебная протяжённость, км', previous: 10.5, current: 11 },
          { id: 'y2', name: 'Учебный пустой', previous: null, current: 0 },
        ],
      },
      {
        area: { kind: 'district' },
        rows: [{ id: 'y3', name: 'Учебный итог', previous: -2, current: null }],
      },
    ],
  },
}
