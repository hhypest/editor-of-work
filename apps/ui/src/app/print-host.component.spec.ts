import { TestBed } from '@angular/core/testing'
import { mm } from '@eow/documents/application'
import type { EowApi } from '@eow/ipc/contracts'
import { PRINT_HOST_API, PRINT_HOST_FONTS, PrintHostComponent } from './print-host.component'
it.each([false, true])(
  'рисует только готовую модель и уведомляет main после шрифтов (отказ: %s)',
  async (failure) => {
    const page = {
      number: 4,
      width: { unit: 'mm' as const, value: 420 as const },
      height: { unit: 'mm' as const, value: 297 as const },
      primitives: [
        {
          kind: 'text' as const,
          x: mm(10),
          y: mm(20),
          text: '<script>Учебный лист</script>',
          font: { family: 'PT Sans' as const, weight: 400 as const, size: mm(4) },
        },
      ],
    }
    const api = {
      printHost: vi.fn<EowApi['printHost']>(async (request) =>
        request.action === 'load' ? { status: 'page', page } : { status: 'ok' },
      ),
    }
    const prepare = async () => {
      expect(document.querySelector('svg')).toBeTruthy()
      expect(api.printHost).not.toHaveBeenCalledWith({ action: 'ready' })
      if (failure) throw new Error('Учебный отказ шрифта')
    }
    await TestBed.configureTestingModule({
      imports: [PrintHostComponent],
      providers: [
        { provide: PRINT_HOST_API, useValue: api },
        { provide: PRINT_HOST_FONTS, useValue: prepare },
      ],
    }).compileComponents()
    const fixture = TestBed.createComponent(PrintHostComponent)
    await fixture.whenStable()
    fixture.detectChanges()
    // afterNextRender проходит через несколько циклов планировщика Angular.
    await fixture.whenStable()
    expect(api.printHost).toHaveBeenLastCalledWith({ action: failure ? 'failed' : 'ready' })
    const root = fixture.nativeElement as HTMLElement
    expect(root.querySelector('nav')).toBeNull()
    expect(root.querySelector('svg script')).toBeNull()
    expect(root.querySelector('svg')?.getAttribute('width')).toBe('420mm')
    expect(root.textContent).toContain('<script>Учебный лист</script>')
  },
)
