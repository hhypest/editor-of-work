import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core'
import type { CanDeactivateFn } from '@angular/router'
import {
  cellAt,
  type Cell,
  type DrawingPoint,
  type DrawnNode,
  type LayoutObjectKind,
} from '@eow/stations/application'
import { STATION_TEXT, StationEditorFacade, type SchemeSelection } from './station-editor.facade'

/** Что тащим: узел, объект (с клеткой захвата внутри него) или ось переезда. */
type Drag =
  | { readonly kind: 'node'; readonly id: string; readonly key: string }
  | { readonly kind: 'object'; readonly id: string; readonly key: string; readonly grip: Cell }
  | { readonly kind: 'crossing'; readonly id: string; readonly key: string }

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

@Component({
  selector: 'eow-station-editor',
  providers: [StationEditorFacade],
  templateUrl: './station-editor.component.html',
  styleUrl: './station-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StationEditorComponent {
  protected readonly facade = inject(StationEditorFacade)
  protected readonly text = STATION_TEXT
  private drag: Drag | undefined
  private drags = 0

  constructor() {
    void this.facade.load()
  }

  protected pointsOf(points: readonly DrawingPoint[]): string {
    return points.map((p) => `${p.x},${p.y}`).join(' ')
  }

  protected selectEdition(event: Event): void {
    const select = event.target
    if (!(select instanceof HTMLSelectElement)) return
    // Список уже показывает новый выбор: при отказе возвращаем текущую редакцию.
    if (!this.canLeave()) {
      select.value = String(this.facade.edition() ?? '')
      return
    }
    void this.facade.selectEdition(Number(select.value))
  }

  protected selectStation(event: Event): void {
    const select = event.target
    if (!(select instanceof HTMLSelectElement)) return
    if (!this.canLeave()) {
      select.value = this.facade.station() ?? ''
      return
    }
    void this.facade.selectStation(select.value)
  }

  private pointer(event: PointerEvent): DrawingPoint | undefined {
    const target = event.target
    const svg = target instanceof SVGElement ? target.ownerSVGElement : null
    const matrix = svg?.getScreenCTM()
    if (!matrix) return undefined
    const inverse = matrix.inverse()
    return {
      x: inverse.a * event.clientX + inverse.c * event.clientY + inverse.e,
      y: inverse.b * event.clientX + inverse.d * event.clientY + inverse.f,
    }
  }

  private capture(event: PointerEvent): void {
    event.preventDefault()
    if (event.target instanceof Element) event.target.setPointerCapture?.(event.pointerId)
  }

  /** Одно перетаскивание — один шаг отмены: сдвиги идут с общим ключом. */
  protected startDrag(event: PointerEvent, node: DrawnNode): void {
    if (!this.facade.editable()) return
    this.capture(event)
    this.drag = { kind: 'node', id: node.id, key: `drag-${++this.drags}` }
  }

  protected startObjectDrag(event: PointerEvent, id: string): void {
    this.facade.select({ kind: 'object', id })
    const object = this.facade.layout()?.objects?.find((o) => o.id === id)
    const point = this.pointer(event)
    if (!this.facade.editable() || !object || !point) return
    this.capture(event)
    const cell = cellAt(point)
    this.drag = {
      kind: 'object',
      id,
      key: `drag-${++this.drags}`,
      grip: { col: cell.col - object.col, row: cell.row - object.row },
    }
  }

  protected startCrossingDrag(event: PointerEvent, id: string): void {
    this.facade.select({ kind: 'crossing', id })
    if (!this.facade.editable()) return
    this.capture(event)
    this.drag = { kind: 'crossing', id, key: `drag-${++this.drags}` }
  }

  protected moveDrag(event: PointerEvent): void {
    const drag = this.drag
    const svg = event.currentTarget
    if (!drag || !(svg instanceof SVGSVGElement)) return
    const matrix = svg.getScreenCTM()
    if (!matrix) return
    const inverse = matrix.inverse()
    const cell = cellAt({
      x: inverse.a * event.clientX + inverse.c * event.clientY + inverse.e,
      y: inverse.b * event.clientX + inverse.d * event.clientY + inverse.f,
    })
    if (drag.kind === 'node')
      this.facade.edit({ kind: 'move', node: drag.id, to: cell, drag: drag.key })
    else if (drag.kind === 'crossing')
      this.facade.edit({ kind: 'move-crossing', crossing: drag.id, col: cell.col, drag: drag.key })
    else
      this.facade.edit({
        kind: 'move-object',
        object: drag.id,
        to: {
          col: Math.max(0, cell.col - drag.grip.col),
          row: Math.max(0, cell.row - drag.grip.row),
        },
        drag: drag.key,
      })
  }

  protected endDrag(): void {
    if (!this.drag) return
    this.drag = undefined
    this.facade.edit({ kind: 'end-drag' })
  }

  protected select(selection: SchemeSelection): void {
    this.facade.select(selection)
  }

  protected add(kind: LayoutObjectKind | 'crossing'): void {
    this.facade.edit(
      kind === 'crossing' ? { kind: 'add-crossing' } : { kind: 'add-object', objectKind: kind },
    )
  }

  /** Стрелки клавиатуры сдвигают узел на клетку: каждое нажатие — отдельный шаг отмены. */
  protected nudge(event: KeyboardEvent, node: DrawnNode): void {
    const step = ARROWS[event.key]
    const layout = this.facade.layout()
    const source = layout?.nodes.find((n) => n.id === node.id)
    if (!step || !source) return
    event.preventDefault()
    this.facade.edit({
      kind: 'move',
      node: node.id,
      to: { col: source.col + step[0], row: source.row + step[1] },
    })
  }

  /** Стрелки клавиатуры сдвигают выбранный объект или переезд на клетку. */
  protected nudgeElement(event: KeyboardEvent, selection: SchemeSelection): void {
    const step = ARROWS[event.key]
    const layout = this.facade.layout()
    if (!step || !layout) return
    if (selection.kind === 'object') {
      const object = layout.objects?.find((o) => o.id === selection.id)
      if (!object) return
      event.preventDefault()
      this.facade.edit({
        kind: 'move-object',
        object: object.id,
        to: { col: object.col + step[0], row: object.row + step[1] },
      })
    } else if (selection.kind === 'crossing' && step[0] !== 0) {
      const crossing = layout.crossings.find((c) => c.id === selection.id)
      if (!crossing) return
      event.preventDefault()
      this.facade.edit({
        kind: 'move-crossing',
        crossing: crossing.id,
        col: crossing.col + step[0],
      })
    }
  }

  /** Поле карточки: пустое число — null, нечисловое — отклоняется доменом как неверное. */
  protected numberValue(event: Event): number | null {
    if (!(event.target instanceof HTMLInputElement)) return null
    const text = event.target.value.trim()
    return text === '' ? null : Number(text)
  }

  protected textValue(event: Event): string {
    return event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
      ? event.target.value
      : ''
  }

  protected renumberTrack(track: string, event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.facade.edit({ kind: 'renumber-track', track, number: event.target.value })
  }

  protected renumberSwitch(switchId: string, event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.facade.edit({ kind: 'renumber-switch', switchId, number: event.target.value })
  }

  @HostListener('document:keydown', ['$event'])
  protected shortcut(event: KeyboardEvent): void {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLSelectElement
    )
      return
    const key = event.key.toLowerCase()
    if (key === 'z' && !event.shiftKey) this.facade.edit({ kind: 'undo' })
    else if (key === 'y' || (key === 'z' && event.shiftKey)) this.facade.edit({ kind: 'redo' })
    else if (key === 's') void this.facade.save()
    else return
    event.preventDefault()
  }

  /** Можно ли уйти со станции: без правок — сразу, с правками — после подтверждения. */
  canLeave(): boolean {
    return !this.facade.dirty() || window.confirm(STATION_TEXT.discard)
  }
}

/** Переход в другой раздел не теряет несохранённые правки схемы молча. */
export const stationEditorLeaveGuard: CanDeactivateFn<StationEditorComponent> = (component) =>
  component.canLeave()
