/** Формат исходного HTML-прототипа, но направления, станции, работы и числа вымышленные. */
export function prototypeFixture() {
  return {
    v: 1,
    meta: {
      year: 2027,
      approveTitle: 'Руководитель',
      approveName: '',
      approveDateYear: 2026,
      dist: 'Тестовая дистанция',
    },
    catalog: [
      {
        id: 'A',
        code: 'А',
        name: 'Вид А',
        group: 'cur',
        unit: 'км',
        inTable: true,
        color: '#000000',
      },
      { id: 'B', code: 'Б', name: 'Вид Б', group: 'cur', unit: 'км', inTable: false, alsoIn: 'A' },
      { id: 'C', code: 'В', name: 'Вид В', group: 'cap', unit: 'компл', inTable: true },
    ],
    lines: [
      {
        id: 'L',
        name: 'Тестовая линия',
        from: 10.25,
        to: 20,
        gaps: [{ from: 15, to: 16, label: 'разрыв' }],
        classes: [],
      },
    ],
    pchu: [{ id: 'U', head: '' }],
    pd: [
      { id: 'D1', pchu: 'U', segs: [{ line: 'L', from: 10.25, to: 13 }] },
      {
        id: 'D2',
        pchu: 'U',
        segs: [
          { line: 'L', from: 13, to: 15 },
          { line: 'L', from: 16, to: 20 },
        ],
      },
    ],
    stations: [
      {
        id: 'S',
        name: 'Тестовая станция',
        pd: null,
        pos: [{ line: 'L', axis: 17.5 }],
        stats: { test: 7 },
        layout: {
          tracks: [
            { id: 'main', num: 'I', kind: 'главный', row: 0, x1: 0, x2: 50 },
            {
              id: 'side',
              num: '2',
              kind: 'прочий',
              row: -1,
              x1: 7,
              x2: 30,
              L: { sw: '3', to: 'main' },
              R: { sw: '', to: null },
            },
          ],
          objects: [{ id: 'building', type: 'здание', text: 'Тест', x: 15, y: 2 }],
        },
      },
    ],
    works: [
      {
        id: 'w1',
        kind: 'B',
        line: 'L',
        station: null,
        rangesText: '12,5 — 13.25',
        qty: null,
        note: 'Тест',
        callout: true,
        target: null,
      },
      {
        id: 'w2',
        kind: 'C',
        line: 'L',
        station: 'S',
        rangesText: '',
        qty: 2,
        note: '',
        callout: false,
        target: { type: 'track', id: 'side' },
      },
      {
        id: 'w3',
        kind: 'C',
        line: 'L',
        station: 'S',
        rangesText: '',
        qty: 1,
        note: '',
        callout: true,
        target: { type: 'switch', id: '3' },
      },
      {
        id: 'w4',
        kind: 'A',
        line: 'L',
        station: 'S',
        rangesText: '17/1 — пк 2',
        qty: null,
        note: '',
        callout: true,
        target: null,
      },
    ],
    tables: {
      dist: { override: { A: 7 }, need: { A: 0 }, indicators: [{ name: 'Тест', value: 10 }] },
      D1: { override: { A: 1.5 }, need: {} },
    },
    opts: { dist: { callouts: false } },
  }
}
