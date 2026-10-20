import { channels, type RequestOf, type ResponseOf } from '@eow/ipc/contracts'
import {
  decodePlan,
  encodePlan,
  FilePlanStore,
  startPlanAutosave,
} from '@eow/planning/infrastructure'
import type { AnnualPlan } from '@eow/planning/domain'
import { importPrototype } from '@eow/import/infrastructure'
import { buildImportedPlan } from '@eow/planning/application'
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

  async function state(): Promise<Response> {
    const encoded = current ? encodePlan(current, appVersion) : undefined
    if (encoded && !encoded.ok) return failure(encoded.error.message)
    const recovery = store ? await store.recovery() : undefined
    if (recovery && !recovery.ok) return failure(recovery.error.message)
    const recovered =
      recovery?.ok && recovery.value ? encodePlan(recovery.value, appVersion) : undefined
    if (recovered && !recovered.ok) return failure(recovered.error.message)
    return {
      status: 'ok',
      document: encoded?.ok ? encoded.value : null,
      recovery: recovered?.ok ? recovered.value : null,
      autosaveError,
    }
  }

  async function handle(request: Request): Promise<Response> {
    switch (request.action) {
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
        current = imported.value
        store = undefined
        dirty = true
        autosaveError = null
        return state()
      }
      case 'open': {
        const path = await dialogs.open()
        if (!path) return { status: 'cancelled' }
        const selected = new FilePlanStore(path, appVersion)
        const loaded = await selected.load()
        if (!loaded.ok) return failure(loaded.error.message)
        store = selected
        current = loaded.value
        dirty = false
        autosaveError = null
        return state()
      }
      case 'save': {
        const plan = decodePlan(request.document)
        if (!plan.ok) return failure(plan.error.message)
        let selected = store
        if (!selected || request.saveAs) {
          const path = await dialogs.save()
          if (!path) return { status: 'cancelled' }
          selected = new FilePlanStore(path, appVersion)
        }
        const saved = await selected.save(plan.value)
        if (!saved.ok) return failure(saved.error.message)
        store = selected
        current = plan.value
        dirty = false
        autosaveError = null
        return state()
      }
      case 'update': {
        const plan = decodePlan(request.document)
        if (!plan.ok) return failure(plan.error.message)
        current = plan.value
        dirty = true
        return state()
      }
      case 'state':
        return state()
      case 'recover': {
        if (!store) return failure('Сначала откройте файл плана.')
        if (request.accept) {
          const recovery = await store.recovery()
          if (!recovery.ok) return failure(recovery.error.message)
          if (recovery.value) {
            current = recovery.value
            dirty = true
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
