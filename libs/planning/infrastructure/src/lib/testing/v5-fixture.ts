import { v4Fixture } from './v4-fixture'
/** Закреплённый вымышленный v5: сохранённый масштаб и скрытая ведомость. */
export const v5Fixture = {
  ...v4Fixture,
  format: { version: 5, appVersion: '0.5.0' },
  plan: { ...v4Fixture.plan, pdHiddenTables: [{ pd: 'D', hidden: ['works'] }] },
}
