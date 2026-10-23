import { channels, planDocumentSchema, type RequestOf, type ResponseOf } from '@eow/ipc/contracts'
import {
  decodePlan,
  readPlanText,
  PlanTextReadError,
  encodePlan,
  FilePlanStore,
  startPlanAutosave,
} from '@eow/planning/infrastructure'
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
): () => Promise<void> {
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

  async function responseFor(
    plan: AnnualPlan | undefined,
    selected: FilePlanStore | undefined,
    error: string | null,
  ): Promise<Response> {
    const encoded = plan ? encodeDocument(plan) : undefined
    if (encoded && !encoded.ok) return failure(encoded.error.message)
    const recovery = selected ? await selected.recovery() : undefined
    if (recovery && !recovery.ok) return failure(recovery.error.message)
    const recovered = recovery?.ok && recovery.value ? encodeDocument(recovery.value) : undefined
    if (recovered && !recovered.ok) return failure(recovered.error.message)
    return {
      status: 'ok',
      document: encoded?.ok ? encoded.value : null,
      recovery: recovered?.ok ? recovered.value : null,
      autosaveError: error,
    }
  }

  function state(): Promise<Response> {
    return responseFor(current, store, autosaveError)
  }

  /** Ошибка подготовки ответа оставляет прежние документ, путь и признак правок. */
  async function replaceCurrent(
    plan: AnnualPlan,
    selected: FilePlanStore | undefined,
    changed: boolean,
    error = autosaveError,
    editorArea?: string,
  ): Promise<Response> {
    const candidate = openPlanSession(plan)
    if (editorArea !== undefined) {
      const prepared = editorResponse(candidate, editorArea, revision + 1, changed)
      if (prepared.status !== 'editor') return prepared
    }
    const response = await responseFor(plan, selected, error)
    if (response.status !== 'ok') return response
    current = plan
    history = candidate
    revision++
    if (!changed) savedPlan = plan
    else if (selected !== store) savedPlan = undefined
    hasRecovery = response.recovery !== null
    store = selected
    dirty = changed
    autosaveError = error
    return response
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
      const response = await replaceCurrent(plan.value, undefined, true, null, 'district')
      return response.status === 'ok' ? editorResponse(history, 'district') : response
    }
    if (command.kind === 'open' || command.kind === 'import' || command.kind === 'recover') {
      const operation: Request =
        command.kind === 'open'
          ? { action: 'open' }
          : command.kind === 'import'
            ? { action: 'importPrototype', edition: command.edition }
            : { action: 'recover', accept: command.accept }
      const response = await handle(operation, 'district')
      if (response.status !== 'ok') return response
      hasRecovery = command.kind === 'recover' ? false : response.recovery !== null
      return editorResponse(history, 'district')
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

  async function handle(request: Request, editorArea?: string): Promise<Response> {
    switch (request.action) {
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
      case 'importPrototype': {
        const path = await dialogs.openPrototype()
        if (!path) return { status: 'cancelled' }
        const source = await readPlanText(path)
        if (source === undefined) return failure('Файл проекта прототипа не найден.')
        const parsed = importPrototype(source, {
          edition: request.edition,
          ids: { next: randomUUID },
          ...(request.catalog === undefined ? {} : { catalog: request.catalog }),
        })
        if (!parsed.ok)
          return failure(parsed.error.map((e) => `${e.path}: ${e.message}`).join('; '))
        const imported = buildImportedPlan(parsed.value)
        if (!imported.ok)
          return failure(imported.error.map((e) => `${e.path}: ${e.message}`).join('; '))
        return replaceCurrent(imported.value, undefined, true, null, editorArea)
      }
      case 'open': {
        const path = await dialogs.open()
        if (!path) return { status: 'cancelled' }
        const selected = new FilePlanStore(path, appVersion)
        const loaded = await selected.load()
        if (!loaded.ok) return failure(loaded.error.message)
        return replaceCurrent(loaded.value, selected, false, null, editorArea)
      }
      case 'save': {
        const plan = decodePlan(request.document)
        if (!plan.ok) return failure(plan.error.message)
        const encoded = encodeDocument(plan.value)
        if (!encoded.ok) return failure(encoded.error.message)
        let selected = store
        if (!selected || request.saveAs) {
          const path = await dialogs.save()
          if (!path) return { status: 'cancelled' }
          selected = new FilePlanStore(path, appVersion)
        }
        const saved = await selected.save(plan.value)
        if (!saved.ok) return failure(saved.error.message)
        return replaceCurrent(plan.value, selected, false, null)
      }
      case 'update': {
        const plan = decodePlan(request.document)
        if (!plan.ok) return failure(plan.error.message)
        return replaceCurrent(plan.value, store, true)
      }
      case 'state':
        return state()
      case 'recover': {
        if (!store) return failure('Сначала откройте файл плана.')
        if (request.accept) {
          const recovery = await store.recovery()
          if (!recovery.ok) return failure(recovery.error.message)
          if (recovery.value) {
            const response = await replaceCurrent(
              recovery.value,
              store,
              true,
              autosaveError,
              editorArea,
            )
            if (response.status === 'ok') hasRecovery = false
            return response
          }
          // Автокопия остаётся до явного сохранения восстановленного документа.
        } else {
          const discarded = await store.discardRecovery()
          if (!discarded.ok) return failure(discarded.error.message)
        }
        hasRecovery = false
        return state()
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
