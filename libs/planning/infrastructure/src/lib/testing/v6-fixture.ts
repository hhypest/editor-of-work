import { v5Fixture } from './v5-fixture'
/** Закреплённый вымышленный v6: ожидаемые показатели ПД и скрытая таблица ожидаемых. */
export const v6Fixture = {
  ...v5Fixture,
  format: { version: 6, appVersion: '0.5.0' },
  plan: {
    ...v5Fixture.plan,
    pdHiddenTables: [{ pd: 'D', hidden: ['works', 'expected'] }],
    expectedIndicators: [
      {
        area: { kind: 'pd', pd: 'D' },
        rows: [
          { id: 'e1', group: 'Учебная протяжённость', name: '', unit: 'км', value: null },
          {
            id: 'e2',
            group: 'Учебная протяжённость',
            name: 'учебная часть',
            unit: 'км',
            value: 2.5,
          },
        ],
      },
      {
        area: { kind: 'district' },
        rows: [{ id: 'e3', group: 'Учебный итог', name: '', unit: 'шт', value: 0 }],
      },
    ],
  },
}
