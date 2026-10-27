import type { EowApi } from '@eow/ipc/contracts'
import { editorSheetClient } from './editor-sheet-client'
const source = {
  year: 2027,
  edition: { number: '1', date: '2027-01-01' },
  approval: { title: '', name: '', year: 2026 },
  lines: [],
  pds: [],
}
const api: EowApi = {
  printHost: async () => ({ status: 'error', message: 'unused' }),
  appInfo: async () => ({ name: 'editor-of-work', version: '0', planFormat: 7 }),
  passport: async () => ({ status: 'ok', editions: [] }),
  passportData: async () => ({ status: 'error', message: 'unused' }),
  repairs: async () => ({ status: 'error', message: 'unused' }),
  manualTemplate: async () => ({ status: 'cancelled' }),
  exportWizard: async () => ({ status: 'cancelled' }),
  planFile: vi.fn<EowApi['planFile']>(),
}
it('передаёт ревизию и ПД; отклоняет чужую ревизию, ошибки и старый вариант ответа', async () => {
  const port = editorSheetClient(api)
  vi.mocked(api.planFile).mockResolvedValueOnce({ status: 'editorSheets', revision: 7, source })
  expect(await port.source(7, 'ПД-1')).toEqual({ ok: true, value: source })
  expect(api.planFile).toHaveBeenLastCalledWith({
    action: 'previewEditorSheets',
    revision: 7,
    pd: 'ПД-1',
  })
  for (const response of [
    { status: 'editorSheets', revision: 8, source },
    { status: 'sheets', source },
    { status: 'error', message: 'Учебная ошибка' },
  ] as const) {
    vi.mocked(api.planFile).mockResolvedValueOnce(response)
    expect(await port.source(7, 'ПД-1')).toMatchObject({ ok: false })
  }
  expect(await editorSheetClient(undefined).source(7, 'ПД-1')).toMatchObject({ ok: false })
})
