import { TestBed } from '@angular/core/testing'
import { err, ok } from '@eow/shared/kernel'
import type { StationLayout } from '@eow/stations/application'
import { StationEditorComponent, stationEditorLeaveGuard } from './station-editor.component'
import {
  STATION_EDITOR_CLIENT,
  STATION_TEXT,
  type StationEditorClient,
} from './station-editor.facade'

/** Вымышленная станция: главный I, путь 3 ответвляется стрелкой 1 и кончается упором. */
const layout: StationLayout = {
  version: 1,
  nodes: [
    { id: 'a', col: 0, row: 1, kind: 'end', end: 'open' },
    { id: 's', col: 4, row: 1, kind: 'switch' },
    { id: 'b', col: 20, row: 1, kind: 'end', end: 'open' },
    { id: 'c', col: 6, row: 0, kind: 'bend' },
    { id: 'd', col: 18, row: 0, kind: 'end', end: 'stop' },
  ],
  tracks: [
    {
      id: 't1',
      number: 'I',
      kind: 'main',
      state: 'normal',
      nodes: ['a', 's', 'b'],
      fullLength: null,
      capacity: null,
    },
    {
      id: 't2',
      number: '3',
      kind: 'station',
      state: 'normal',
      nodes: ['s', 'c', 'd'],
      fullLength: 400,
      capacity: '40',
    },
  ],
  switches: [{ id: 'w1', number: '1', node: 's', track: 't1', branch: 't2' }],
  derailers: [{ id: 'r1', number: '3со', track: 't2', col: 10 }],
  bridges: [{ id: 'g1', label: null, track: 't1', fromCol: 12, toCol: 14 }],
  crossings: [],
}
const editions = [
  { id: 1, number: 1, date: '2027-01-01', label: 'Действующая', status: 'active' },
  { id: 2, number: 2, date: '2028-01-01', label: 'Черновик', status: 'draft' },
] as const

function client(editable = true): StationEditorClient {
  return {
    editions: vi.fn<StationEditorClient['editions']>(async () => ok(editions)),
    stations: vi.fn<StationEditorClient['stations']>(async () =>
      ok([
        { id: 'st-a', name: 'Безсхемная', hasLayout: false },
        { id: 'st-b', name: 'Учебная', hasLayout: true },
      ]),
    ),
    load: vi.fn<StationEditorClient['load']>(async (_e, station) =>
      ok(station === 'st-b' ? { layout, version: 'v1', editable } : null),
    ),
    save: vi.fn<StationEditorClient['save']>(async () => ok({ version: 'v2' })),
  }
}

async function render(port: StationEditorClient) {
  await TestBed.configureTestingModule({
    imports: [StationEditorComponent],
    providers: [{ provide: STATION_EDITOR_CLIENT, useValue: port }],
  }).compileComponents()
  const fixture = TestBed.createComponent(StationEditorComponent)
  await fixture.whenStable()
  fixture.detectChanges()
  return { fixture, el: fixture.nativeElement as HTMLElement }
}
const key = (target: Element, k: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))

describe('Редактор схемы станции', () => {
  it('открывает черновик и первую станцию со схемой и рисует пути и стрелки', async () => {
    const port = client()
    const { el } = await render(port)
    expect(port.stations).toHaveBeenCalledWith(2)
    expect(port.load).toHaveBeenCalledWith(2, 'st-b')
    expect(el.querySelectorAll('polyline.track')).toHaveLength(2)
    expect(el.querySelector('polyline.track.main')).not.toBeNull()
    expect(el.querySelector('.switch-label')?.textContent?.trim()).toBe('1')
    expect(el.textContent).toContain('3 · 400 м')
  })

  it('сдвигает узел стрелкой клавиатуры, отменяет и сохраняет с версией', async () => {
    const port = client()
    const { fixture, el } = await render(port)
    // Излом пути 3 в колонке 6: 40 + 6 · 16 = 136 по рисунку.
    const nodes = [...el.querySelectorAll('circle.node')]
    const target = nodes.find((n) => n.getAttribute('cx') === '136')!
    key(target, 'ArrowRight')
    fixture.detectChanges()
    expect(el.textContent).toContain(STATION_TEXT.unsaved)
    const save = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(STATION_TEXT.save),
    )!
    save.click()
    await fixture.whenStable()
    expect(port.save).toHaveBeenCalledWith(2, 'st-b', expect.objectContaining({ version: 1 }), 'v1')
    fixture.detectChanges()
    expect(el.textContent).toContain(STATION_TEXT.saved)
  })

  it('показывает причину отклонённого сдвига стрелки', async () => {
    const { fixture, el } = await render(client())
    const sw = el.querySelector('circle.node.switch')!
    key(sw, 'ArrowDown')
    fixture.detectChanges()
    expect(el.querySelector('.problem')?.textContent).toContain('только вдоль своего пути')
  })

  it('при отказе уйти от несохранённых правок оставляет станцию и её выбор в списке', async () => {
    const port = client()
    const { fixture, el } = await render(port)
    const nodes = [...el.querySelectorAll('circle.node')]
    key(
      nodes.find((n) => n.getAttribute('cx') === '136')!,
      'ArrowRight',
    )
    fixture.detectChanges()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const select = el.querySelector<HTMLSelectElement>('#stations-station')!
    select.value = 'st-a'
    select.dispatchEvent(new Event('change'))
    await fixture.whenStable()
    expect(confirm).toHaveBeenCalledWith(STATION_TEXT.discard)
    expect(select.value).toBe('st-b')
    expect(port.load).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('не выпускает из раздела с несохранёнными правками без подтверждения', async () => {
    const { fixture, el } = await render(client())
    const component = fixture.componentInstance
    const leave = () =>
      TestBed.runInInjectionContext(() =>
        stationEditorLeaveGuard(component, {} as never, {} as never, {} as never),
      )
    expect(leave()).toBe(true)
    key(
      [...el.querySelectorAll('circle.node')].find((n) => n.getAttribute('cx') === '136')!,
      'ArrowRight',
    )
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    expect(leave()).toBe(false)
    confirm.mockReturnValue(true)
    expect(leave()).toBe(true)
    confirm.mockRestore()
  })

  it('в действующей редакции схему можно только смотреть', async () => {
    const { el } = await render(client(false))
    expect(el.textContent).toContain(STATION_TEXT.readOnly)
    expect(el.querySelector('input')).toBeNull()
    expect(el.querySelector('circle.node.editable')).toBeNull()
  })

  it('сообщает об ошибке паспорта', async () => {
    const port = client()
    port.editions = vi.fn<StationEditorClient['editions']>(async () => err({ message: 'Нет базы' }))
    const { el } = await render(port)
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Нет базы')
  })
})
