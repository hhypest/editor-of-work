import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { channels, type RequestOf, type ResponseOf } from '@eow/ipc/contracts'
import type { ManualDataTemplate, ManualTemplatePreview } from '@eow/import/application'
import { exportManualTemplate, prepareManualTemplate } from '@eow/import/infrastructure'
import type { PassportStore } from '@eow/passport/application'
import type { PassportManualData } from '@eow/passport/import-api'
import { registerHandler, type IpcMainLike } from './register'

export interface ManualTemplateDialogs {
  open(): Promise<string | undefined>
  save(): Promise<string | undefined>
}

async function saveTemplate(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx')
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

type Outcome = ResponseOf<typeof channels.manualTemplate>
const failure = (message: string): Outcome => ({ status: 'error', message })

/** В renderer уходят только итоги; команда и выбранные пути остаются в main. */
export function registerManualTemplateHandlers(
  ipc: IpcMainLike,
  store: PassportStore & PassportManualData,
  template: ManualDataTemplate,
  dialogs: ManualTemplateDialogs,
  now: () => Date = () => new Date(),
): void {
  let pending:
    | {
        token: string
        editionId: number
        expires: number
        preview: ManualTemplatePreview
      }
    | undefined
  let busy = false
  async function draftError(id: number): Promise<string | undefined> {
    const editions = await store.list()
    if (!editions.ok) return editions.error.message
    const edition = editions.value.find((e) => e.id === id)
    if (!edition) return 'Редакция паспорта не найдена.'
    return edition.status === 'draft' ? undefined : 'Загрузка доступна только в черновике.'
  }
  async function run(request: RequestOf<typeof channels.manualTemplate>): Promise<Outcome> {
    if (request.action === 'discard') {
      if (pending?.token === request.token && pending.editionId === request.editionId)
        pending = undefined
      return { status: 'discarded' }
    }
    if (request.action === 'apply') {
      const prepared = pending
      if (!prepared || prepared.token !== request.token || prepared.editionId !== request.editionId)
        return failure('Предпросмотр недействителен. Загрузите книгу заново.')
      pending = undefined
      if (prepared.expires <= now().getTime())
        return failure('Время подтверждения истекло. Загрузите книгу заново.')
      const error = await draftError(request.editionId)
      if (error) return failure(error)
      const saved = await store.applyManualData(request.editionId, prepared.preview.command)
      return saved.ok ? { status: 'applied' } : failure(saved.error.message)
    }
    if (request.action === 'export') {
      const path = await dialogs.save()
      if (!path) return { status: 'cancelled' }
      const result = await exportManualTemplate(store, template, request.editionId)
      if (!result.ok) return failure(result.error.message)
      await saveTemplate(path, result.value)
      return { status: 'exported' }
    }
    pending = undefined
    const error = await draftError(request.editionId)
    if (error) return failure(error)
    const path = await dialogs.open()
    if (!path) return { status: 'cancelled' }
    const basis = await store.manualBasis(request.editionId)
    if (!basis.ok) return failure(basis.error.message)
    const preview = await prepareManualTemplate(
      template,
      basis.value,
      { name: basename(path), bytes: await readFile(path) },
      now().toISOString(),
    )
    if (!preview.ok) return failure(preview.error.message)
    const currentError = await draftError(request.editionId)
    if (currentError) return failure(currentError)
    const token = randomUUID()
    pending = {
      token,
      editionId: request.editionId,
      expires: now().getTime() + 10 * 60 * 1000,
      preview: preview.value,
    }
    return {
      status: 'preview',
      review: {
        token,
        editionId: request.editionId,
        fileName: basename(path),
        changes: [...preview.value.changes],
      },
    }
  }
  registerHandler(ipc, channels.manualTemplate, async (request) => {
    if (busy) return failure('Дождитесь завершения операции с шаблоном.')
    busy = true
    try {
      return await run(request)
    } catch {
      return failure(
        'Не удалось обработать шаблон. Проверьте файл и доступ к папке; повторите загрузку.',
      )
    } finally {
      busy = false
    }
  })
}
