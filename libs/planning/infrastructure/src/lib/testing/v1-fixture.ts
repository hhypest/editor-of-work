/** Закреплённый образец v1: только вымышленные данные, не результат текущего кодировщика. */
export const v1Fixture = {
  format: { version: 1, appVersion: '0.1.0' },
  edition: {
    number: 'test-1',
    date: '2026-01-01',
    checksum: '1ba7aed4bdae41cbda69f4fa5292643784dde0bf46b7944ffb2f88245252f7db',
    snapshot: {
      lines: [
        {
          id: 'A',
          name: 'Тестовая линия',
          extent: [{ line: 'A', from: { km: 10, m: 0 }, to: { km: 11, m: 0 } }],
          kmLengths: [[10, 964]],
        },
      ],
      stations: [{ id: 'S', name: 'Тестовая станция', tracks: ['1'], switches: ['3'], pd: 'D' }],
      pds: [
        {
          id: 'D',
          name: 'Тестовый ПД',
          pchu: 'U',
          segments: [{ line: 'A', from: { km: 10, m: 0 }, to: { km: 11, m: 0 } }],
        },
      ],
      workKinds: [
        { code: 'TEST', name: 'Тестовый вид', unit: 'км', group: 'current', inPlanTable: true },
      ],
    },
  },
  plan: {
    year: 2027,
    approval: { title: '', name: '', year: 2026 },
    works: [
      {
        id: 'W',
        kind: 'TEST',
        place: {
          kind: 'line',
          spec: {
            line: 'A',
            items: [{ kind: 'span', line: 'A', from: { km: 10, m: 0 }, to: { km: 11, m: 0 } }],
          },
        },
        volume: null,
        note: 'Вымышленный пример',
        callout: true,
      },
    ],
    manual: [{ area: { kind: 'pd', pd: 'D' }, overrides: [['TEST', 2]], needs: [['TEST', 0]] }],
  },
}
