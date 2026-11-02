import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core'
import { cellAt, type DrawingPoint, type DrawnNode } from '@eow/stations/application'
import { STATION_TEXT, StationEditorFacade } from './station-editor.facade'

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
  private drag: { readonly node: string; readonly key: string } | undefined
  private drags = 0

  constructor() {
    void this.facade.load()
  }

  protected pointsOf(points: readonly DrawingPoint[]): string {
    return points.map((p) => `${p.x},${p.y}`).join(' ')
  }

  protected selectEdition(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement) || !this.leave()) return
    void this.facade.selectEdition(Number(event.target.value))
  }

  protected selectStation(event: Event): void {
    if (!(event.target instanceof HTMLSelectElement) || !this.leave()) return
    void this.facade.selectStation(event.target.value)
  }

  /** Одно перетаскивание — один шаг отмены: сдвиги идут с общим ключом. */
  protected startDrag(event: PointerEvent, node: DrawnNode): void {
    if (!this.facade.editable()) return
    event.preventDefault()
    if (event.target instanceof Element) event.target.setPointerCapture?.(event.pointerId)
    this.drag = { node: node.id, key: `drag-${++this.drags}` }
  }

  protected moveDrag(event: PointerEvent): void {
    const drag = this.drag
    const svg = event.currentTarget
    if (!drag || !(svg instanceof SVGSVGElement)) return
    const matrix = svg.getScreenCTM()
    if (!matrix) return
    const inverse = matrix.inverse()
    const point = {
      x: inverse.a * event.clientX + inverse.c * event.clientY + inverse.e,
      y: inverse.b * event.clientX + inverse.d * event.clientY + inverse.f,
    }
    this.facade.edit({ kind: 'move', node: drag.node, to: cellAt(point), drag: drag.key })
  }

  protected endDrag(): void {
    if (!this.drag) return
    this.drag = undefined
    this.facade.edit({ kind: 'end-drag' })
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
    if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement) return
    const key = event.key.toLowerCase()
    if (key === 'z' && !event.shiftKey) this.facade.edit({ kind: 'undo' })
    else if (key === 'y' || (key === 'z' && event.shiftKey)) this.facade.edit({ kind: 'redo' })
    else if (key === 's') void this.facade.save()
    else return
    event.preventDefault()
  }

  private leave(): boolean {
    return !this.facade.dirty() || window.confirm(STATION_TEXT.discard)
  }
}
