import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import type { SheetPage } from '@eow/documents/application'

@Component({
  selector: 'eow-sheet-a3',
  templateUrl: './sheet-a3.component.html',
  styles:
    ':host { display: block; } svg { display: block; background: white; box-shadow: 0 1px 8px #0003; } text { font-kerning: none; font-variant-ligatures: none; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SheetA3Component {
  readonly page = input.required<SheetPage>()
  readonly zoom = input(0.7)
}
