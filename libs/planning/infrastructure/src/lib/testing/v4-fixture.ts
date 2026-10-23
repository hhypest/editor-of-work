import { v3Fixture } from './v3-fixture'
/** Закреплённый вымышленный v4: прежние данные и масштаб ПД. */
export const v4Fixture = {
  ...v3Fixture,
  format: { version: 4, appVersion: '0.4.0' },
  plan: { ...v3Fixture.plan, pdScales: [{ pd: 'D', scale: 25000 }] },
}
