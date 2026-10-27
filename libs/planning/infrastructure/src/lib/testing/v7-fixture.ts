import { v6Fixture } from './v6-fixture'
/** Закреплённый вымышленный v7: перечни ПД и дистанции, скрытая таблица ИССО. */
export const v7Fixture = {
  ...v6Fixture,
  format: { version: 7, appVersion: '0.5.0' },
  plan: {
    ...v6Fixture.plan,
    pdHiddenTables: [{ pd: 'D', hidden: ['works', 'expected', 'isso'] }],
    itemTables: [
      {
        area: { kind: 'pd', pd: 'D' },
        kind: 'contract',
        rows: [
          { id: 'c1', name: 'Учебная подрядная работа', unit: 'м3', quantity: 12.5, cost: 3.25 },
          { id: 'c2', name: 'Учебная нулевая', unit: '', quantity: 0, cost: 0 },
        ],
      },
      {
        area: { kind: 'district' },
        kind: 'zp',
        rows: [{ id: 'z1', name: 'Учебная работа ЗП', unit: 'км', quantity: 1, cost: 0 }],
      },
    ],
  },
}
