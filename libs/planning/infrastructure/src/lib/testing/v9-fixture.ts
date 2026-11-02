import { v1Fixture } from './v1-fixture'
import { v8Fixture } from './v8-fixture'

/**
 * Закреплённый вымышленный v9: у станции раскладка схемы без зданий и платформ, у ПД
 * скрыты листы станций. Контрольная сумма посчитана по этому снимку.
 */
export const v9Fixture = {
  ...v8Fixture,
  format: { version: 9, appVersion: '0.5.0-beta.1' },
  edition: {
    ...v1Fixture.edition,
    checksum: 'f3ddf0558778201c977dbe41e320f2900fcb2db743e46d9c34659c2b50d229f6',
    snapshot: {
      ...v1Fixture.edition.snapshot,
      stations: [
        {
          ...v1Fixture.edition.snapshot.stations[0],
          layout: {
            version: 1,
            nodes: [
              { id: 'a', col: 0, row: 0, kind: 'end', end: 'open' },
              { id: 'b', col: 12, row: 0, kind: 'end', end: 'stop' },
            ],
            tracks: [
              {
                id: 't',
                number: '1',
                kind: 'station',
                state: 'normal',
                nodes: ['a', 'b'],
                fullLength: 300,
                capacity: null,
              },
            ],
            switches: [],
            derailers: [],
            bridges: [],
            crossings: [
              { id: 'x', label: 'переезд 10км', km: 10, pk: 2, col: 6, fromRow: 0, toRow: 0 },
            ],
          },
        },
      ],
    },
  },
  plan: {
    ...v8Fixture.plan,
    pdHiddenTables: [{ pd: 'D', hidden: ['dated', 'works', 'expected', 'isso', 'stations'] }],
  },
}
