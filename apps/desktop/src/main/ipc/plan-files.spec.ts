import { mkdtemp, readFile, rm, writeFile, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { channels, type RequestOf } from '@eow/ipc/contracts'
import { addWork, createAnnualPlan, planBasis, samplePlanBasis, workId } from '@eow/planning/domain'
import {
  decodePlan,
  encodePlan,
  readPlanFile,
  FilePlanStore,
  MAX_PLAN_FILE_BYTES,
} from '@eow/planning/infrastructure'
import { registerPlanFileHandlers } from './plan-files'
import type { EditorAction, EditorDraft, PassportView } from '@eow/planning/application'
import type { IpcMainLike } from './register'

function document(year: number): string {
  const p = createAnnualPlan(year, samplePlanBasis())
  if (!p.ok) throw new Error('нет плана')
  const text = encodePlan(p.value, '0.1.0')
  if (!text.ok) throw new Error('нет файла')
  return text.value
}

function passportInput() {
  const b = samplePlanBasis()
  return {
    edition: b.edition,
    lines: [...b.lines.values()],
    pds: [...b.pds.values()],
    stations: [...b.stations.values()],
    workKinds: [...b.workKinds.values()],
  }
}
describe('планы в main', () => {
  const passport: PassportView = {
    editions: vi.fn<PassportView['editions']>(async () => ({
      ok: true as const,
      value: [
        { id: 7, number: 7, date: '2026-01-15', label: 'Учебная', status: 'active' as const },
      ],
    })),
    basis: vi.fn<PassportView['basis']>(async () => ({
      ok: true as const,
      value: passportInput(),
    })),
  }
  let directory: string
  let path: string
  let stop: () => Promise<void>
  let listener: (event: unknown, ...args: unknown[]) => unknown
  const dialogs = {
    openPrototype: vi.fn<() => Promise<string | undefined>>(),
    open: vi.fn<() => Promise<string | undefined>>(),
    save: vi.fn<() => Promise<string | undefined>>(),
  }
  const invoke = async (request: RequestOf<typeof channels.planFile>) =>
    channels.planFile.response.parse(await listener({}, request))

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'eow-main-'))
    path = join(directory, 'test.ppr.json')
    dialogs.open.mockReset().mockResolvedValue(path)
    dialogs.openPrototype.mockReset().mockResolvedValue(path)
    dialogs.save.mockReset().mockResolvedValue(path)
    const ipc: IpcMainLike = {
      handle: (_name, fn) => {
        listener = fn
      },
    }
    vi.mocked(passport.basis).mockReset().mockResolvedValue({ ok: true, value: passportInput() })
    stop = registerPlanFileHandlers(ipc, dialogs, '0.1.0', passport)
  })
  afterEach(async () => {
    await stop()
    vi.restoreAllMocks()
    vi.useRealTimers()
    await rm(directory, { recursive: true, force: true })
  })

  it('просматривает другой файл без замены текущего плана, пути и содержимого файлов', async () => {
    await invoke({ action: 'update', document: document(2027) })
    const original = document(2028)
    await writeFile(path, original)
    const preview = await invoke({ action: 'previewSheets', open: true })
    expect(preview).toMatchObject({
      status: 'sheets',
      source: { year: 2028, pds: [{ id: 'ПД-1' }, { id: 'ПД-2' }] },
    })
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await invoke({ action: 'state' })).toMatchObject({
      status: 'ok',
      document: document(2027),
    })
    expect(await invoke({ action: 'previewSheets', open: false })).toMatchObject({
      status: 'sheets',
      source: { year: 2027 },
    })
    const savePath = join(directory, 'other.ppr.json')
    dialogs.save.mockResolvedValue(savePath)
    await invoke({ action: 'save', document: document(2027), saveAs: false })
    expect(dialogs.save).toHaveBeenCalledTimes(1)
    expect(await readFile(path, 'utf8')).toBe(original)
  })
  it('отличает отсутствие текущего плана, отмену и неверный файл', async () => {
    expect(await invoke({ action: 'previewSheets', open: false })).toEqual({
      status: 'sheets',
      source: null,
    })
    dialogs.open.mockResolvedValueOnce(undefined)
    expect(await invoke({ action: 'previewSheets', open: true })).toEqual({ status: 'cancelled' })
    await writeFile(path, '{broken')
    expect(await invoke({ action: 'previewSheets', open: true })).toMatchObject({ status: 'error' })
    expect(await invoke({ action: 'previewSheets', open: false })).toEqual({
      status: 'sheets',
      source: null,
    })
  })
  it.each(['open', 'prototype', 'recovery'] as const)(
    'отказ чтения большого %s сохраняет текущий файл и путь',
    async (operation) => {
      const original = document(2026)
      await invoke({ action: 'save', document: original, saveAs: false })
      const selected = join(directory, 'large.json')
      const large = operation === 'recovery' ? `${selected}.autosave` : selected
      if (operation === 'recovery') await writeFile(selected, document(2027))
      const handle = await open(large, 'w')
      try {
        await handle.truncate(MAX_PLAN_FILE_BYTES + 1)
      } finally {
        await handle.close()
      }
      dialogs.open.mockResolvedValueOnce(selected)
      dialogs.openPrototype.mockResolvedValueOnce(selected)
      const response = await invoke(
        operation === 'prototype'
          ? { action: 'importPrototype', edition: { number: 'test', date: '2026-01-01' } }
          : { action: 'open' },
      )
      expect(response).toMatchObject({
        status: 'error',
        message: expect.stringContaining('80 МиБ'),
      })
      expect(await invoke({ action: 'state' })).toMatchObject({ status: 'ok', document: original })
      expect(
        await invoke({ action: 'save', document: document(2028), saveAs: false }),
      ).toMatchObject({ status: 'ok' })
      expect(dialogs.save).toHaveBeenCalledTimes(1)
      expect(await readFile(path, 'utf8')).toBe(document(2028))
    },
  )
  it('выбирает путь диалогом и сохраняет проверенный документ', async () => {
    expect(await invoke({ action: 'save', document: document(2027), saveAs: false })).toMatchObject(
      { status: 'ok' },
    )
    expect(dialogs.save).toHaveBeenCalledTimes(1)
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { year: 2027 },
    })
    await invoke({ action: 'save', document: document(2028), saveAs: false })
    expect(dialogs.save).toHaveBeenCalledTimes(1)
  })

  it('отмена диалога оставляет текущий документ', async () => {
    await invoke({ action: 'update', document: document(2027) })
    dialogs.open.mockResolvedValue(undefined)
    expect(await invoke({ action: 'open' })).toEqual({ status: 'cancelled' })
    expect(await invoke({ action: 'state' })).toMatchObject({
      status: 'ok',
      document: document(2027),
    })
  })

  it('не открывает диалог для повреждённого документа', async () => {
    expect(await invoke({ action: 'save', document: '{', saveAs: true })).toMatchObject({
      status: 'error',
    })
    expect(dialogs.save).not.toHaveBeenCalled()
  })

  it('не принимает путь от renderer', async () => {
    await expect(listener({}, { action: 'open', path: 'arbitrary' })).rejects.toThrow(
      'неверный запрос',
    )
  })

  it('импортирует выбранный JSON в новый план и сохраняет его отдельным файлом', async () => {
    const sourcePath = join(directory, 'legacy.json')
    const source = JSON.stringify({
      v: 1,
      meta: { year: 2027 },
      catalog: [{ id: 'X', name: 'Тест', group: 'cur', unit: 'км', inTable: true }],
      lines: [{ id: 'L', name: 'Тестовая линия', from: 10, to: 20 }],
      stations: [
        {
          id: 'S',
          name: 'Тестовая станция',
          layout: {
            tracks: [{ id: 't', num: 'I', kind: 'главный', row: 2, x1: 4, x2: 40, full: 900 }],
            objects: [{ id: 'o', type: 'здание', text: 'Тест', x: 20, y: -1, w: 3, h: 1 }],
          },
        },
      ],
      works: [{ id: 'w', kind: 'X', line: 'L', rangesText: '11 км — 12 км', qty: null }],
    })
    await writeFile(sourcePath, source)
    dialogs.openPrototype.mockResolvedValue(sourcePath)
    const imported = await invoke({
      action: 'importPrototype',
      edition: { number: 'test', date: '2026-10-20' },
    })
    expect(imported.status).toBe('ok')
    if (imported.status !== 'ok' || !imported.document) throw new Error('нет плана')
    expect(decodePlan(imported.document)).toMatchObject({
      ok: true,
      value: { works: [{ id: 'w' }] },
    })
    await invoke({ action: 'save', document: imported.document, saveAs: false })
    expect(await readFile(sourcePath, 'utf8')).toBe(source)
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { prototype: { source } },
    })
    const reopened = decodePlan(await readFile(path, 'utf8'))
    if (!reopened.ok) throw new Error('нет повторно открытого плана')
    expect(reopened.value.basis.stations.get('S')?.legacyLayout).toMatchObject({
      tracks: [{ id: 't', number: 'I', row: 2, x1: 4, x2: 40, fullMeters: 900 }],
      objects: [{ id: 'o', type: 'здание', x: 20, y: -1, width: 3, height: 1 }],
    })
  })

  it('ошибка импорта оставляет ранее открытый план', async () => {
    await invoke({ action: 'update', document: document(2026) })
    await writeFile(path, '{')
    expect(
      await invoke({ action: 'importPrototype', edition: { number: 'test', date: '2026-10-20' } }),
    ).toMatchObject({ status: 'error' })
    expect(await invoke({ action: 'state' })).toMatchObject({
      status: 'ok',
      document: document(2026),
    })
  })

  it('отклоняет разросшийся при экранировании снимка импорт, сохраняя текущий план и его файл', async () => {
    const original = document(2026)
    await invoke({ action: 'save', document: original, saveAs: false })
    const sourcePath = join(directory, 'large-legacy.json')
    const source = JSON.stringify({
      v: 1,
      meta: { year: 2027 },
      catalog: [{ id: 'X', name: 'Тест', group: 'cur', unit: 'км', inTable: true }],
      lines: [{ id: 'L', name: 'Тест', from: 10, to: 20 }],
      extra: '"'.repeat(6 * 1024 * 1024),
    })
    expect(source.length).toBeLessThan(20 * 1024 * 1024)
    await writeFile(sourcePath, source)
    dialogs.openPrototype.mockResolvedValue(sourcePath)
    expect(
      await invoke({ action: 'importPrototype', edition: { number: 'test', date: '2026-10-20' } }),
    ).toEqual({
      status: 'error',
      message: 'План превышает допустимый размер. Текущий план не изменён.',
    })
    expect(await invoke({ action: 'state' })).toMatchObject({ status: 'ok', document: original })
    await invoke({ action: 'save', document: original, saveAs: false })
    expect(dialogs.save).toHaveBeenCalledTimes(1)
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await readFile(sourcePath, 'utf8')).toBe(source)
  })

  it('отклоняет слишком большой открываемый план до замены текущего', async () => {
    const original = document(2026)
    await invoke({ action: 'update', document: original })
    const parsed = decodePlan(document(2027))
    if (!parsed.ok) throw new Error('нет плана')
    const encoded = encodePlan(
      {
        ...parsed.value,
        prototype: {
          source: JSON.stringify({ extra: '"'.repeat(6 * 1024 * 1024) }),
          report: [],
        },
      },
      '0.1.0',
    )
    if (!encoded.ok) throw new Error('нет файла')
    await writeFile(path, encoded.value)
    expect(await invoke({ action: 'open' })).toMatchObject({
      status: 'error',
      message: expect.stringContaining('превышает допустимый размер'),
    })
    expect(await invoke({ action: 'state' })).toMatchObject({ status: 'ok', document: original })
  })

  it.each(['oversized', 'corrupt'] as const)(
    'не переключает файл сохранения, если автокопия выбранного плана %s',
    async (problem) => {
      const original = document(2026)
      await invoke({ action: 'save', document: original, saveAs: false })
      const selectedPath = join(directory, 'other.ppr.json')
      const selected = document(2027)
      await writeFile(selectedPath, selected)
      let recovery = '{'
      if (problem === 'oversized') {
        const plan = decodePlan(document(2028))
        if (!plan.ok) throw new Error('нет плана')
        const encoded = encodePlan(
          {
            ...plan.value,
            prototype: {
              source: JSON.stringify({ extra: '"'.repeat(6 * 1024 * 1024) }),
              report: [],
            },
          },
          '0.1.0',
        )
        if (!encoded.ok) throw new Error('нет файла')
        recovery = encoded.value
      }
      await writeFile(`${selectedPath}.autosave`, recovery)
      dialogs.open.mockResolvedValue(selectedPath)
      expect(await invoke({ action: 'open' })).toMatchObject({ status: 'error' })
      expect(await invoke({ action: 'state' })).toMatchObject({
        status: 'ok',
        document: original,
        recovery: null,
      })
      const changed = document(2029)
      expect(await invoke({ action: 'save', document: changed, saveAs: false })).toMatchObject({
        status: 'ok',
      })
      expect(dialogs.save).toHaveBeenCalledTimes(1)
      expect(await readFile(path, 'utf8')).toBe(changed)
      expect(await readFile(selectedPath, 'utf8')).toBe(selected)
      expect(await readFile(`${selectedPath}.autosave`, 'utf8')).toBe(recovery)
    },
  )

  it.each(['kind', 'outside', 'duplicate'] as const)(
    'доменная ошибка %s отклоняет весь импорт без смены текущего плана',
    async (change) => {
      await invoke({ action: 'update', document: document(2026) })
      const project = {
        v: 1,
        meta: { year: 2027 },
        catalog: [{ id: 'X', name: 'Тест', group: 'cur', unit: 'км', inTable: true }],
        lines: [{ id: 'L', name: 'Тест', from: 10, to: 20 }],
        works: [{ id: 'w', kind: 'X', line: 'L', rangesText: '11 км — 12 км', qty: null }],
      }
      switch (change) {
        case 'kind':
          project.works[0]!.kind = 'нет'
          break
        case 'outside':
          project.works[0]!.rangesText = '25 км — 26 км'
          break
        case 'duplicate':
          project.works.push({ ...project.works[0]! })
          break
      }
      await writeFile(path, JSON.stringify(project))
      expect(
        await invoke({
          action: 'importPrototype',
          edition: { number: 'test', date: '2026-10-20' },
        }),
      ).toMatchObject({ status: 'error' })
      expect(await invoke({ action: 'state' })).toMatchObject({
        status: 'ok',
        document: document(2026),
      })
    },
  )

  it('открывает основной документ и восстанавливает автокопию только по выбору', async () => {
    await invoke({ action: 'save', document: document(2026), saveAs: false })
    const store = new FilePlanStore(path, '0.1.0')
    const decoded = decodePlan(document(2027))
    if (!decoded.ok) throw new Error('нет плана')
    await store.autosave(decoded.value)
    expect(await invoke({ action: 'open' })).toMatchObject({
      status: 'ok',
      document: document(2026),
      recovery: document(2027),
    })
    expect(await invoke({ action: 'recover', accept: true })).toMatchObject({
      status: 'ok',
      document: document(2027),
    })
    expect((await editorState()).hasRecovery).toBe(false)
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { year: 2026 },
    })
  })

  it('не стирает предложение восстановления минутным таймером после открытия', async () => {
    await invoke({ action: 'save', document: document(2026), saveAs: false })
    const decoded = decodePlan(document(2027))
    if (!decoded.ok) throw new Error('нет плана')
    await new FilePlanStore(path, '0.1.0').autosave(decoded.value)
    await stop()
    vi.useFakeTimers()
    const ipc: IpcMainLike = {
      handle: (_name, fn) => {
        listener = fn
      },
    }
    stop = registerPlanFileHandlers(ipc, dialogs, '0.1.0')
    await invoke({ action: 'open' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await invoke({ action: 'state' })).toMatchObject({
      status: 'ok',
      recovery: document(2027),
    })
  })

  it('минутный таймер записывает обновлённый документ, сохраняя основной файл', async () => {
    await invoke({ action: 'save', document: document(2026), saveAs: false })
    await stop()
    vi.useFakeTimers()
    const ipc: IpcMainLike = {
      handle: (_name, fn) => {
        listener = fn
      },
    }
    stop = registerPlanFileHandlers(ipc, dialogs, '0.1.0')
    await invoke({ action: 'open' })
    await invoke({ action: 'update', document: document(2027) })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await invoke({ action: 'state' })).toMatchObject({
      status: 'ok',
      recovery: document(2027),
    })
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { year: 2026 },
    })
  })
  const draft: EditorDraft = {
    kind: 'ППР',
    mode: 'line',
    line: 'L1',
    text: '20 км пк 10',
    station: '',
    objectKind: 'none',
    objectNumber: '',
    volume: '',
    note: 'Учебная',
    callout: true,
  }
  const editorState = async () => {
    const response = await invoke({
      action: 'editor',
      command: { kind: 'state' },
      revision: 0,
      area: 'district',
    })
    if (response.status !== 'editor') throw new Error('Нет состояния редактора')
    return response.state
  }
  const edit = async (command: EditorAction, area = 'district') =>
    invoke(
      channels.planFile.request.parse({
        action: 'editor',
        command,
        revision: (await editorState()).revision,
        area,
      }),
    )
  it('применяет состав таблиц одним шагом, сохраняет работы и открывает настройки после записи', async () => {
    await invoke({ action: 'update', document: document(2027) })
    await edit({ kind: 'add', draft }, 'pd:ПД-2')
    const before = await edit({ kind: 'state' }, 'pd:ПД-2')
    expect(await edit({ kind: 'pdTables', hidden: ['works', 'works'] }, 'pd:ПД-2')).toMatchObject({
      status: 'invalid',
    })
    expect(await edit({ kind: 'state' }, 'pd:ПД-2')).toEqual(before)
    const applied = await edit({ kind: 'pdTables', hidden: ['works', 'summary'] }, 'pd:ПД-2')
    expect(applied).toMatchObject({
      status: 'editor',
      state: { dirty: true, view: { works: [{ draft: { note: 'Учебная' } }] } },
    })
    if (applied.status !== 'editor') throw new Error('Нет учебного состояния')
    const source = await invoke({
      action: 'previewEditorSheets',
      revision: applied.state.revision,
      pd: 'ПД-2',
    })
    if (source.status !== 'editorSheets') throw new Error('Нет учебного листа')
    expect(source.source.pds[1]?.tables.some((table) => table.title === 'Ведомость работ ПД')).toBe(
      false,
    )
    expect(source.source.pds[1]?.works).toHaveLength(1)
    expect(await edit({ kind: 'undo' }, 'pd:ПД-2')).toMatchObject({
      state: {
        view: {
          pdTables: expect.arrayContaining([
            { key: 'works', label: 'Ведомость работ ПД', visible: true },
          ]),
        },
      },
    })
    await edit({ kind: 'redo' }, 'pd:ПД-2')
    await edit({ kind: 'save', saveAs: false }, 'pd:ПД-2')
    await edit({ kind: 'open' })
    expect(await edit({ kind: 'state' }, 'pd:ПД-2')).toMatchObject({
      state: {
        dirty: false,
        view: {
          pdTables: expect.arrayContaining([
            { key: 'works', label: 'Ведомость работ ПД', visible: false },
          ]),
          works: [{ draft: { note: 'Учебная' } }],
        },
      },
    })
  })
  it('закрепляет масштаб по ПД, отменяет, сохраняет и открывает; устаревшая команда не меняет настройку', async () => {
    await invoke({ action: 'update', document: document(2027) })
    const before = await editorState()
    expect(await edit({ kind: 'pdScale', scale: 25000 }, 'district')).toMatchObject({
      status: 'invalid',
    })
    expect(await editorState()).toEqual(before)
    expect(await edit({ kind: 'pdScale', scale: 25000 }, 'pd:ПД-2')).toMatchObject({
      status: 'editor',
      state: { dirty: true, view: { pdScale: 25000 } },
    })
    const changed = await editorState()
    expect(
      await invoke({
        action: 'editor',
        command: { kind: 'pdScale', scale: 100000 },
        revision: before.revision,
        area: 'pd:ПД-2',
      }),
    ).toMatchObject({ status: 'error' })
    expect((await editorState()).revision).toBe(changed.revision)
    expect(
      await invoke({ action: 'previewEditorSheets', revision: changed.revision, pd: 'ПД-2' }),
    ).toMatchObject({ source: { pds: [{ scale: 50000 }, { scale: 25000 }] } })
    expect(await edit({ kind: 'undo' }, 'pd:ПД-2')).toMatchObject({
      state: { view: { pdScale: 50000 } },
    })
    expect(await edit({ kind: 'redo' }, 'pd:ПД-2')).toMatchObject({
      state: { view: { pdScale: 25000 } },
    })
    await edit({ kind: 'save', saveAs: false }, 'pd:ПД-2')
    await edit({ kind: 'open' })
    expect(await edit({ kind: 'state' }, 'pd:ПД-2')).toMatchObject({
      state: { dirty: false, view: { pdScale: 25000, canUndo: false } },
    })
    expect(await edit({ kind: 'state' }, 'pd:ПД-1')).toMatchObject({
      state: { view: { pdScale: 50000 } },
    })
  })
  it('применяет показатели ПД одним пакетом, сохраняет v4 и повторно открывает с тем же id', async () => {
    await invoke({ action: 'update', document: document(2027) })
    const rows = [
      { id: null, name: 'Учебный показатель', unit: 'шт.', value: '0', note: 'Учебное примечание' },
    ]
    const before = await editorState()
    expect(
      await edit(
        { kind: 'indicatorRows', rows: [...rows, { ...rows[0]!, value: 'не число' }] },
        'pd:ПД-2',
      ),
    ).toMatchObject({ status: 'invalid' })
    expect(await editorState()).toEqual(before)
    const applied = await edit({ kind: 'indicatorRows', rows }, 'pd:ПД-2')
    expect(applied).toMatchObject({
      status: 'editor',
      state: { dirty: true, view: { indicators: [{ id: expect.any(String), value: 0 }] } },
    })
    if (applied.status !== 'editor') throw new Error('Нет состояния редактора')
    const indicators = applied.state.view!.indicators
    expect(
      await invoke({ action: 'previewEditorSheets', revision: applied.state.revision, pd: 'ПД-2' }),
    ).toMatchObject({
      status: 'editorSheets',
      source: {
        pds: [
          { tables: [] },
          {
            tables: expect.arrayContaining([
              {
                title: 'Ручные показатели ПД',
                columns: expect.any(Array),
                rows: [['Учебный показатель', 'шт.', '0', 'Учебное примечание']],
              },
            ]),
          },
        ],
      },
    })
    expect(await edit({ kind: 'undo' }, 'pd:ПД-2')).toMatchObject({
      state: { view: { indicators: [] } },
    })
    expect(await edit({ kind: 'redo' }, 'pd:ПД-2')).toMatchObject({
      state: { view: { indicators } },
    })
    await edit({ kind: 'save', saveAs: false }, 'pd:ПД-2')
    expect(JSON.parse(await readFile(path, 'utf8')).format.version).toBe(5)
    await edit({ kind: 'open' })
    expect(await edit({ kind: 'state' }, 'pd:ПД-2')).toMatchObject({
      state: { dirty: false, view: { indicators, canUndo: false } },
    })
    expect((await editorState()).view?.indicators).toEqual([])
  })
  it('привязывает лист к ревизии редактора, отражает правки и историю без записи файла', async () => {
    expect(await invoke({ action: 'previewEditorSheets', revision: 0, pd: 'ПД-2' })).toMatchObject({
      status: 'error',
    })
    await writeFile(path, document(2027))
    await invoke({ action: 'open' })
    const original = await readFile(path, 'utf8')
    const before = await editorState()
    const preview = async (revision = before.revision) =>
      invoke({ action: 'previewEditorSheets', revision, pd: 'ПД-2' })
    expect(await preview()).toMatchObject({
      status: 'editorSheets',
      revision: before.revision,
      source: { pds: [{ tables: [] }, { works: [] }] },
    })
    expect(await editorState()).toEqual(before)
    expect(
      await invoke({ action: 'previewEditorSheets', revision: before.revision, pd: 'нет' }),
    ).toMatchObject({ status: 'error' })
    await edit({ kind: 'add', draft })
    expect(await preview()).toMatchObject({
      status: 'error',
      message: expect.stringContaining('План изменился'),
    })
    const added = await editorState()
    const work = added.view!.works[0]!
    expect(await preview(added.revision)).toMatchObject({
      status: 'editorSheets',
      source: { pds: [{ works: [], tables: [] }, { works: [{ id: work.id, volume: 0.064 }] }] },
    })
    const source = await preview(added.revision)
    if (source.status !== 'editorSheets') throw new Error('Нет среза листа')
    expect(source.source.pds[1]?.tables.find((t) => t.workIds)?.workIds).toEqual([work.id])
    await edit({
      kind: 'edit',
      id: work.id,
      draft: { ...draft, note: 'Изменённая учебная', volume: '2' },
    })
    expect(await preview((await editorState()).revision)).toMatchObject({
      source: { pds: [{}, { works: [{ note: 'Изменённая учебная', volume: 2 }] }] },
    })
    await edit({ kind: 'undo' })
    expect(await preview((await editorState()).revision)).toMatchObject({
      source: { pds: [{}, { works: [{ volume: 0.064 }] }] },
    })
    await edit({ kind: 'redo' })
    expect(await preview((await editorState()).revision)).toMatchObject({
      source: { pds: [{}, { works: [{ volume: 2 }] }] },
    })
    await edit({ kind: 'remove', id: work.id })
    expect(await preview((await editorState()).revision)).toMatchObject({
      source: { pds: [{}, { works: [] }] },
    })
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(dialogs.save).not.toHaveBeenCalled()
    expect((await editorState()).view?.canUndo).toBe(true)
  })
  it('редактирует, сохраняет и отменяет; сохранение не сбрасывает историю', async () => {
    await invoke({ action: 'update', document: document(2027) })
    expect(await edit({ kind: 'add', draft })).toMatchObject({
      status: 'editor',
      state: { dirty: true, view: { works: [{ volume: 0.064 }] } },
    })
    expect(await edit({ kind: 'save', saveAs: false })).toMatchObject({
      status: 'editor',
      state: { dirty: false, hasFile: true, view: { canUndo: true } },
    })
    const version = (await editorState()).revision
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { works: [{ note: 'Учебная' }] },
    })
    expect(await edit({ kind: 'undo' })).toMatchObject({
      status: 'editor',
      state: { dirty: true, view: { works: [] } },
    })
    expect(await edit({ kind: 'redo' })).toMatchObject({
      status: 'editor',
      state: { dirty: false, revision: version + 2 },
    })
    expect(dialogs.save).toHaveBeenCalledTimes(1)
  })
  it('ошибка места и устаревшая версия не меняют текущий документ', async () => {
    await invoke({ action: 'update', document: document(2027) })
    const initial = await editorState()
    expect(await edit({ kind: 'add', draft: { ...draft, text: '20 км пк 11' } })).toMatchObject({
      status: 'invalid',
      issues: [{ field: 'place' }],
    })
    expect((await editorState()).revision).toBe(initial.revision)
    const request = {
      action: 'editor' as const,
      command: { kind: 'add' as const, draft },
      revision: initial.revision,
      area: 'district',
    }
    const responses = await Promise.all([invoke(request), invoke(request)])
    expect(responses.map((r) => r.status)).toEqual(['editor', 'error'])
    expect((await editorState()).view?.works).toHaveLength(1)
  })
  it('ошибка «Сохранить как» сохраняет прежний путь и возможность повторной записи', async () => {
    await invoke({ action: 'save', document: document(2027), saveAs: false })
    await edit({ kind: 'add', draft })
    dialogs.save.mockResolvedValueOnce(join(directory, 'нет-папки', 'test.ppr.json'))
    expect(await edit({ kind: 'save', saveAs: true })).toMatchObject({ status: 'error' })
    expect((await editorState()).dirty).toBe(true)
    expect(await edit({ kind: 'save', saveAs: false })).toMatchObject({
      status: 'editor',
      state: { dirty: false },
    })
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { works: [{ note: 'Учебная' }] },
    })
  })
  it('отмена открытия оставляет план и историю; другой файл начинает новую историю', async () => {
    await invoke({ action: 'update', document: document(2027) })
    await edit({ kind: 'add', draft })
    const current = await editorState()
    dialogs.open.mockResolvedValueOnce(undefined)
    expect(await edit({ kind: 'open' })).toEqual({ status: 'cancelled' })
    expect(await editorState()).toEqual(current)
    await writeFile(path, document(2028))
    expect(await edit({ kind: 'open' })).toMatchObject({
      status: 'editor',
      state: { view: { year: 2028, works: [], canUndo: false } },
    })
  })
  it('предлагает автокопию и восстанавливает только по явной команде', async () => {
    await writeFile(path, document(2027))
    const recovered = decodePlan(document(2028))
    if (!recovered.ok) throw new Error('Нет учебного плана')
    await new FilePlanStore(path, '0.1.0').autosave(recovered.value)
    expect(await edit({ kind: 'open' })).toMatchObject({
      status: 'editor',
      state: { hasRecovery: true, view: { year: 2027 } },
    })
    expect(await edit({ kind: 'add', draft })).toMatchObject({ status: 'error' })
    expect(await edit({ kind: 'recover', accept: true })).toMatchObject({
      status: 'editor',
      state: { dirty: true, view: { year: 2028 } },
    })
    expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
      ok: true,
      value: { year: 2027 },
    })
  })

  it('явный отказ от автокопии удаляет только её и разрешает редактирование основного плана', async () => {
    await writeFile(path, document(2027))
    const recovery = decodePlan(document(2028))
    if (!recovery.ok) throw new Error('Нет учебного плана')
    await new FilePlanStore(path, '0.1.0').autosave(recovery.value)
    await edit({ kind: 'open' })
    expect(await edit({ kind: 'recover', accept: false })).toMatchObject({
      status: 'editor',
      state: { hasRecovery: false, view: { year: 2027 } },
    })
    await expect(readFile(`${path}.autosave`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(path, 'utf8')).toBe(document(2027))
    expect(await edit({ kind: 'add', draft })).toMatchObject({ status: 'editor' })
  })
  it.each([1, 2])(
    'открывает и редактирует длинные поля файла v%s без изменения формата',
    async (version) => {
      const longId = 'Учебный-'.repeat(80)
      const longText = 'Вымышленное примечание. '.repeat(500)
      const original = samplePlanBasis()
      const basis = planBasis({
        edition: original.edition,
        lines: [...original.lines.values()],
        stations: [...original.stations.values()].map((s) => ({ ...s, pd: longId })),
        pds: [...original.pds.values()].map((p, i) => ({ ...p, id: i === 1 ? longId : p.id })),
        workKinds: [...original.workKinds.values()],
      })
      if (!basis.ok) throw new Error('Нет среза')
      const plan = createAnnualPlan(2027, basis.value, {
        title: longText,
        name: longText,
        year: 2026,
      })
      if (!plan.ok) throw new Error('Нет плана')
      const work = addWork(plan.value, workId(longId), {
        kind: 'КСП',
        place: { kind: 'station', station: 'S1' },
        volume: 2,
        note: longText,
        callout: false,
      })
      if (!work.ok) throw new Error('Нет работы')
      const encoded = encodePlan(work.value, '0.1.0')
      if (!encoded.ok) throw new Error('Нет файла')
      const file = readPlanFile(encoded.value)
      if (!file.ok) throw new Error('Нет документа')
      const oldPlan = file.value.plan
      const content =
        version === 1
          ? {
              ...file.value,
              format: { ...file.value.format, version },
              plan: {
                year: oldPlan.year,
                approval: oldPlan.approval,
                works: oldPlan.works,
                manual: oldPlan.manual,
              },
            }
          : file.value
      await writeFile(path, JSON.stringify(content))
      expect(await edit({ kind: 'open' })).toMatchObject({ status: 'editor' })
      const state = await editorState()
      expect(state.view?.approval.name).toBe(longText)
      const row = state.view!.works[0]!
      expect(row.id).toBe(longId)
      expect(row.draft.note).toBe(longText)
      expect(
        await edit(
          { kind: 'edit', id: row.id, draft: { ...row.draft, note: longText + 'Правка' } },
          `pd:${longId}`,
        ),
      ).toMatchObject({ status: 'editor' })
      expect(
        await edit({ kind: 'approval', title: longText, name: longText + 'Правка', year: 2026 }),
      ).toMatchObject({ status: 'editor' })
      expect(await edit({ kind: 'save', saveAs: false })).toMatchObject({ status: 'editor' })
      expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
        ok: true,
        value: {
          works: [{ id: longId, note: longText + 'Правка' }],
          approval: { name: longText + 'Правка' },
        },
      })
    },
  )

  async function restartWithTimers(): Promise<void> {
    await stop()
    vi.useFakeTimers()
    stop = registerPlanFileHandlers(
      {
        handle: (_name, fn) => {
          listener = fn
        },
      },
      dialogs,
      '0.1.0',
    )
  }

  it('отказ через прежний IPC снимает блокировку редактора и возобновляет автокопию', async () => {
    await writeFile(path, document(2027))
    await writeFile(`${path}.autosave`, document(2028))
    await restartWithTimers()
    await invoke({ action: 'open' })
    expect((await editorState()).hasRecovery).toBe(true)
    expect(await invoke({ action: 'recover', accept: false })).toMatchObject({
      status: 'ok',
      recovery: null,
    })
    expect((await editorState()).hasRecovery).toBe(false)
    expect(await edit({ kind: 'add', draft })).toMatchObject({ status: 'editor' })
    await vi.advanceTimersByTimeAsync(60_000)
    const state = await invoke({ action: 'state' })
    if (state.status !== 'ok' || !state.recovery) throw new Error('Нет автокопии')
    expect(decodePlan(state.recovery)).toMatchObject({
      ok: true,
      value: { works: [{ note: draft.note }] },
    })
  })

  it.each(['undo', 'redo'] as const)(
    '%s до сохранённого снимка удаляет устаревшую автокопию',
    async (kind) => {
      await writeFile(path, document(2027))
      await restartWithTimers()
      await edit({ kind: 'open' })
      await edit({ kind: 'add', draft })
      if (kind === 'redo') {
        await edit({ kind: 'save', saveAs: false })
        await edit({ kind: 'undo' })
      }
      await vi.advanceTimersByTimeAsync(60_000)
      expect(await invoke({ action: 'state' })).toMatchObject({
        status: 'ok',
        recovery: expect.any(String),
      })
      expect(await edit({ kind })).toMatchObject({ status: 'editor', state: { dirty: false } })
      await expect(readFile(`${path}.autosave`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await vi.advanceTimersByTimeAsync(60_000)
      await edit({ kind: 'open' })
      expect((await editorState()).hasRecovery).toBe(false)
    },
  )

  it('сбой удаления автокопии сохраняет правку и историю до успешного повтора отмены', async () => {
    await writeFile(path, document(2027))
    await restartWithTimers()
    await edit({ kind: 'open' })
    await edit({ kind: 'add', draft })
    await vi.advanceTimersByTimeAsync(60_000)
    const state = await editorState()
    vi.spyOn(FilePlanStore.prototype, 'discardRecovery').mockResolvedValueOnce({
      ok: false,
      error: { kind: 'io', message: 'Учебный сбой удаления' },
    })
    expect(await edit({ kind: 'undo' })).toMatchObject({
      status: 'error',
      message: 'Учебный сбой удаления',
    })
    expect(await editorState()).toEqual(state)
    expect(await readFile(`${path}.autosave`, 'utf8')).toContain(draft.note)
    expect(await edit({ kind: 'undo' })).toMatchObject({
      status: 'editor',
      state: { dirty: false },
    })
    await expect(readFile(`${path}.autosave`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('тик таймера во время отмены не возвращает устаревшую автокопию', async () => {
    await writeFile(path, document(2027))
    await restartWithTimers()
    await edit({ kind: 'open' })
    await edit({ kind: 'add', draft })
    await vi.advanceTimersByTimeAsync(60_000)
    const discard = FilePlanStore.prototype.discardRecovery
    let release!: () => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(FilePlanStore.prototype, 'discardRecovery').mockImplementationOnce(async function (
      this: FilePlanStore,
    ) {
      entered()
      await gate
      return discard.call(this)
    })
    const undo = edit({ kind: 'undo' })
    await started
    await vi.advanceTimersByTimeAsync(60_000)
    release()
    expect(await undo).toMatchObject({ status: 'editor', state: { dirty: false } })
    expect(await invoke({ action: 'state' })).toMatchObject({ status: 'ok', recovery: null })
  })
  it('создаёт план без пути и старой истории; первое сохранение выбирает новый файл', async () => {
    await invoke({ action: 'save', document: document(2027), saveAs: false })
    await edit({ kind: 'add', draft })
    const old = await editorState()
    expect(await edit({ kind: 'editions' })).toMatchObject({
      status: 'editions',
      editions: [{ id: 7 }],
    })
    expect(await editorState()).toEqual(old)
    expect(await edit({ kind: 'create', editionId: 7, year: 2028 })).toMatchObject({
      status: 'editor',
      state: {
        dirty: true,
        hasFile: false,
        hasRecovery: false,
        revision: old.revision + 1,
        view: { year: 2028, works: [], canUndo: false, canRedo: false },
      },
    })
    expect(await readFile(path, 'utf8')).toBe(document(2027))
    const newPath = join(directory, 'new.ppr.json')
    dialogs.save.mockResolvedValueOnce(newPath)
    expect(await edit({ kind: 'save', saveAs: false })).toMatchObject({
      status: 'editor',
      state: { dirty: false, hasFile: true },
    })
    expect(dialogs.save).toHaveBeenCalledTimes(2)
    expect(decodePlan(await readFile(newPath, 'utf8'))).toMatchObject({
      ok: true,
      value: { year: 2028, works: [], manual: new Map() },
    })
    expect(await readFile(path, 'utf8')).toBe(document(2027))
    expect(await invoke({ action: 'previewSheets', open: false })).toMatchObject({
      status: 'sheets',
      source: { year: 2028, pds: expect.any(Array) },
    })
  })
  it.each(['read', 'size'] as const)(
    'сбой создания (%s) сохраняет прежние файл, историю и ввод',
    async (problem) => {
      await invoke({ action: 'save', document: document(2027), saveAs: false })
      await edit({ kind: 'add', draft })
      const old = await editorState()
      if (problem === 'read')
        vi.mocked(passport.basis).mockResolvedValueOnce({
          ok: false,
          error: { message: 'Учебный сбой чтения' },
        })
      else
        vi.mocked(passport.basis).mockResolvedValueOnce({
          ok: true,
          value: {
            ...passportInput(),
            edition: { number: 'X'.repeat(21 * 1024 * 1024), date: '2027-01-01' },
          },
        })
      expect(await edit({ kind: 'create', editionId: 7, year: 2028 })).toMatchObject({
        status: 'error',
      })
      expect(await editorState()).toEqual(old)
      expect(await edit({ kind: 'save', saveAs: false })).toMatchObject({ status: 'editor' })
      expect(dialogs.save).toHaveBeenCalledTimes(1)
      expect(decodePlan(await readFile(path, 'utf8'))).toMatchObject({
        ok: true,
        value: { works: [{ note: draft.note }] },
      })
    },
  )
  it('не создаёт новый план по устаревшей ревизии', async () => {
    await invoke({ action: 'update', document: document(2027) })
    expect(
      await invoke({
        action: 'editor',
        command: { kind: 'create', editionId: 7, year: 2028 },
        revision: 0,
        area: 'district',
      }),
    ).toMatchObject({ status: 'error' })
    expect(passport.basis).not.toHaveBeenCalled()
    expect((await editorState()).view?.year).toBe(2027)
  })
})
