import { v2Fixture } from './v2-fixture'
/** Закреплённый образец v3: прежний срез/архив и вымышленный ручной показатель. */
export const v3Fixture = {
  ...v2Fixture,
  format: { version: 3, appVersion: '0.3.0' },
  plan: {
    ...v2Fixture.plan,
    indicators: [
      {
        area: { kind: 'pd', pd: 'D' },
        rows: [
          {
            id: 'i',
            name: 'Учебный показатель',
            unit: '',
            value: -1.25,
            note: 'Учебное примечание',
          },
        ],
      },
    ],
  },
}
