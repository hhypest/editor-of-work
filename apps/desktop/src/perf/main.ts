// Замер подготовки листов на вымышленных планах (ADR-0045): `npm run test:perf`.
// Запросы идут через настоящий обработчик plan:file main с проверками zod, ответ
// копируется так же, как при передаче по IPC, раскладка листа — тем же кодом, что в
// renderer. Не входит в поставку: собирается scripts/perf-sheets.mjs во временный файл.
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { arch, cpus, platform, tmpdir, totalmem } from 'node:os'
import { join } from 'node:path'
import { channels, type RequestOf, type ResponseOf } from '@eow/ipc/contracts'
import { buildPdSheets } from '@eow/documents/application'
import { tableMeasurer } from '@eow/documents/application/testing'
import type { EditorState } from '@eow/planning/application'
import { encodePlan } from '@eow/planning/infrastructure'
import { registerPlanFileHandlers } from '../main/ipc/plan-files'
import type { IpcMainLike } from '../main/ipc/register'
import { fictionalPlan, PLAN_PROFILES, type PlanProfile } from './fictional-plans'
import { goals, limitFailures, summarize, type ProfileTimings } from './stats'

type Request = RequestOf<typeof channels.planFile>
type Response = ResponseOf<typeof channels.planFile>
const VERSION = process.env['EOW_PERF_VERSION'] ?? '0.0.0'
/** Правок на профиль; у каждой — подготовка листа ПД, в котором правка. */
const EDITS = Number(process.env['EOW_PERF_EDITS'] ?? 20)
const REPEATS = 3

const elapsed = (started: number) => performance.now() - started

async function measureProfile(profile: PlanProfile, directory: string): Promise<ProfileTimings> {
  const plan = fictionalPlan(profile)
  const encoded = encodePlan(plan, VERSION)
  if (!encoded.ok) throw new Error(`${profile.title}: ${encoded.error.message}`)
  const path = join(directory, `${profile.id}.ppr.json`)
  await writeFile(path, encoded.value)
  let listener: ((event: unknown, request: unknown) => unknown) | undefined
  const ipc: IpcMainLike = {
    handle: (name, fn) => {
      if (name === channels.planFile.name) listener = fn
    },
  }
  const dialogs = {
    openPrototype: async () => undefined,
    open: async () => path,
    save: async () => join(directory, `${profile.id}-saved.ppr.json`),
  }
  const stop = registerPlanFileHandlers(ipc, dialogs, VERSION)
  /** Запрос и копия ответа, как при передаче между процессами Electron. */
  const invoke = async (request: Request): Promise<Response> => {
    if (!listener) throw new Error('Обработчик plan:file не зарегистрирован')
    return structuredClone((await listener({}, request)) as Response)
  }
  let revision = 0
  const editor = async (
    command: Extract<Request, { action: 'editor' }>['command'],
    area: string,
  ) => {
    const response = await invoke({ action: 'editor', command, revision, area })
    if (response.status !== 'editor')
      throw new Error(`${profile.title}: команда ${command.kind} — ${JSON.stringify(response)}`)
    revision = response.state.revision
    return response.state
  }
  /** «Подготовка листа»: срез main, передача и раскладка листов ПД. */
  const prepare = async (pd: string): Promise<{ ms: number; pages: number }> => {
    const started = performance.now()
    const response = await invoke({ action: 'previewEditorSheets', revision, pd })
    if (response.status !== 'editorSheets')
      throw new Error(`${profile.title}: лист ${pd} — ${JSON.stringify(response)}`)
    const scale = response.source.pds.find((p) => p.id === pd)?.scale ?? 50000
    const built = buildPdSheets(response.source, pd, scale, tableMeasurer)
    if (!built.ok) throw new Error(`${profile.title}: раскладка ${pd} — ${built.error.message}`)
    return { ms: elapsed(started), pages: built.value.pages.length }
  }
  try {
    const opens: number[] = []
    for (let i = 0; i < REPEATS; i++) {
      const started = performance.now()
      await editor({ kind: 'open' }, 'district')
      opens.push(elapsed(started))
    }
    const pds = [...plan.basis.pds.keys()]
    // Прогрев: первый вызов компилирует код раскладки, в программе это делает первый лист.
    await prepare(pds[0] ?? '')
    const sheets: number[] = []
    for (const pd of pds) sheets.push((await prepare(pd)).ms)
    const batches: number[] = []
    let pages = 0
    for (let i = 0; i < REPEATS; i++) {
      const started = performance.now()
      pages = 0
      for (const pd of pds) pages += (await prepare(pd)).pages
      batches.push(elapsed(started))
    }
    const edits: number[] = []
    const afterEdits: number[] = []
    for (let i = 0; i < EDITS; i++) {
      const pd = pds[i % pds.length] ?? ''
      const area = `pd:${pd}`
      const state: EditorState = await editor({ kind: 'state' }, area)
      const works = state.view?.works ?? []
      const work = works[Math.floor(i / pds.length) % Math.max(1, works.length)]
      if (!work) throw new Error(`${profile.title}: в ${pd} нет работ`)
      const started = performance.now()
      await editor(
        { kind: 'edit', id: work.id, draft: { ...work.draft, note: `правка ${i}` } },
        area,
      )
      edits.push(elapsed(started))
      afterEdits.push((await prepare(pd)).ms)
    }
    const saves: number[] = []
    for (let i = 0; i < REPEATS; i++) {
      const started = performance.now()
      await editor({ kind: 'save', saveAs: i === 0 }, 'district')
      saves.push(elapsed(started))
    }
    return {
      id: profile.id,
      title: profile.title,
      size: {
        pds: pds.length,
        works: plan.works.length,
        stations: plan.basis.stations.size,
        fileBytes: (await stat(path)).size,
        pages,
      },
      openMs: summarize(opens),
      sheetMs: summarize(sheets),
      editMs: summarize(edits),
      afterEditMs: summarize(afterEdits),
      batchMs: summarize(batches),
      saveMs: summarize(saves),
    }
  } finally {
    await stop()
  }
}

async function main(): Promise<void> {
  const reportPath = process.argv[2]
  if (!reportPath) throw new Error('Укажите путь отчёта')
  const only = process.env['EOW_PERF_PROFILES']?.split(',').filter(Boolean)
  const directory = await mkdtemp(join(tmpdir(), 'eow-perf-'))
  try {
    const profiles: (ProfileTimings & { goals: ReturnType<typeof goals> })[] = []
    for (const profile of PLAN_PROFILES.filter((p) => !only || only.includes(p.id))) {
      const timings = await measureProfile(profile, directory)
      profiles.push({ ...timings, goals: goals(timings) })
      console.log(
        `${profile.title}: лист после правки p95 ${timings.afterEditMs.p95} мс, ` +
          `все ПД ${Math.round(timings.batchMs.median)} мс на ${timings.size.pages} листов`,
      )
    }
    const failures = profiles.flatMap(limitFailures)
    const report = {
      status: failures.length ? 'failed' : 'passed',
      version: VERSION,
      engine: {
        node: process.versions.node,
        v8: process.versions.v8,
        electron: process.versions['electron'] ?? null,
      },
      machine: {
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model.trim() ?? '',
        cores: cpus().length,
        memoryGb: Math.round(totalmem() / 2 ** 30),
      },
      edits: EDITS,
      profiles,
      failures,
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    if (failures.length) {
      console.error(`Крупная регрессия:\n${failures.join('\n')}`)
      process.exitCode = 1
    }
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
