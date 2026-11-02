import { describe, expect, it } from 'vitest'
import { checkStationLayout } from '@eow/passport/import-api'
import { recognizeScheme, type RecognizedScheme } from './recognize-scheme'
import { schemeToLayout } from './scheme-layout'
import { fictionalDrawing, fictionalScheme, type SchemeCommand } from './testing/fictional-scheme'

function recognized(commands?: (c: readonly SchemeCommand[]) => SchemeCommand[]): RecognizedScheme {
  const base = fictionalScheme()
  const scheme = commands ? { ...base, commands: commands(base.commands) } : base
  const result = recognizeScheme(fictionalDrawing(scheme))
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
const byNumber = (s: RecognizedScheme, n: string) => s.tracks.find((t) => t.number === n)!
const switchNo = (s: RecognizedScheme, n: string) => s.switches.find((x) => x.number === n)!

describe('Распознавание схемы станции', () => {
  const s = recognized()

  it('берёт название станции из заголовка без «ст.»', () => {
    expect(s.station).toBe('Озёрная')
  })

  it('выводит единицу схемы из междупутья', () => {
    expect(s.unit).toBeCloseTo(0.2, 3)
  })

  it('находит главный и станционные пути с номером, длиной и вместимостью', () => {
    expect(byNumber(s, 'I')).toMatchObject({ kind: 'main', fullLength: 863, capacity: '58' })
    expect(byNumber(s, '2')).toMatchObject({ kind: 'station', fullLength: 849, capacity: '56' })
    expect(byNumber(s, '3')).toMatchObject({ kind: 'station', fullLength: 412, capacity: null })
  })

  it('отличает съезд между стрелками от пути без номера', () => {
    expect(s.tracks.filter((t) => t.kind === 'connector')).toHaveLength(1)
    expect(s.tracks.filter((t) => t.kind === 'siding')).toHaveLength(1)
    expect(s.remarks).toContain('Путь без номера отходит от стрелки 7.')
  })

  it('относит ответвления пути 2 к нему самому, а не к главному', () => {
    const two = byNumber(s, '2')
    expect(two.nodes[0]).toBe(switchNo(s, '1').node)
    expect(two.nodes.at(-1)).toBe(switchNo(s, '2').node)
  })

  it('кладёт стрелку на путь прямого направления, ветвь — на отходящий путь', () => {
    const main = byNumber(s, 'I').id
    for (const n of ['1', '2', '3', '5', '7']) expect(switchNo(s, n).track).toBe(main)
    expect(switchNo(s, '4').track).toBe(byNumber(s, '2').id)
    expect(switchNo(s, '6').branch).toBe(byNumber(s, '4').id)
  })

  it('снимает «ав» с номера стрелки', () => {
    expect(s.switches.map((x) => x.number).sort()).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  })

  it('отмечает закрытый путь по серому цвету', () => {
    expect(byNumber(s, '4').state).toBe('closed')
    expect(byNumber(s, '2').state).toBe('normal')
  })

  it('отмечает путь в консервации по крестикам вдоль линии', () => {
    const conserved = recognized((c) => [
      ...c,
      ...Array.from({ length: 40 }, (_, i): SchemeCommand => ({
        kind: 'line',
        points: [
          [2250 + i * 35, 1157],
          [2253 + i * 35, 1163],
        ],
        width: 10,
        color: [0, 0, 0],
      })),
    ])
    expect(byNumber(conserved, '3').state).toBe('conserved')
  })

  it('находит упор только у тупика пути 3', () => {
    const ends = s.nodes.filter((n) => n.kind === 'end')
    expect(ends.filter((n) => n.end === 'stop').map((n) => n.id)).toEqual([
      byNumber(s, '3').nodes.at(-1),
    ])
  })

  it('находит остряк на пути по отростку и подписи', () => {
    expect(s.derailers).toEqual([
      expect.objectContaining({ number: '8со', track: byNumber(s, '3').id }),
    ])
  })

  it('берёт место остряка по подписи, если знака нет, и сообщает об этом', () => {
    const noStub = recognized((c) =>
      c.filter((x) => !(x.kind === 'line' && x.points[0]?.[0] === 2600)),
    )
    expect(noStub.derailers[0]?.track).toBe(byNumber(noStub, '3').id)
    expect(noStub.remarks).toContain('Остряк «8со ав»: знак не найден, место взято по подписи.')
  })

  it('находит переезд по подписи и оси с км и пикетом', () => {
    expect(s.crossings).toEqual([
      expect.objectContaining({ label: 'переезд 12км 3пк', km: 12, pk: 3 }),
    ])
  })

  it('пропускает переезд без оси с замечанием', () => {
    const noAxis = recognized((c) => c.filter((x) => !(x.kind === 'line' && x.dash)))
    expect(noAxis.crossings).toEqual([])
    expect(noAxis.remarks.some((r) => r.includes('ось не найдена'))).toBe(true)
  })

  it('находит мост по ферме на главном пути', () => {
    expect(s.bridges).toEqual([expect.objectContaining({ track: byNumber(s, 'I').id })])
  })

  it('сообщает о стрелке без подписи', () => {
    const unlabeled = recognized((c) => c.filter((x) => !(x.kind === 'text' && x.text === '7')))
    expect(unlabeled.switches.some((x) => x.number === null)).toBe(true)
    expect(unlabeled.remarks.some((r) => r.includes('без номера'))).toBe(true)
  })

  it('делит линию с двумя номерами путей в узле между подписями', () => {
    const joined = recognized((c) => [
      ...c,
      {
        kind: 'line',
        points: [
          [1000, 1500],
          [2000, 1500],
          [3000, 1500],
        ],
        width: 10,
        color: [0, 0, 0],
      },
      { kind: 'text', text: '11', x: 1100, y: 1520, size: 91, color: [0, 0, 0] },
      { kind: 'text', text: '12', x: 2800, y: 1520, size: 91, color: [0, 0, 0] },
    ])
    const a = byNumber(joined, '11'),
      b = byNumber(joined, '12')
    expect(a.nodes.at(-1)).toBe(b.nodes[0])
  })

  it('без линий путей возвращает ошибку', () => {
    const empty = recognizeScheme({ width: 100, height: 100, paths: [], texts: [] })
    expect(empty.ok).toBe(false)
  })
})

describe('Раскладка схемы по сетке', () => {
  const s = recognized()
  const layout = schemeToLayout(s)
  const node = (id: string) => layout.nodes.find((n) => n.id === id)!

  it('проходит проверку правил раскладки', () => {
    expect(checkStationLayout(layout)).toEqual([])
  })

  it('ставит уровни путей в соседние ряды сверху вниз', () => {
    const row = (n: string) => node(byNumber(s, n).nodes[1]!).row
    expect([row('4'), row('2'), row('I'), row('3')]).toEqual([0, 1, 2, 3])
  })

  it('сохраняет порядок узлов слева направо', () => {
    for (const t of layout.tracks) {
      const cols = t.nodes.map((id) => node(id).col)
      expect(cols).toEqual([...cols].sort((a, b) => a - b))
    }
  })

  it('даёт ответвлению стандартный наклон: две колонки на ряд', () => {
    const two = byNumber(s, '2')
    const sw = node(two.nodes[0]!),
      bend = node(two.nodes[1]!)
    expect(bend.col - sw.col).toBe(2 * Math.abs(bend.row - sw.row))
  })

  it('привязывает остряк, мост и переезд к колонкам на их путях', () => {
    expect(layout.derailers[0]?.track).toBe(byNumber(s, '3').id)
    expect(layout.bridges[0]!.fromCol).toBeLessThan(layout.bridges[0]!.toCol)
    expect(layout.crossings[0]).toMatchObject({ fromRow: 0, toRow: 2, km: 12, pk: 3 })
  })

  it('не допускает стрелку вне её пути', () => {
    const broken = {
      ...layout,
      switches: layout.switches.map((x, i) => (i === 0 ? { ...x, track: byNumber(s, '3').id } : x)),
    }
    expect(checkStationLayout(broken).some((e) => e.includes('не лежит на своём пути'))).toBe(true)
  })
})
