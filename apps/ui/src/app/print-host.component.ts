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
  template: `@if (page(); as sheet) {
    <eow-sheet-a3 [page]="sheet" [zoom]="1" />
  }`,
  styles: ':host { display: block; width: 420mm; height: 297mm; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrintHostComponent {
  protected readonly page = signal<SheetPage | null>(null)
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
      if (result.status !== 'page') throw new Error('Нет модели печати')
      this.page.set(result.page)
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
