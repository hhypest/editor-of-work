import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { App } from './app'
import { APP_INFO, appInfoSource } from './app-info'

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents()
  })

  it('показывает название программы и навигацию по разделам', async () => {
    const fixture = TestBed.createComponent(App)
    await fixture.whenStable()
    fixture.detectChanges()
    const compiled = fixture.nativeElement as HTMLElement
    expect(compiled.querySelector('h1')?.textContent).toContain('editor-of-work')
    const links = [...compiled.querySelectorAll('nav a')].map((a) => a.textContent?.trim())
    expect(links).toEqual([
      'Паспорт',
      'Импорт выгрузок',
      'Ручные данные',
      'Листы ПД',
      'Схема А3',
      'Потребность в ремонте',
      'Годовой план',
    ])
  })

  it('показывает версию продукта и формата плана из main', async () => {
    TestBed.overrideProvider(APP_INFO, {
      useValue: async () => ({ version: '0.5.0-alpha.1', planFormat: 7 }),
    })
    const fixture = TestBed.createComponent(App)
    await fixture.whenStable()
    fixture.detectChanges()
    const text = (fixture.nativeElement as HTMLElement).querySelector('.app-version')?.textContent
    expect(text).toContain('версия 0.5.0-alpha.1')
    expect(text).toContain('формат плана v7')
  })

  it('без main и при ошибке канала шапка остаётся без версии', async () => {
    expect(await appInfoSource(undefined)()).toBeNull()
    const failing = { appInfo: () => Promise.reject(new Error('Учебный сбой')) }
    expect(await appInfoSource(failing as never)()).toBeNull()
    const fixture = TestBed.createComponent(App)
    await fixture.whenStable()
    fixture.detectChanges()
    expect((fixture.nativeElement as HTMLElement).querySelector('.app-version')).toBeNull()
  })
})
