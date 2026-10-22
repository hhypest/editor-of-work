import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { App } from './app'

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
      'Схема А3',
      'Потребность в ремонте',
      'Годовой план',
    ])
  })
})
