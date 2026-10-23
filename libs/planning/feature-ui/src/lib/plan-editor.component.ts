import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core'
import type {
  PlanPageSelection,
  PlanPdScaleChange,
  PlanPreviewContext,
} from '@eow/planning/sheet-api'
import { FormsModule } from '@angular/forms'
import { PlanEditorFacade } from './plan-editor.facade'
@Component({
  selector: 'eow-plan-editor',
  imports: [FormsModule],
  templateUrl: './plan-editor.component.html',
  styleUrl: './plan-editor.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'key($event)' },
})
export class PlanEditorComponent {
  readonly previewContext = output<PlanPreviewContext>()
  readonly printRequested = output<void>()
  readonly pageSelection = input<PlanPageSelection | null>(null)
  protected readonly facade = inject(PlanEditorFacade)
  protected readonly workScope = signal<'area' | 'page'>('area')
  protected readonly pageFilter = computed(
    () => this.workScope() === 'page' && this.facade.view()?.area.startsWith('pd:'),
  )
  protected readonly currentPage = computed(() => {
    const selected = this.pageSelection(),
      state = this.facade.state()
    return selected &&
      selected.revision === state?.revision &&
      selected.area === state.view?.area &&
      !this.facade.busy() &&
      !state.hasRecovery
      ? selected
      : null
  })
  protected readonly visibleWorks = computed(() => {
    const works = this.facade.view()?.works ?? []
    if (!this.pageFilter()) return works
    const ids = new Set(this.currentPage()?.workIds ?? [])
    return works.filter((w) => ids.has(w.id))
  })
  protected readonly editionNumber = signal('')
  protected readonly editionDate = signal('')
  constructor() {
    effect(() => {
      const state = this.facade.state()
      this.previewContext.emit({
        revision: state?.revision ?? 0,
        area: this.facade.area(),
        hasPlan: state?.view !== null && state?.view !== undefined,
        hasRecovery: state?.hasRecovery ?? false,
        busy: this.facade.busy(),
        pending: this.facade.pending(),
        pdScale: state?.view?.pdScale ?? null,
        planEpoch: this.facade.planEpoch(),
      })
    })
    void this.facade.initialize()
  }
  savePdScale(change: PlanPdScaleChange): void {
    void this.facade.savePdScale(change)
  }
  protected key(event: KeyboardEvent): void {
    if ((!event.ctrlKey && !event.metaKey) || event.altKey) return
    const key = shortcutCode(event),
      target = event.target,
      editable =
        target instanceof HTMLElement &&
        (target.matches('input,textarea,select') || target.isContentEditable)
    if (key === 'KeyS') {
      event.preventDefault()
      void this.facade.save(event.shiftKey)
    } else if (key === 'KeyP') {
      event.preventDefault()
      this.printRequested.emit()
    } else if (!editable && key === 'KeyZ') {
      event.preventDefault()
      void this.facade.history(event.shiftKey ? 'redo' : 'undo')
    } else if (!editable && key === 'KeyY') {
      event.preventDefault()
      void this.facade.history('redo')
    }
  }
  protected import(): void {
    void this.facade.requestOpen({
      kind: 'import',
      edition: { number: this.editionNumber(), date: this.editionDate() },
    })
  }
}

/** При вводе через службы Windows физический code бывает пустым; key зависит от раскладки. */
function shortcutCode(event: KeyboardEvent): string {
  if (event.code && event.code !== 'Unidentified') return event.code
  switch (event.key.toLowerCase()) {
    case 's':
    case 'ы':
      return 'KeyS'
    case 'p':
    case 'з':
      return 'KeyP'
    case 'z':
    case 'я':
      return 'KeyZ'
    case 'y':
    case 'н':
      return 'KeyY'
    default:
      return ''
  }
}
