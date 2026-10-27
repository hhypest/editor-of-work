import { channels, planDocumentSchema, type RequestOf, type ResponseOf } from '@eow/ipc/contracts'
import {
  readPlanText,
  PlanTextReadError,
  encodePlan,
  FilePlanStore,
  startPlanAutosave,
} from '@eow/planning/infrastructure'
import type { PdfBatchWriter, PdfExporter } from '@eow/documents/application'
import { pdfBatchJobs } from './pdf-batch-job'
import type { AnnualPlan } from '@eow/planning/domain'
import { importPrototype } from '@eow/import/infrastructure'
import { planSheetData, buildImportedPlan } from '@eow/planning/application'
import { randomUUID } from 'node:crypto'
import { registerHandler, type IpcMainLike } from './register'
import {
  changeEditor,
  editorView,
  inspectEditorPlace,
  openPlanSession,
  type PlanSession,
  createPlanFromPassport,
  type PassportView,
} from '@eow/planning/application'

/** Диалоги main. Через IPC путь не принимается и не возвращается. */
export interface PlanFileDialogs {
  openPrototype(): Promise<string | undefined>
  open(): Promise<string | undefined>
  save(): Promise<string | undefined>
}

type Request = RequestOf<typeof channels.planFile>
type Response = ResponseOf<typeof channels.planFile>
const failure = (message: string): Response => ({ status: 'error', message })

function sheetResponse(plan: AnnualPlan | undefined): Response {
  if (!plan) return { status: 'sheets', source: null }
  const source = planSheetData(plan)
  if (!source.ok) return failure(source.error.message)
  if (JSON.stringify(source.value).length > 20 * 1024 * 1024)
    return failure(
      'Срез листов ПД превышает 20 МиБ. Уменьшите число объектов или длину примечаний.',
    )
  return channels.planFile.response.parse({ status: 'sheets', source: source.value })
}

export function registerPlanFileHandlers(
  ipc: IpcMainLike,
  dialogs: PlanFileDialogs,
  appVersion: string,
  passport?: PassportView,
  pdf?: PdfExporter,
  batchWriter?: PdfBatchWriter,
): () => Promise<void> {
  const batch = batchWriter ? pdfBatchJobs(batchWriter) : undefined
  let store: FilePlanStore | undefined
  let current: AnnualPlan | undefined
  let history: PlanSession | undefined
  let revision = 0
  let savedPlan: AnnualPlan | undefined
  let hasRecovery = false
  let dirty = false
  let autosaveError: string | null = null
  let pending: Promise<unknown> = Promise.resolve()
  const stop = startPlanAutosave(
    {
      autosave: () =>
        enqueue(async () => {
          // После ожидания очереди снимок мог измениться или стать сохранённым.
          if (hasRecovery || !dirty || !current) return { ok: true, value: undefined } as const
          const result = store
            ? await store.autosave(current)
            : ({ ok: true, value: undefined } as const)
          if (result.ok) autosaveError = null
          return result
        }),
    },
    () => (dirty ? current : undefined),
    (error) => {
      autosaveError = error.message
    },
  )

  /** Таймер и команды разделяют очередь: старая автозапись не обгонит отмену. */
  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = pending.then(action)
    pending = next.catch(() => undefined)
    return next
  }

  function encodeDocument(plan: AnnualPlan): ReturnType<typeof encodePlan> {
    const encoded = encodePlan(plan, appVersion)
    if (encoded.ok && !planDocumentSchema.safeParse(encoded.value).success)
      return {
        ok: false,
        error: {
          kind: 'invalid-file',
          message: 'План превышает допустимый размер. Текущий план не изменён.',
        },
      }
    return encoded
  }

  /**
   * Проверяет документ и автокопию до смены текущего плана.
   * Возвращает наличие автокопии или ответ с ошибкой.
   */
  async function prepare(
    plan: AnnualPlan,
    selected: FilePlanStore | undefined,
  ): Promise<{ readonly recovery: boolean } | Response> {
    const encoded = encodeDocument(plan)
    if (!encoded.ok) return failure(encoded.error.message)
    const recovery = selected ? await selected.recovery() : undefined
    if (recovery && !recovery.ok) return failure(recovery.error.message)
    if (recovery?.ok && recovery.value) {
      const recovered = encodeDocument(recovery.value)
      if (!recovered.ok) return failure(recovered.error.message)
      return { recovery: true }
    }
    return { recovery: false }
  }

  /**
   * Заменяет открытый план новой историей. Ошибка подготовки оставляет прежние
   * документ, путь и признак правок; undefined означает успешную замену.
   */
  async function replaceCurrent(
    plan: AnnualPlan,
    selected: FilePlanStore | undefined,
    changed: boolean,
    error: string | null,
  ): Promise<Response | undefined> {
    const candidate = openPlanSession(plan)
    const prepared = editorResponse(candidate, 'district', revision + 1, changed)
    if (prepared.status !== 'editor') return prepared
    const checked = await prepare(plan, selected)
    if ('status' in checked) return checked
    current = plan
    history = candidate
    revision++
    batch?.reset()
    if (!changed) savedPlan = plan
    else if (selected !== store) savedPlan = undefined
    hasRecovery = checked.recovery
    store = selected
    dirty = changed
    autosaveError = error
    return undefined
  }

  function editorResponse(
    session: PlanSession | undefined,
    area: string,
    version = revision,
    changed = dirty,
  ): Response {
    const view = session ? editorView(session, area) : undefined
    if (view && !view.ok) return { status: 'invalid', issues: [...view.error] }
    const response = {
      status: 'editor',
      state: {
        revision: version,
        dirty: changed,
        hasFile: store !== undefined,
        hasRecovery,
        autosaveError,
        view: view?.ok ? view.value : null,
      },
    }
    if (JSON.stringify(response).length > 20 * 1024 * 1024)
      return failure('Представление редактора превышает 20 МиБ. Текущий план не изменён.')
    return channels.planFile.response.parse(response)
  }

  async function handleEditor(request: Extract<Request, { action: 'editor' }>): Promise<Response> {
    const command = request.command
    if (command.kind === 'editions') {
      if (!passport) return failure('Паспорт недоступен для создания плана.')
      const result = await passport.editions()
      return result.ok
        ? channels.planFile.response.parse({ status: 'editions', editions: result.value })
        : failure(result.error.message)
    }
    if (command.kind === 'state') return editorResponse(history, request.area)
    if (request.revision !== revision)
      return failure(
        'План изменился в другом действии. Обновите редактор; введённая форма сохранена на экране.',
      )
    if (command.kind === 'create') {
      if (!passport) return failure('Паспорт недоступен для создания плана.')
      const plan = await createPlanFromPassport(passport, command.editionId, command.year)
      if (!plan.ok) return failure(plan.error.message)
      return (
        (await replaceCurrent(plan.value, undefined, true, null)) ??
        editorResponse(history, 'district')
      )
    }
    if (command.kind === 'open' || command.kind === 'import' || command.kind === 'recover') {
      const problem =
        command.kind === 'open'
          ? await openFile()
          : command.kind === 'import'
            ? await importFile(command.edition)
            : await recover(command.accept)
      return problem ?? editorResponse(history, 'district')
    }
    if (!history || !current)
      return failure('Сначала откройте план или импортируйте проект прототипа.')
    if (command.kind === 'checkPlace')
      return channels.planFile.response.parse({
        status: 'place',
        revision,
        hint: inspectEditorPlace(history, command.line, command.text),
      })
    if (hasRecovery)
      return failure(
        'Сначала восстановите автокопию или явно откажитесь от неё. Основной план не изменён.',
      )
    if (command.kind === 'save') {
      const prepared = editorResponse(history, request.area)
      if (prepared.status !== 'editor') return prepared
      const encoded = encodeDocument(current)
      if (!encoded.ok) return failure(encoded.error.message)
      let selected = store
      if (!selected || command.saveAs) {
        const path = await dialogs.save()
        if (!path) return { status: 'cancelled' }
        selected = new FilePlanStore(path, appVersion)
      }
      const saved = await selected.save(current)
      if (!saved.ok) return failure(saved.error.message)
      store = selected
      savedPlan = current
      dirty = false
      autosaveError = null
      hasRecovery = false
      return editorResponse(history, request.area)
    }
    const changed = changeEditor(history, command, request.area, { next: randomUUID })
    if (!changed.ok) return { status: 'invalid', issues: [...changed.error] }
    const nextRevision = changed.value.present === current ? revision : revision + 1
    const nextDirty = changed.value.present !== savedPlan
    const prepared = editorResponse(changed.value, request.area, nextRevision, nextDirty)
    if (prepared.status !== 'editor') return prepared
    const encoded = encodeDocument(changed.value.present)
    if (!encoded.ok) return failure(encoded.error.message)
    if (dirty && !nextDirty && store) {
      // Сначала удаляем автокопию: при сбое отмена остаётся доступной для повтора.
      const discarded = await store.discardRecovery()
      if (!discarded.ok) return failure(discarded.error.message)
    }
    history = changed.value
    current = changed.value.present
    revision = nextRevision
    dirty = nextDirty
    return prepared
  }

  async function openFile(): Promise<Response | undefined> {
    const path = await dialogs.open()
    if (!path) return { status: 'cancelled' }
    const selected = new FilePlanStore(path, appVersion)
    const loaded = await selected.load()
    if (!loaded.ok) return failure(loaded.error.message)
    return replaceCurrent(loaded.value, selected, false, null)
  }

  async function importFile(edition: {
    readonly number: string
    readonly date: string
  }): Promise<Response | undefined> {
    const path = await dialogs.openPrototype()
    if (!path) return { status: 'cancelled' }
    const source = await readPlanText(path)
    if (source === undefined) return failure('Файл проекта прототипа не найден.')
    const parsed = importPrototype(source, { edition, ids: { next: randomUUID } })
    if (!parsed.ok) return failure(parsed.error.map((e) => `${e.path}: ${e.message}`).join('; '))
    const imported = buildImportedPlan(parsed.value)
    if (!imported.ok)
      return failure(imported.error.map((e) => `${e.path}: ${e.message}`).join('; '))
    return replaceCurrent(imported.value, undefined, true, null)
  }

  /** Восстановление или отказ; автокопия остаётся до явного сохранения восстановленного плана. */
  async function recover(accept: boolean): Promise<Response | undefined> {
    if (!store) return failure('Сначала откройте файл плана.')
    if (accept) {
      const recovery = await store.recovery()
      if (!recovery.ok) return failure(recovery.error.message)
      if (recovery.value) {
        const problem = await replaceCurrent(recovery.value, store, true, autosaveError)
        if (problem) return problem
      }
    } else {
      const discarded = await store.discardRecovery()
      if (!discarded.ok) return failure(discarded.error.message)
    }
    hasRecovery = false
    return undefined
  }

  async function handle(request: Request): Promise<Response> {
    switch (request.action) {
      case 'exportEditorSheet': {
        if (request.revision !== revision)
          return failure('План изменился. Обновите текущий лист перед сохранением PDF.')
        if (!current || !current.basis.pds.has(request.pd))
          return failure('Выберите ПД открытого плана.')
        if (hasRecovery) return failure('Сначала восстановите автокопию или откажитесь от неё.')
        if (!pdf) return failure('Экспорт PDF недоступен.')
        const result = await pdf.export(request.page)
        return result.ok ? { status: 'pdf', result: result.value } : failure(result.error.message)
      }
      case 'pdfBatchStart': {
        if (request.revision !== revision)
          return failure('План изменился. Обновите листы перед сохранением PDF.')
        if (!current) return failure('Сначала откройте или создайте план.')
        if (hasRecovery) return failure('Сначала восстановите автокопию или откажитесь от неё.')
        if (!batch) return failure('Экспорт PDF недоступен.')
        const plan = current
        const names: string[] = []
        for (const id of request.pds) {
          const pd = plan.basis.pds.get(id)
          if (!pd) return failure('Выберите ПД открытого плана.')
          names.push(pd.name)
        }
        const started = await batch.start(
          revision,
          request.mode,
          request.pds,
          names,
          names.length === 1 ? `${names[0]}.pdf` : `ПД ${plan.year}.pdf`,
        )
        if (!started.ok) return failure(started.error.message)
        return started.value === 'cancelled'
          ? { status: 'cancelled' }
          : { status: 'pdfBatch', ...started.value }
      }
      case 'pdfBatchAdd': {
        if (!batch) return failure('Экспорт PDF недоступен.')
        if (request.revision !== revision) {
          batch.cancel(request.job)
          return failure('План изменился во время сохранения PDF. Повторите сохранение.')
        }
        if (hasRecovery) {
          batch.cancel(request.job)
          return failure('Сначала восстановите автокопию или откажитесь от неё.')
        }
        const added = await batch.add(request.job, request.revision, request.pd, request.pages)
        return added.ok ? { status: 'pdfBatch', ...added.value } : failure(added.error.message)
      }
      case 'pdfBatchFinish': {
        if (!batch) return failure('Экспорт PDF недоступен.')
        if (request.revision !== revision) {
          batch.cancel(request.job)
          return failure('План изменился во время сохранения PDF. Повторите сохранение.')
        }
        const finished = await batch.finish(request.job, request.revision)
        return finished.ok ? { status: 'pdf', result: 'saved' } : failure(finished.error.message)
      }
      case 'pdfBatchCancel':
        batch?.cancel(request.job)
        return { status: 'cancelled' }
      case 'previewEditorSheets': {
        if (request.revision !== revision)
          return failure('План изменился. Обновите редактор для предпросмотра листа.')
        if (!current) return failure('Сначала откройте или создайте план.')
        if (hasRecovery) return failure('Сначала восстановите автокопию или откажитесь от неё.')
        const source = planSheetData(current, request.pd)
        if (!source.ok) return failure(source.error.message)
        const response = { status: 'editorSheets', revision, source: source.value }
        if (JSON.stringify(response).length > 20 * 1024 * 1024)
          return failure(
            'Срез листов ПД превышает 20 МиБ. Уменьшите число объектов или длину примечаний.',
          )
        return channels.planFile.response.parse(response)
      }
      case 'previewSheets': {
        if (request.open) {
          const path = await dialogs.open()
          if (!path) return { status: 'cancelled' }
          const loaded = await new FilePlanStore(path, appVersion).load()
          return loaded.ok ? sheetResponse(loaded.value) : failure(loaded.error.message)
        }
        return sheetResponse(current)
      }
      case 'editor':
        return handleEditor(request)
    }
  }

  registerHandler(ipc, channels.planFile, (request) =>
    enqueue(() => handle(request)).catch((error: unknown) =>
      failure(
        error instanceof PlanTextReadError
          ? error.message
          : 'Не удалось выполнить операцию с файлом плана.',
      ),
    ),
  )
  return async () => {
    await pending
    await stop()
  }
}
