import { TestBed } from '@angular/core/testing'
import type { PassportBackup } from '@eow/passport/application'
import { err, ok } from '@eow/shared/kernel'
import { PassportBackupsComponent } from './passport-backups.component'
import { backupEditions, backupSize } from './passport-backups.facade'
import { PASSPORT_CLIENT, type PassportClient } from './passport.facade'

const backups: readonly PassportBackup[] = [
  {
    id: 'passport-restore-2026-10-28T07-05-09.123Z-00000000-0000-4000-8000-000000000001.sqlite',
    reason: 'restore',
    createdAt: '2026-10-28T07:05:09.123Z',
    bytes: 3 * 1024 * 1024,
    editions: [
      { number: 1, date: '2026-10-22', label: 'Первая', status: 'active' },
      { number: 2, date: '2027-01-01', label: 'Вторая', status: 'draft' },
    ],
  },
  {
    id: 'passport-migration-2026-10-27T07-05-09.123Z-00000000-0000-4000-8000-000000000002.sqlite',
    reason: 'migration',
    createdAt: '2026-10-27T07:05:09.123Z',
    bytes: 1024,
    editions: [],
    problem: 'Копия создана более новой программой.',
  },
]

function client(): PassportClient {
  return {
    list: vi.fn<PassportClient['list']>(async () => ok([])),
    createDraft: vi.fn<PassportClient['createDraft']>(async () => ok(null)),
    activate: vi.fn<PassportClient['activate']>(async () => ok(null)),
    editionData: vi.fn<PassportClient['editionData']>(async () =>
      err({ kind: 'not-found', message: 'нет' }),
    ),
    backups: vi.fn<PassportClient['backups']>(async () => ok(backups)),
    restoreBackup: vi.fn<PassportClient['restoreBackup']>(async () => ok(null)),
  }
}

async function setup(port = client()) {
  await TestBed.configureTestingModule({
    imports: [PassportBackupsComponent],
    providers: [{ provide: PASSPORT_CLIENT, useValue: port }],
  }).compileComponents()
  const fixture = TestBed.createComponent(PassportBackupsComponent)
  const restored = vi.fn<() => void>()
  fixture.componentInstance.restored.subscribe(restored)
  fixture.detectChanges()
  const root = fixture.nativeElement as HTMLElement
  const button = (text: string) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
  const settle = async () => {
    await fixture.whenStable()
    fixture.detectChanges()
  }
  return { fixture, root, port, restored, button, settle }
}

describe('Резервные копии базы на странице паспорта', () => {
  it('подписи: редакции копии одной строкой и размер в мегабайтах', () => {
    expect(backupEditions(backups[0]!)).toBe(
      '№ 1 · 2026-10-22 · Первая — действующая; № 2 · 2027-01-01 · Вторая — черновик',
    )
    expect(backupSize(backups[0]!.bytes)).toBe('3,0 МБ')
  })

  it('список загружается только по запросу; копию с ошибкой восстановить нельзя', async () => {
    const { root, port, button, settle } = await setup()
    expect(port.backups).not.toHaveBeenCalled()
    button('Показать копии')!.click()
    await settle()
    expect(port.backups).toHaveBeenCalledOnce()
    const rows = [...root.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('Перед восстановлением')
    expect(rows[0]!.textContent).toContain('№ 1 · 2026-10-22 · Первая — действующая')
    expect(rows[1]!.textContent).toContain('Копия создана более новой программой.')
    expect(rows[1]!.querySelector('button')!.disabled).toBe(true)
    expect(rows[0]!.querySelector('button')!.disabled).toBe(false)
  })

  it('восстановление только после подтверждения; отмена ничего не меняет; успех перечитывает список', async () => {
    const { root, port, restored, button, settle } = await setup()
    button('Показать копии')!.click()
    await settle()
    root.querySelector<HTMLButtonElement>('tbody tr button')!.click()
    await settle()
    expect(root.querySelector('[role="alertdialog"]')!.textContent).toContain(
      'текущая база сначала будет сохранена копией',
    )
    button('Отмена')!.click()
    await settle()
    expect(port.restoreBackup).not.toHaveBeenCalled()
    expect(root.querySelector('[role="alertdialog"]')).toBeNull()

    root.querySelector<HTMLButtonElement>('tbody tr button')!.click()
    await settle()
    button('Восстановить базу')!.click()
    await settle()
    expect(port.restoreBackup).toHaveBeenCalledExactlyOnceWith(backups[0]!.id)
    expect(restored).toHaveBeenCalledOnce()
    expect(port.backups).toHaveBeenCalledTimes(2)
    expect(root.querySelector('[role="status"]')!.textContent).toContain('База восстановлена')
  })

  it('ошибка восстановления показывается и страница не перечитывает редакции', async () => {
    const port = client()
    vi.mocked(port.restoreBackup).mockResolvedValueOnce(
      err({ kind: 'storage', message: 'Не удалось восстановить копию.' }),
    )
    const { root, restored, button, settle } = await setup(port)
    button('Показать копии')!.click()
    await settle()
    root.querySelector<HTMLButtonElement>('tbody tr button')!.click()
    await settle()
    button('Восстановить базу')!.click()
    await settle()
    expect(root.querySelector('[role="alert"]')!.textContent).toContain(
      'Не удалось восстановить копию.',
    )
    expect(restored).not.toHaveBeenCalled()
  })
})
