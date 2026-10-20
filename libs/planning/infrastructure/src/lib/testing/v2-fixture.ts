import { v1Fixture } from './v1-fixture'

/** Закреплённый образец v2 поверх неизменной структуры среза v1. Только вымышленные данные. */
export const v2Fixture = {
  ...v1Fixture,
  format: { version: 2, appVersion: '0.2.0' },
  plan: {
    ...v1Fixture.plan,
    prototype: {
      source: '{"v":1,"stations":[{"id":"S","layout":{"tracks":[],"objects":[]}}]}',
      report: [{ path: 'stations.0.layout', message: 'Раскладка сохранена в снимке' }],
    },
    works: v1Fixture.plan.works.map((w) => ({ ...w, place: { ...w.place, station: 'S' } })),
  },
}
