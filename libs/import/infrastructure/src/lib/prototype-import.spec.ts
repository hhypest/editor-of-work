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
})
