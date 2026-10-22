import { channels, planDocumentSchema, type RequestOf, type ResponseOf } from '@eow/ipc/contracts'
import {
  decodePlan,
  encodePlan,
  FilePlanStore,
  startPlanAutosave,
} from '@eow/planning/infrastructure'
import type { AnnualPlan } from '@eow/planning/domain'
import { importPrototype } from '@eow/import/infrastructure'
import { planSheetData, buildImportedPlan } from '@eow/planning/application'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { registerHandler, type IpcMainLike } from './register'

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
): () => Promise<void> {
  let store: FilePlanStore | undefined
  let current: AnnualPlan | undefined
  let dirty = false
  let autosaveError: string | null = null
  let pending: Promise<unknown> = Promise.resolve()
  const stop = startPlanAutosave(
    {
      autosave: async (plan) => {
        const result = store
          ? await store.autosave(plan)
          : ({ ok: true, value: undefined } as const)
        if (result.ok) autosaveError = null
        return result
      },
    },
    () => (dirty ? current : undefined),
    (error) => {
      autosaveError = error.message
    },
  )

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
  ): Promise<Response> {
    const response = await responseFor(plan, selected, error)
    if (response.status !== 'ok') return response
    current = plan
    store = selected
    dirty = changed
    autosaveError = error
    return response
  }

  async function handle(request: Request): Promise<Response> {
    switch (request.action) {
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
        const parsed = importPrototype(await readFile(path, 'utf8'), {
          edition: request.edition,
          ids: { next: randomUUID },
          ...(request.catalog === undefined ? {} : { catalog: request.catalog }),
        })
        if (!parsed.ok)
          return failure(parsed.error.map((e) => `${e.path}: ${e.message}`).join('; '))
        const imported = buildImportedPlan(parsed.value)
        if (!imported.ok)
          return failure(imported.error.map((e) => `${e.path}: ${e.message}`).join('; '))
        return replaceCurrent(imported.value, undefined, true, null)
      }
      case 'open': {
        const path = await dialogs.open()
        if (!path) return { status: 'cancelled' }
        const selected = new FilePlanStore(path, appVersion)
        const loaded = await selected.load()
        if (!loaded.ok) return failure(loaded.error.message)
        return replaceCurrent(loaded.value, selected, false, null)
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
            return replaceCurrent(recovery.value, store, true)
          }
          // Автокопия остаётся до явного сохранения восстановленного документа.
        } else {
          const discarded = await store.discardRecovery()
          if (!discarded.ok) return failure(discarded.error.message)
        }
        return state()
      }
    }
  }

  registerHandler(ipc, channels.planFile, (request) => {
    const next = pending
      .then(() => handle(request))
      .catch(() => failure('Не удалось выполнить операцию с файлом плана.'))
    pending = next
    return next
  })
  return async () => {
    await pending
    await stop()
  }
}
