import { execFileSync } from 'node:child_process'
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { channels } from '@eow/ipc/contracts'
import { ORG_FORMS, SEGMENT_FORMS } from '@eow/passport/import-api'
import { PassportExportSource, importOrgExports } from '@eow/import/infrastructure'
import { openPassportDatabase, type PassportDatabase } from '@eow/passport/infrastructure'
import { passportPlanView } from '@eow/planning/infrastructure'
import type { ExportGroup } from '@eow/import/application'
import type { Result } from '@eow/shared/kernel'
import { registerExportWizardHandlers, type ExportWizardDialogs } from './export-wizard'

const workspace = resolve(import.meta.dirname, '../../../../..')
const selected = ['ПЧУ-1', 'ПЧУ-2', 'ПД-1', 'ПД-2', 'ПД-3', 'ПД-4']
const value = <T>(r: Result<T, unknown>): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error))
  return r.value
}

describe('Мастер выгрузок: файлы → предпросмотр → SQLite', () => {
  let fixtures: string
  const groups: Record<ExportGroup, string[]> = { org: [], segments: [], stations: [] }
  let root: string, store: PassportDatabase, id: number, clock: Date
  let dialogs: ExportWizardDialogs
  let handler: (event: unknown, ...args: unknown[]) => unknown
  beforeAll(async () => {
    fixtures = await mkdtemp(join(tmpdir(), 'eow-export-fixtures-'))
    // Тот же публичный CLI генератора вымышленных форм, что и npm run fixtures.
    execFileSync(process.execPath, [join(workspace, 'scripts/fixtures.mjs'), fixtures], {
      cwd: workspace,
      stdio: 'pipe',
    })
    const source = new PassportExportSource()
    for (const name of await readdir(fixtures)) {
      if (!/\.xlsx?$/iu.test(name)) continue
      const path = join(fixtures, name)
      const tables = value(await source.read({ name, bytes: await readFile(path) }))
      const form = tables[0]!.form
      const group = ORG_FORMS.some((f) => f === form)
        ? 'org'
        : SEGMENT_FORMS.some((f) => f === form)
          ? 'segments'
          : 'stations'
      groups[group].push(path)
    }
  })
  afterAll(async () => {
    await rm(fixtures, { recursive: true, force: true })
  })
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'eow-export-wizard-'))
    store = await openPassportDatabase(
      join(root, 'passport.sqlite'),
      join(workspace, 'libs/passport/infrastructure/migrations'),
    )
    id = value(await store.createDraft({ date: '2026-10-22', label: 'Учебный паспорт' })).id
    clock = new Date('2026-10-22T00:00:00Z')
    dialogs = { open: vi.fn<ExportWizardDialogs['open']>(async (group) => groups[group]) }
    registerExportWizardHandlers(
      {
        handle: (_channel, listener) => {
          handler = listener
        },
      },
      store,
      dialogs,
      () => clock,
    )
  })
  afterEach(async () => {
    await store?.close()
    if (root) await rm(root, { recursive: true, force: true })
  })
  const invoke = async (request: unknown) =>
    channels.exportWizard.response.parse(await handler(undefined, request))
  async function prepare(group: ExportGroup) {
    const chosen = await invoke({ action: 'choose', editionId: id, group })
    const result =
      chosen.status === 'choices'
        ? await invoke({ action: 'review', editionId: id, token: chosen.token, selected })
        : chosen
    if (result.status !== 'preview') throw new Error(JSON.stringify(result))
    return result.review
  }
  async function apply(group: ExportGroup) {
    const review = await prepare(group)
    expect(await invoke({ action: 'apply', editionId: id, token: review.token })).toEqual({
      status: 'applied',
    })
    return review
  }
  async function changeManualData() {
    const basis = value(await store.manualBasis(id))
    value(
      await store.applyManualData(id, {
        date: basis.date,
        basisToken: basis.token,
        data: {
          ...basis.data,
          tolerances: [
            {
              id: 't',
              code: 'УЧ',
              name: 'Вымышленная справка',
              value: 2,
              unit: 'мм',
              conditions: null,
              validFrom: null,
              validTo: null,
            },
          ],
        },
        file: {
          id: 'manual',
          form: 'manual-data',
          name: 'Учебная.xlsx',
          importedAt: clock.toISOString(),
          sha256: 'a'.repeat(64),
          rowCount: 1,
          warnings: [],
        },
      }),
    )
  }
  it('принимает все 17 форм по трём шагам, показывает замечания и сохраняет отчёт без ФИО корректировщика', async () => {
    expect(Object.values(groups).map((g) => g.length)).toEqual([4, 6, 7])
    const choices = await invoke({ action: 'choose', editionId: id, group: 'org' })
    expect(choices.status).toBe('choices')
    if (choices.status !== 'choices') throw new Error('Нет выбора')
    expect(choices.choices.some((c) => c.overlapsWith.length)).toBe(true)
    expect(value(await store.orgImportReport(id))).toEqual([])
    const org = await apply('org')
    expect(org.files).toHaveLength(4)
    const before = value(await store.editionData(id))
    // Протяжение — объединение границ отмеченных ПД; ЗП-1 разрыв 25–30 км не закрывает.
    expect(before.lines.map((l) => [l.name, l.extents])).toEqual([
      [
        'Главный путь Восточная-Западная, 1',
        [{ from: { km: 100, m: 200 }, to: { km: 131, m: 700 } }],
      ],
      [
        'Главный путь Северная-Южная, 1',
        [
          { from: { km: 10, m: 0 }, to: { km: 25, m: 0 } },
          { from: { km: 30, m: 0 }, to: { km: 60, m: 500 } },
        ],
      ],
    ])
    const segments = await prepare('segments')
    expect(segments.files).toHaveLength(6)
    expect(segments.remarks.length).toBeGreaterThan(0)
    expect(value(await store.editionData(id))).toEqual(before)
    expect(await invoke({ action: 'apply', editionId: id, token: segments.token })).toEqual({
      status: 'applied',
    })
    const stations = await apply('stations')
    expect(stations.files).toHaveLength(7)
    expect(stations.exclusionCandidates.length).toBeGreaterThan(0)
    expect(value(await store.orgImportReport(id))).toHaveLength(4)
    expect(value(await store.segmentImportReport(id))).toHaveLength(6)
    expect(value(await store.stationImportReport(id))).toHaveLength(7)
    expect(JSON.stringify(value(await store.editionData(id)))).not.toMatch(
      /Скорректировал|Иванов Иван Иванович|Петрова Анна Сергеевна/u,
    )
    const repeated = await prepare('segments')
    expect(repeated.previousRows).toBe(repeated.incomingRows)
    expect(await invoke({ action: 'discard', editionId: id, token: repeated.token })).toEqual({
      status: 'discarded',
    })
    // Импортированная редакция годится основой годового плана: ПД лежат на протяжении.
    value(await store.activate(id))
    const basis = value(await passportPlanView(store).basis(id))
    expect(basis.pds.map((pd) => pd.name)).toEqual(['ПД-1', 'ПД-2', 'ПД-3', 'ПД-4'])
  })
  it.each(['org', 'segments', 'stations'] as const)(
    'изменение паспорта после предпросмотра %s блокирует запись в транзакции',
    async (group) => {
      if (group !== 'org') await apply('org')
      const review = await prepare(group)
      await changeManualData()
      const before = value(await store.editionData(id))
      expect(await invoke({ action: 'apply', editionId: id, token: review.token })).toMatchObject({
        status: 'error',
        message: expect.stringContaining('изменился'),
      })
      expect(value(await store.editionData(id))).toEqual(before)
      expect(await invoke({ action: 'apply', editionId: id, token: review.token })).toMatchObject({
        status: 'error',
      })
    },
  )
  it('выбор файлов и отмена предпросмотра ничего не записывают; истёкший токен и токен другой редакции отклоняются', async () => {
    vi.mocked(dialogs.open).mockResolvedValueOnce(undefined)
    expect(await invoke({ action: 'choose', editionId: id, group: 'org' })).toEqual({
      status: 'cancelled',
    })
    const review = await prepare('org')
    expect(await invoke({ action: 'apply', editionId: id + 1, token: review.token })).toMatchObject(
      { status: 'error' },
    )
    expect(await invoke({ action: 'discard', editionId: id, token: review.token })).toEqual({
      status: 'discarded',
    })
    expect(await invoke({ action: 'apply', editionId: id, token: review.token })).toMatchObject({
      status: 'error',
    })
    const next = await prepare('org')
    clock = new Date(clock.getTime() + 600000)
    expect(await invoke({ action: 'apply', editionId: id, token: next.token })).toMatchObject({
      status: 'error',
      message: expect.stringContaining('истекло'),
    })
    expect(value(await store.orgImportReport(id))).toEqual([])
  })
  it('ошибка подразделений позволяет исправить выбор без записи и повторного чтения файлов', async () => {
    const chosen = await invoke({ action: 'choose', editionId: id, group: 'org' })
    if (chosen.status !== 'choices') throw new Error('Нет выбора')
    expect(
      await invoke({
        action: 'review',
        editionId: id,
        token: chosen.token,
        selected: ['НЕСУЩЕСТВУЮЩЕЕ'],
      }),
    ).toMatchObject({ status: 'error' })
    expect(await invoke({ action: 'apply', editionId: id, token: chosen.token })).toMatchObject({
      status: 'error',
    })
    expect(
      await invoke({ action: 'review', editionId: id, token: chosen.token, selected }),
    ).toMatchObject({ status: 'preview' })
    expect(dialogs.open).toHaveBeenCalledTimes(1)
  })
  it('неполный пакет и повторные имена файлов отклоняются без записи', async () => {
    vi.mocked(dialogs.open).mockResolvedValueOnce(groups.org.slice(1))
    expect(await invoke({ action: 'choose', editionId: id, group: 'org' })).toMatchObject({
      status: 'error',
    })
    vi.mocked(dialogs.open).mockResolvedValueOnce([...groups.org, groups.org[0]!])
    expect(await invoke({ action: 'choose', editionId: id, group: 'org' })).toMatchObject({
      status: 'error',
    })
    expect(value(await store.orgImportReport(id))).toEqual([])
  })
  it('обрезанная форма не превращается в частичный импорт', async () => {
    const path = join(root, 'Обрезанная.xls')
    await writeFile(path, (await readFile(groups.org[0]!, 'utf8')).slice(0, -100))
    vi.mocked(dialogs.open).mockResolvedValueOnce([path, ...groups.org.slice(1)])
    expect(await invoke({ action: 'choose', editionId: id, group: 'org' })).toMatchObject({
      status: 'error',
      message: expect.stringContaining('обрезан'),
    })
    expect(value(await store.orgImportReport(id))).toEqual([])
  })
  it('изменение файла на диске после предпросмотра не меняет подтверждаемую команду', async () => {
    const copy = join(root, basename(groups.org[0]!))
    await writeFile(copy, await readFile(groups.org[0]!))
    vi.mocked(dialogs.open).mockResolvedValueOnce([copy, ...groups.org.slice(1)])
    const review = await prepare('org')
    await writeFile(copy, 'повреждено после проверки')
    expect(await invoke({ action: 'apply', editionId: id, token: review.token })).toEqual({
      status: 'applied',
    })
  })
  it('активация после предпросмотра запрещает запись; путь и команда из renderer не принимаются', async () => {
    const review = await prepare('org')
    value(await store.activate(id))
    expect(await invoke({ action: 'apply', editionId: id, token: review.token })).toMatchObject({
      status: 'error',
    })
    await expect(
      invoke({ action: 'choose', editionId: id, group: 'org', path: 'arbitrary.xls' }),
    ).rejects.toThrow('неверный запрос')
    vi.mocked(dialogs.open).mockClear()
    expect(await invoke({ action: 'choose', editionId: id, group: 'org' })).toMatchObject({
      status: 'error',
    })
    expect(dialogs.open).not.toHaveBeenCalled()
  })
  it('пакет сверх 128 МиБ отклоняется до разбора, хотя каждый файл укладывается в 64 МиБ', async () => {
    const paths: string[] = []
    for (const [i, size] of [64 * 1024 * 1024, 64 * 1024 * 1024, 1].entries()) {
      const path = join(root, `part-${i}.xls`)
      const file = await open(path, 'w')
      try {
        await file.truncate(size)
      } finally {
        await file.close()
      }
      paths.push(path)
    }
    vi.mocked(dialogs.open).mockResolvedValueOnce(paths)
    expect(await invoke({ action: 'choose', editionId: id, group: 'org' })).toMatchObject({
      status: 'error',
      message: expect.stringContaining('128 МиБ'),
    })
    expect(value(await store.orgImportReport(id))).toEqual([])
    expect((await prepare('org')).files).toHaveLength(4)
  })

  it('ошибка лимита возвращается через IPC без записи, повторная подготовка возможна', async () => {
    const path = join(root, 'large.xls')
    const file = await open(path, 'w')
    try {
      await file.truncate(64 * 1024 * 1024 + 1)
    } finally {
      await file.close()
    }
    vi.mocked(dialogs.open).mockResolvedValueOnce([path])
    expect(await invoke({ action: 'choose', editionId: id, group: 'org' })).toMatchObject({
      status: 'error',
      message: expect.stringContaining('64 МиБ'),
    })
    expect(value(await store.orgImportReport(id))).toEqual([])
    expect((await prepare('org')).files).toHaveLength(4)
  })

  it('программный API импорта без токена остаётся совместимым', async () => {
    const files = await Promise.all(
      groups.org.map(async (path) => ({ name: basename(path), bytes: await readFile(path) })),
    )
    expect(
      await importOrgExports(
        store,
        files,
        '2026-10-22',
        new Set(selected),
        clock.toISOString(),
        id,
      ),
    ).toMatchObject({ ok: true })
  })
})
