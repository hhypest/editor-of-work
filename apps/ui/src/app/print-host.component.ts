import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  Injector,
  afterNextRender,
  inject,
  signal,
} from '@angular/core'
import { DOCUMENT } from '@angular/common'
import { SheetA3Component } from '@eow/documents/ui-sheets'
import { prepareSheetMeasurer } from '@eow/documents/infrastructure'
import type { SheetPage } from '@eow/documents/application'
import type { EowApi } from '@eow/ipc/contracts'

export const PRINT_HOST_FONTS = new InjectionToken<() => Promise<void>>('Шрифты печати', {
  factory: () => {
    const document = inject(DOCUMENT)
    return async () => {
      await prepareSheetMeasurer(document)
      await document.fonts.ready
    }
  },
})
export const PRINT_HOST_API = new InjectionToken<Pick<EowApi, 'printHost'> | undefined>(
  'Окно печати',
  {
    factory: () => window.eow,
  },
)
@Component({
  selector: 'eow-root',
  imports: [SheetA3Component],
  // Каждый лист — отдельная страница А3; после последнего разрыва нет, чтобы не было пустой.
  template: `@for (sheet of pages(); track $index) {
    <div class="sheet"><eow-sheet-a3 [page]="sheet" [zoom]="1" /></div>
  }`,
  styles: `
    :host {
      display: block;
      width: 420mm;
    }
    .sheet {
      width: 420mm;
      height: 297mm;
      overflow: hidden;
      break-after: page;
    }
    .sheet:last-child {
      break-after: auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrintHostComponent {
  protected readonly pages = signal<readonly SheetPage[]>([])
  private readonly api = inject(PRINT_HOST_API)
  private readonly injector = inject(Injector)
  private readonly prepareFonts = inject(PRINT_HOST_FONTS)
  constructor() {
    afterNextRender(() => void this.load())
  }
  private async load(): Promise<void> {
    if (!this.api) return
    try {
      const result = await this.api.printHost({ action: 'load' })
      if (result.status !== 'pages') throw new Error('Нет модели печати')
      this.pages.set(result.pages)
      await new Promise<void>((resolve) =>
        afterNextRender(() => resolve(), { injector: this.injector }),
      )
      await this.prepareFonts()
      await this.api.printHost({ action: 'ready' })
    } catch {
      await this.api.printHost({ action: 'failed' }).catch(() => undefined)
    }
  }
}
