import { sequentialIds } from '@eow/shared/kernel'
import { importPrototype } from './prototype-import'
import { prototypeFixture } from './testing/prototype-fixture'

const options = () => ({
  edition: { number: 'test', date: '2026-10-20' },
  ids: sequentialIds('legacy'),
})
function imported(p: unknown = prototypeFixture()) {
  const result = importPrototype(JSON.stringify(p), options())
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  return result.value
}

describe('импорт JSON прототипа', () => {
  it('переносит все работы, гриф, каталог и ручные значения', () => {
    const plan = imported()
    expect(plan.works.map((w) => w.id)).toEqual(['w1', 'w2', 'w3', 'w4'])
    expect(plan.approval).toEqual({ title: 'Руководитель', name: '', year: 2026 })
    expect(plan.basis.workKinds.find((k) => k.code === 'B')).toMatchObject({
      includedIn: 'A',
      unit: 'км',
    })
    expect(plan.manual).toContainEqual({
      area: { kind: 'district' },
      field: 'overrides',
      code: 'A',
      value: 7,
    })
    expect(plan.manual).toContainEqual({
      area: { kind: 'district' },
      field: 'needs',
      code: 'A',
      value: 0,
    })
  })

  it('переводит дробные километры, запятую и старую запись пикетов в пары км/м', () => {
    const plan = imported()
    expect(plan.basis.lines.find((l) => l.id === 'L')?.extent).toEqual([
      { line: 'L', from: { km: 10, m: 250 }, to: { km: 15, m: 0 } },
      { line: 'L', from: { km: 16, m: 0 }, to: { km: 20, m: 0 } },
    ])
    expect(plan.works[0]?.place).toMatchObject({
      kind: 'line',
      spec: { items: [{ from: { km: 12, m: 500 }, to: { km: 13, m: 250 } }] },
    })
    expect(plan.works[3]?.place).toMatchObject({
      kind: 'line',
      station: 'S',
      spec: { items: [{ from: { km: 17, m: 0 }, to: { km: 17, m: 200 } }] },
    })
  })

  it('переводит идентификатор пути в его номер, сохраняет стрелку и ПД станции по оси', () => {
    const plan = imported()
    expect(plan.works[1]?.place).toEqual({
      kind: 'station',
      station: 'S',
      object: { kind: 'track', number: '2' },
    })
    expect(plan.works[2]?.place).toMatchObject({ object: { kind: 'switch', number: '3' } })
    expect(plan.basis.stations.find((s) => s.id === 'S')?.pd).toBe('D2')
    expect(plan.basis.stations.find((s) => s.id === 'S')?.legacyLayout).toMatchObject({
      tracks: [
        { id: 'main', number: 'I', row: 0 },
        {
          id: 'side',
          number: '2',
          row: -1,
          x1: 7,
          x2: 30,
          left: { switchNumber: '3', parent: 'main' },
        },
      ],
      objects: [{ id: 'building', type: 'здание', text: 'Тест', x: 15, y: 2 }],
    })
  })

  it('раскладка и все дополнительные поля остаются без изменений в исходном снимке и названы в отчёте', () => {
    const source = prototypeFixture()
    const plan = imported(source)
    expect(JSON.parse(plan.prototype!.source)).toEqual(source)
    const paths = plan.prototype!.report.map((r) => r.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'stations.0.layout',
        'meta.dist',
        'opts',
        'pchu',
        'tables.dist.indicators',
        'catalog.0.color',
      ]),
    )
  })

  it.each(['fraction', 'missing-track', 'bad-place'] as const)(
    'ошибка %s отклоняет весь импорт, не удаляя работу',
    (change) => {
      const p = prototypeFixture()
      switch (change) {
        case 'fraction':
          p.lines[0]!.from = 10.2501
          break
        case 'missing-track':
          p.works[1]!.target!.id = 'нет'
          break
        case 'bad-place':
          p.works[0]!.rangesText = 'не место'
          break
      }
      const result = importPrototype(JSON.stringify(p), options())
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('импорт должен быть отклонён')
      expect(result.error.length).toBeGreaterThan(0)
      expect(p.works).toHaveLength(4)
    },
  )

  it('переносит ожидаемые показатели дистанции и ПД с пустыми значениями, нулём, знаком и запятой', () => {
    const p = prototypeFixture() as unknown as {
      tables: Record<string, Record<string, unknown>>
    }
    p.tables['dist']!['expected'] = [
      { group: ' Учебная протяжённость ', name: '', unit: 'км', value: null },
      { group: 'Учебная протяжённость', name: 'учебная часть', unit: 'км', value: '1,5' },
      { group: 'Учебный итог', name: '', unit: 'шт', value: 0 },
    ]
    p.tables['D1']!['expected'] = [{ group: 'Учебный ПД', name: '', unit: '', value: '-2' }]
    const plan = imported(p)
    expect(plan.expected).toEqual([
      {
        area: { kind: 'district' },
        rows: [
          { id: 'legacy-1', group: 'Учебная протяжённость', name: '', unit: 'км', value: null },
          {
            id: 'legacy-2',
            group: 'Учебная протяжённость',
            name: 'учебная часть',
            unit: 'км',
            value: 1.5,
          },
          { id: 'legacy-3', group: 'Учебный итог', name: '', unit: 'шт', value: 0 },
        ],
      },
      {
        area: { kind: 'pd', pd: 'D1' },
        rows: [{ id: 'legacy-4', group: 'Учебный ПД', name: '', unit: '', value: -2 }],
      },
    ])
    const paths = plan.prototype.report.map((r) => r.path)
    expect(paths).not.toContain('tables.dist.expected')
    expect(paths).toContain('tables.dist.indicators')
    expect(JSON.parse(plan.prototype.source)).toEqual(p)
  })

  it('называет в отчёте пропущенные строки и таблицу станции, ничего не исправляя', () => {
    const p = prototypeFixture() as unknown as {
      tables: Record<string, Record<string, unknown>>
    }
    p.tables['dist']!['expected'] = [
      { group: '', name: '', unit: '', value: null },
      { group: '', name: 'без показателя', unit: 'км', value: 1 },
      { group: 'Учебный', name: '', unit: 'км', value: 'много' },
      { group: 'Учебный', name: '', unit: 'км', value: 3, color: 'красный' },
      'не строка',
      { group: 'Учебный', name: { text: 'объект' }, unit: 'км', value: 4 },
      { group: 'Учебный', name: '', unit: ['км'], value: 5 },
      { group: true, name: '', unit: 'км', value: 6 },
    ]
    p.tables['S'] = { expected: [{ group: 'Станционный', name: '', unit: '', value: 1 }] }
    const plan = imported(p)
    expect(plan.expected).toEqual([
      {
        area: { kind: 'district' },
        rows: [{ id: 'legacy-1', group: 'Учебный', name: '', unit: 'км', value: 3 }],
      },
    ])
    const report = new Map(plan.prototype.report.map((r) => [r.path, r.message]))
    expect(report.get('tables.dist.expected.0')).toContain('Пустая строка')
    expect(report.get('tables.dist.expected.1')).toContain('без показателя не перенесена')
    expect(report.get('tables.dist.expected.2')).toContain('не является числом')
    expect(report.get('tables.dist.expected.3.color')).toContain('снимке прототипа')
    expect(report.get('tables.dist.expected.4')).toContain('не распознана')
    expect(report.get('tables.dist.expected.5.name')).toContain('не является текстом')
    expect(report.get('tables.dist.expected.6.unit')).toContain('не является текстом')
    expect(report.get('tables.dist.expected.7.group')).toContain('не является текстом')
    expect(report.get('tables.S.expected')).toContain('только для дистанции и ПД')
  })

  it('отклоняет импорт с более чем 10 000 строк ожидаемых показателей в области', () => {
    const p = prototypeFixture() as unknown as {
      tables: Record<string, Record<string, unknown>>
    }
    p.tables['D1']!['expected'] = Array.from({ length: 10001 }, () => ({
      group: 'Учебный',
      name: '',
      unit: '',
      value: 1,
    }))
    expect(importPrototype(JSON.stringify(p), options())).toMatchObject({
      ok: false,
      error: [{ path: 'tables.D1.expected' }],
    })
  })

  it('переносит перечни подрядных, ИССО и ЗП дистанции и ПД с прежним порядком строк', () => {
    const p = prototypeFixture() as unknown as {
      tables: Record<string, Record<string, unknown>>
    }
    p.tables['dist']!['contract'] = [
      { name: ' Учебная подрядная ', unit: ' м3 ', qty: 12.5, cost: '1 234,5' },
      { name: 'Учебная без объёма', unit: 'шт', qty: 0, cost: 0 },
    ]
    p.tables['D1']!['isso'] = [{ name: 'Учебная ИССО', unit: 'шт', qty: '2', cost: 0.25 }]
    p.tables['D1']!['zp'] = []
    p.tables['D2'] = { zp: [{ name: 'Учебная ЗП', unit: 'км', qty: 1, cost: 3 }] }
    p.tables['S'] = { contract: [], isso: [], zp: [] }
    const plan = imported(p)
    expect(plan.items).toEqual([
      {
        area: { kind: 'district' },
        table: 'contract',
        rows: [
          { id: 'legacy-1', name: 'Учебная подрядная', unit: 'м3', quantity: 12.5, cost: 1234.5 },
          { id: 'legacy-2', name: 'Учебная без объёма', unit: 'шт', quantity: 0, cost: 0 },
        ],
      },
      {
        area: { kind: 'pd', pd: 'D1' },
        table: 'isso',
        rows: [{ id: 'legacy-3', name: 'Учебная ИССО', unit: 'шт', quantity: 2, cost: 0.25 }],
      },
      {
        area: { kind: 'pd', pd: 'D2' },
        table: 'zp',
        rows: [{ id: 'legacy-4', name: 'Учебная ЗП', unit: 'км', quantity: 1, cost: 3 }],
      },
    ])
    const paths = plan.prototype.report.map((r) => r.path)
    for (const path of [
      'tables.dist.contract',
      'tables.D1.isso',
      'tables.D1.zp',
      'tables.D2.zp',
      'tables.S.contract',
    ])
      expect(paths).not.toContain(path)
    expect(JSON.parse(plan.prototype.source)).toEqual(p)
  })

  it('называет в отчёте пропущенные строки перечней и непустой перечень станции', () => {
    const p = prototypeFixture() as unknown as {
      tables: Record<string, Record<string, unknown>>
    }
    p.tables['D1']!['contract'] = [
      { name: '', unit: '', qty: 0, cost: null },
      { name: '', unit: 'шт', qty: 1, cost: 1 },
      { name: 'Учебная', unit: 'шт', qty: 'много', cost: 1 },
      { name: 'Учебная', unit: 'шт', qty: 1, cost: -1 },
      'не строка',
      { name: { text: 'объект' }, unit: 'шт', qty: 1, cost: 1 },
      { name: 'Учебная', unit: 'шт', qty: null, cost: 5, note: 'лишнее' },
      { name: 'Учебная', unit: 'шт', qty: 2, cost: '' },
    ]
    p.tables['S'] = { isso: [{ name: 'Станционная', unit: 'шт', qty: 1, cost: 1 }] }
    const plan = imported(p)
    expect(plan.items).toEqual([
      {
        area: { kind: 'pd', pd: 'D1' },
        table: 'contract',
        rows: [
          { id: 'legacy-1', name: 'Учебная', unit: 'шт', quantity: 0, cost: 5 },
          { id: 'legacy-2', name: 'Учебная', unit: 'шт', quantity: 2, cost: 0 },
        ],
      },
    ])
    const report = new Map(plan.prototype.report.map((r) => [r.path, r.message]))
    expect(report.get('tables.D1.contract.0')).toContain('Пустая строка')
    expect(report.get('tables.D1.contract.1')).toContain('без наименования не перенесена')
    expect(report.get('tables.D1.contract.2.qty')).toContain('не является числом')
    expect(report.get('tables.D1.contract.3')).toContain('Отрицательный')
    expect(report.get('tables.D1.contract.4')).toContain('не распознана')
    expect(report.get('tables.D1.contract.5.name')).toContain('не является текстом')
    expect(report.get('tables.D1.contract.6.note')).toContain('снимке прототипа')
    expect(report.get('tables.D1.contract.6.qty')).toContain('Пустой объём перенесён нулём')
    expect(report.get('tables.D1.contract.7.cost')).toContain('Пустая стоимость перенесена нулём')
    expect(report.get('tables.S.isso')).toContain('только для дистанции и ПД')
  })

  it('отклоняет импорт с более чем 10 000 строк перечня в области', () => {
    const p = prototypeFixture() as unknown as {
      tables: Record<string, Record<string, unknown>>
    }
    p.tables['dist']!['zp'] = Array.from({ length: 10001 }, () => ({
      name: 'Учебная',
      unit: '',
      qty: 1,
      cost: 1,
    }))
    expect(importPrototype(JSON.stringify(p), options())).toMatchObject({
      ok: false,
      error: [{ path: 'tables.dist.zp' }],
    })
  })

  it('не подставляет нормативы при отсутствии каталога', () => {
    const { catalog, ...p } = prototypeFixture()
    expect(importPrototype(JSON.stringify(p), options()).ok).toBe(false)
    expect(importPrototype(JSON.stringify(p), { ...options(), catalog }).ok).toBe(true)
  })

  it('выдаёт идентификатор только работе, у которой он отсутствовал', () => {
    const p = prototypeFixture()
    const { id: _id, ...withoutId } = p.works[0]!
    const plan = imported({ ...p, works: [withoutId, ...p.works.slice(1)] })
    expect(plan.works.map((w) => w.id)).toEqual(['legacy-1', 'w2', 'w3', 'w4'])
  })

  it('отклоняет будущую версию и повреждённый JSON', () => {
    expect(importPrototype(JSON.stringify({ ...prototypeFixture(), v: 2 }), options()).ok).toBe(
      false,
    )
    expect(importPrototype('{', options()).ok).toBe(false)
  })

  it('сохраняет нулевой автоматический объём станционной работы в километрах', () => {
    const p = prototypeFixture()
    const plan = imported({ ...p, works: [{ ...p.works[1], kind: 'A', qty: null }] })
    expect(plan.works[0]!.volume).toBe(0)
    expect(plan.prototype.report).toContainEqual(expect.objectContaining({ path: 'works.0.qty' }))
  })

  it('не теряет привязку к ненумерованному пути', () => {
    const p = prototypeFixture()
    p.stations[0]!.layout.tracks[1]!.num = ''
    const plan = imported(p)
    expect(plan.works[1]!.place).toMatchObject({ object: { kind: 'track', number: 'side' } })
    expect(plan.basis.stations[0]!.legacyLayout!.tracks[1]!.number).toBe('')
  })

  it('переносит точечную работу и явно введённый объём с запятой', () => {
    const p = prototypeFixture()
    const plan = imported({ ...p, works: [{ ...p.works[0], rangesText: '12+500', qty: '1,5' }] })
    expect(plan.works[0]).toMatchObject({
      volume: 1.5,
      place: { kind: 'line', spec: { items: [{ kind: 'point', at: { km: 12, m: 500 } }] } },
    })
  })

  it('объединяет перекрытие одного ПД с сообщением и сохраняет исходные границы', () => {
    const p = prototypeFixture()
    p.pd[0]!.segs.push({ line: 'L', from: 11, to: 12 })
    const plan = imported(p)
    expect(plan.basis.pds.find((d) => d.id === 'D1')?.segments).toHaveLength(1)
    expect(plan.prototype!.report).toContainEqual(expect.objectContaining({ path: 'pd.0.segs' }))
    expect(JSON.parse(plan.prototype!.source)).toEqual(p)
  })

  it('сохраняет старый автоматический объём в единице «км пути» явно, не переименовывая единицу', () => {
    const p = prototypeFixture()
    p.catalog[0]!.unit = 'км пути'
    p.catalog[1]!.unit = 'км пути'
    const plan = imported(p)
    expect(plan.works[0]!.volume).toBe(0.75)
    expect(plan.basis.workKinds.find((k) => k.code === 'B')?.unit).toBe('км пути')
    expect(plan.prototype!.report).toContainEqual(expect.objectContaining({ path: 'works.0.qty' }))
  })

  it.each([false, true])(
    'ось на общей границе относится к следующему ПД при любом порядке (%s)',
    (reversed) => {
      const p = prototypeFixture()
      p.stations[0]!.pos[0]!.axis = 13
      if (reversed) p.pd.reverse()
      expect(imported(p).basis.stations[0]!.pd).toBe('D2')
    },
  )

  it.each([15, 20])('ось на исключённом конце участка %s не относится к прежнему ПД', (axis) => {
    const p = prototypeFixture()
    p.stations[0]!.pos[0]!.axis = axis
    expect(imported(p).basis.stations[0]!.pd).toBeUndefined()
  })

  it.each(['explicit', 'fallback'] as const)(
    'отклоняет совпадение номеров путей после преобразования (%s)',
    (kind) => {
      const p = prototypeFixture()
      const tracks = p.stations[0]!.layout.tracks
      tracks[0]!.num = kind === 'explicit' ? '2' : 'side'
      if (kind === 'fallback') tracks[1]!.num = ''
      const result = importPrototype(JSON.stringify(p), options())
      expect(result).toMatchObject({
        ok: false,
        error: expect.arrayContaining([
          expect.objectContaining({
            path: 'stations.0.layout.tracks',
            message: expect.stringContaining('Номер пути станции повторяется'),
          }),
        ]),
      })
    },
  )

  it.each([
    { line: 'L', from: 9, to: 11 },
    { line: 'L', from: 19, to: 21 },
    { line: 'L', from: 21, to: 22 },
    { line: 'L', from: 14, to: 17 },
    { line: 'L', from: 15.1, to: 15.9 },
    { line: 'missing', from: 11, to: 12 },
  ])('отклоняет границу ПД вне протяжения направления: %j', (segment) => {
    const p = prototypeFixture()
    p.pd[0]!.segs = [segment]
    const result = importPrototype(JSON.stringify(p), options())
    expect(result).toMatchObject({
      ok: false,
      error: expect.arrayContaining([
        expect.objectContaining({
          path: 'pd.0.segs.0',
          message: expect.stringContaining('Граница ПД выходит за протяжение'),
        }),
      ]),
    })
  })

  it('допускает границы ПД, совпадающие с краями протяжения и разрыва', () => {
    const p = prototypeFixture()
    p.pd[0]!.segs = [{ line: 'L', from: 10.25, to: 15 }]
    p.pd[1]!.segs = [{ line: 'L', from: 16, to: 20 }]
    expect(imported(p).basis.pds.map((pd) => pd.segments)).toHaveLength(2)
  })
})
