import { TestBed } from '@angular/core/testing'
import { PLAN_EDITOR_CLIENT } from '@eow/planning/feature-ui'
import { EDITOR_SHEET_CLIENT, SHEET_MEASURER } from '@eow/documents/ui-sheets'
import { mm, type EditorSheetClient } from '@eow/documents/application'
import {
  changeEditor,
  editorView,
  openPlanSession,
  planSheetData,
  type PlanEditorClient,
} from '@eow/planning/application'
import { createAnnualPlan, samplePlanBasis } from '@eow/planning/domain'
import type { Result } from '@eow/shared/kernel'
import { PlanWorkspaceComponent } from './plan-workspace.component'

const value = <T>(result: Result<T, unknown>): T => {
  if (!result.ok) throw new Error('Ошибка вымышленного плана')
  return result.value
}
it('composition root обновляет SVG после добавления, изменения, undo/redo, таблиц, грифа и удаления без сохранения', async () => {
  let session = openPlanSession(value(createAnnualPlan(2027, samplePlanBasis())))
  let revision = 1
  const editor: PlanEditorClient = {
    async send(command, expected, area) {
      if (command.kind === 'editions') return { kind: 'editions', editions: [] }
      if (command.kind === 'checkPlace')
        return { kind: 'place', revision, hint: { normalized: null, meters: null, issues: [] } }
      if (
        command.kind === 'open' ||
        command.kind === 'import' ||
        command.kind === 'create' ||
        command.kind === 'save' ||
        command.kind === 'recover'
      )
        throw new Error('Файл в этом сценарии не открывается и не сохраняется')
      if (command.kind !== 'state') {
        expect(expected).toBe(revision)
        session = value(changeEditor(session, command, area, { next: () => 'work-1' }))
        ++revision
      }
      return {
        kind: 'state',
        state: {
          revision,
          dirty: revision > 1,
          hasFile: false,
          hasRecovery: false,
          autosaveError: null,
          view: value(editorView(session, area)),
        },
      }
    },
  }
  const sheets: EditorSheetClient = {
    source: vi.fn<EditorSheetClient['source']>(async (expected, pd) => {
      expect(expected).toBe(revision)
      return planSheetData(session.present, pd)
    }),
  }
  await TestBed.configureTestingModule({
    imports: [PlanWorkspaceComponent],
    providers: [
      { provide: PLAN_EDITOR_CLIENT, useValue: editor },
      { provide: EDITOR_SHEET_CLIENT, useValue: sheets },
      {
        provide: SHEET_MEASURER,
        useValue: async () => ({
          width: (text: string, font: { size: { value: number } }) =>
            mm(text.length * font.size.value * 0.4),
        }),
      },
    ],
  }).compileComponents()
  const fixture = TestBed.createComponent(PlanWorkspaceComponent)
  const element = fixture.nativeElement as HTMLElement
  const settle = async () => {
    await fixture.whenStable()
    fixture.detectChanges()
  }
  const input = async (id: string, text: string, event = 'input') => {
    const field = element.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `#${id}`,
    )!
    field.value = text
    field.dispatchEvent(new Event(event))
    await settle()
  }
  const click = async (text: string) => {
    const button = [...element.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text,
    )
    expect(button).toBeTruthy()
    button!.click()
    await settle()
  }
  const history = async (code: string) => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { code, ctrlKey: true, bubbles: true, cancelable: true }),
    )
    await settle()
  }
  const svg = () => element.querySelector('eow-editor-sheets svg')?.textContent ?? ''
  await settle()
  expect(element.querySelector('svg')).toBeNull()
  await input('plan-area', 'pd:ПД-1', 'change')
  expect(svg()).toContain('ПД-1')
  await input('work-place', '10+0 – 11+0')
  expect(element.textContent).toContain('Есть незавершённый ввод')
  await click('Применить работу')
  expect(svg()).toContain('1 км в ПД')
  await click('Изменить')
  await input('work-place', '10+0 – 12+0')
  await click('Применить работу')
  expect(svg()).toContain('2 км в ПД')
  await history('KeyZ')
  expect(svg()).toContain('1 км в ПД')
  await history('KeyY')
  expect(svg()).toContain('2 км в ПД')
  const manual = element.querySelector<HTMLInputElement>('input[aria-label$=": ручной план"]')!
  manual.value = '7'
  manual.dispatchEvent(new Event('input'))
  await settle()
  await click('Применить значения таблиц')
  expect(svg()).toContain('7 *')
  await input('approval-title', 'Учебный начальник')
  await click('Применить гриф')
  expect(svg()).toContain('Учебный начальник')
  await click('Удалить')
  expect(svg()).not.toContain('км в ПД')
  await history('KeyZ')
  expect(svg()).toContain('2 км в ПД')
  await click('Добавить показатель')
  const indicatorInput = async (label: string, text: string) => {
    const field = element.querySelector<HTMLInputElement>(`[aria-label="${label} показателя 1"]`)!
    field.value = text
    field.dispatchEvent(new Event('input'))
    await settle()
  }
  await indicatorInput('Наименование', '<Учебный показатель>')
  await indicatorInput('Единица', 'шт.')
  await indicatorInput('Значение', '-1,25')
  expect(svg()).not.toContain('Ручные показатели ПД')
  await click('Применить показатели')
  await click('Следующий лист')
  expect(svg()).toContain('Ручные показатели ПД')
  expect(svg()).toContain('<Учебный показатель>')
  expect(svg()).toContain('-1,25')
  expect(element.querySelector('учебный')).toBeNull()
  await history('KeyZ')
  expect(svg()).not.toContain('Ручные показатели ПД')
  await history('KeyY')
  await click('Следующий лист')
  expect(svg()).toContain('<Учебный показатель>')
  await click('Удалить показатель 1')
  expect(svg()).toContain('<Учебный показатель>')
  await click('Применить показатели')
  expect(svg()).not.toContain('Ручные показатели ПД')
  await history('KeyZ')
  await click('Следующий лист')
  expect(svg()).toContain('<Учебный показатель>')
  expect(sheets.source).toHaveBeenLastCalledWith(revision, 'ПД-1')
  expect(session.present.works).toHaveLength(1)
  const currentSession = session,
    currentRevision = revision,
    sourceCalls = vi.mocked(sheets.source).mock.calls.length
  const list = () => element.querySelector('[aria-labelledby="works-title"]')!.textContent!
  await input('work-list-scope', 'page', 'change')
  expect(list()).toContain('На текущем листе нет работ')
  expect(list()).toContain('0 из 1')
  await click('Предыдущий лист')
  expect(list()).toContain('Планово-предупредительная выправка')
  expect(list()).toContain('1 из 1')
  await click('Изменить')
  await input('work-note', 'Черновик при переходе страницы')
  await click('Следующий лист')
  expect(list()).toContain('На текущем листе нет работ')
  expect(element.querySelector<HTMLTextAreaElement>('#work-note')!.value).toBe(
    'Черновик при переходе страницы',
  )
  await input('work-list-scope', 'area', 'change')
  expect(list()).toContain('Планово-предупредительная выправка')
  expect(session).toBe(currentSession)
  expect(revision).toBe(currentRevision)
  expect(sheets.source).toHaveBeenCalledTimes(sourceCalls)
  await click('Отменить ввод / новая работа')
  await input('work-list-scope', 'page', 'change')
  await input('editor-sheet-scale', '100000', 'change')
  expect(list()).toContain('Планово-предупредительная выправка')
  expect(session).toBe(currentSession)
  await input('work-note', 'Незавершённый ввод перед настройкой')
  const saveScale = [...element.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Сохранить масштаб в плане',
  )!
  expect(saveScale.disabled).toBe(true)
  saveScale.click()
  await settle()
  expect(session).toBe(currentSession)
  await click('Отменить ввод / новая работа')
  await click('Сохранить масштаб в плане')
  expect(session.present.pdScales.get('ПД-1')).toBe(100000)
  expect(revision).toBe(currentRevision + 1)
  expect(svg()).toContain('1:100000')
  await history('KeyZ')
  expect(element.querySelector<HTMLSelectElement>('#editor-sheet-scale')!.value).toBe('50000')
  await history('KeyY')
  expect(element.querySelector<HTMLSelectElement>('#editor-sheet-scale')!.value).toBe('100000')
  await input('plan-area', 'pd:ПД-2', 'change')
  expect(element.querySelector<HTMLSelectElement>('#editor-sheet-scale')!.value).toBe('50000')
  await input('editor-sheet-scale', '25000', 'change')
  await click('Сохранить масштаб в плане')
  await input('plan-area', 'pd:ПД-1', 'change')
  expect(element.querySelector<HTMLSelectElement>('#editor-sheet-scale')!.value).toBe('100000')
  expect([...session.present.pdScales]).toEqual([
    ['ПД-1', 100000],
    ['ПД-2', 25000],
  ])
  const beforeTables = session
  const toggleTable = async (key: string, checked: boolean) => {
    const field = element.querySelector<HTMLInputElement>(`#pd-table-${key}`)!
    field.checked = checked
    field.dispatchEvent(new Event('change'))
    await settle()
  }
  await toggleTable('current', false)
  await toggleTable('summary', false)
  await toggleTable('works', false)
  expect(session).toBe(beforeTables)
  expect(element.textContent).toContain('Есть незавершённый ввод')
  await click('Применить состав таблиц')
  expect(session.present.pdHiddenTables.get('ПД-1')).toEqual(['current', 'summary', 'works'])
  expect(session.present.works).toBe(beforeTables.present.works)
  expect(svg()).not.toContain('План текущего содержания')
  expect(svg()).not.toContain('Ведомость работ ПД')
  expect(svg()).toContain('<Учебный показатель>')
  await history('KeyZ')
  expect(svg()).toContain('План текущего содержания')
  expect(element.querySelector<HTMLInputElement>('#pd-table-works')!.checked).toBe(true)
  await history('KeyY')
  expect(svg()).not.toContain('Ведомость работ ПД')
  await input('plan-area', 'pd:ПД-2', 'change')
  expect(element.querySelector<HTMLInputElement>('#pd-table-works')!.checked).toBe(true)
  await input('plan-area', 'pd:ПД-1', 'change')
  expect(element.querySelector<HTMLInputElement>('#pd-table-works')!.checked).toBe(false)
})
