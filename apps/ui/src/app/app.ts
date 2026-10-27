import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { APP_INFO, type AppInfo } from './app-info'

@Component({
  selector: 'eow-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly title = 'editor-of-work'
  protected readonly info = signal<AppInfo | null>(null)

  constructor() {
    const source = inject(APP_INFO, { optional: true })
    if (source) void source().then((info) => this.info.set(info))
  }
}
