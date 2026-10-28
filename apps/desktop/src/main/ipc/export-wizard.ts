import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { channels, type RequestOf, type ResponseOf } from '@eow/ipc/contracts'
import {
  prepareOrgImport,
  subdivisionChoices,
  describeLocation,
  type ExportFile,
  type ExportProgress,
  type OrgSources,
  type OrgSourceFile,
  type ExportGroup,
} from '@eow/import/application'
import {
  readOrgExports,
  prepareSegmentExports,
  prepareStationExports,
} from '@eow/import/infrastructure'
import type { PassportStore, PassportEditionData, EditionData } from '@eow/passport/application'
import { editionDataToken } from '@eow/passport/infrastructure'
import type {
  PassportOrgImport,
  PassportSegmentImport,
  PassportStationImport,
  OrgImport,
  SegmentImport,
  StationImport,
  OrgImportRemark,
} from '@eow/passport/import-api'
import { registerHandler, type IpcMainLike } from './register'
import { selectedExportFile, ExportReadBudget, ExportReadLimitError } from './export-files'

export interface ExportWizardDialogs {
  open(group: ExportGroup): Promise<readonly string[] | undefined>
}
type Store = PassportStore &
  PassportEditionData &
  PassportOrgImport &
  PassportSegmentImport &
  PassportStationImport
type Outcome = ResponseOf<typeof channels.exportWizard>
type Command =
  | { group: 'org'; data: OrgImport }
  | { group: 'segments'; data: SegmentImport }
  | { group: 'stations'; data: StationImport }
interface Session {
  readonly token: string
  readonly editionId: number
  readonly expires: number
  readonly before: EditionData
  readonly snapshot: string
  readonly org?: { readonly sources: OrgSources; readonly files: readonly OrgSourceFile[] }
  readonly command?: Command
}
const failure = (message: string): Outcome => ({ status: 'error', message })
/** Остановка по запросу пользователя: подготовка прерывается до записи, сеанс не создаётся. */
class ImportCancelled extends Error {}
/** Отдать очередь событий: между файлами main отвечает на запросы хода и остановки. */
const yieldToIpc = (): Promise<void> => new Promise((done) => setImmediate(done))
const remarkText = (r: OrgImportRemark): string =>
  r.at
    ? `${describeLocation({
        file: r.at.file,
        sheet: r.at.sheet,
        ...(r.at.row === undefined ? {} : { row: r.at.row }),
        ...(r.at.column === undefined ? {} : { column: r.at.column }),
        ...(r.at.header === undefined ? {} : { header: r.at.header }),
      })}: ${r.text}`
    : r.text
const orgRows = (data: EditionData['org']): number =>
  data.subdivisions.length + data.boundaries.length + data.stations.length + data.tracks.length

export function registerExportWizardHandlers(
  ipc: IpcMainLike,
  store: Store,
  dialogs: ExportWizardDialogs,
  now: () => Date = () => new Date(),
): void {
  let pending: Session | undefined
  let busy = false
  /**
   * Сверка с паспортом идёт без передышек: запрос остановки, пришедший во время неё, ждёт
   * в очереди. Перед созданием сеанса main отдаёт очередь и только потом проверяет остановку.
   */
  async function stopIfRequested(): Promise<void> {
    await yieldToIpc()
    if (cancelling) throw new ImportCancelled()
  }
  let progress: Omit<ExportProgress, 'cancelling'> | undefined
  let cancelling = false
  /** Шаг этапа чтения или разбора: ход, точка остановки и передышка для IPC. */
  const stage =
    (name: 'reading' | 'parsing') =>
    async (done: number, total: number, file: string): Promise<void> => {
      if (cancelling) throw new ImportCancelled()
      progress =
        name === 'parsing' && done === total
          ? { stage: 'checking', done: 0, total: 0, file: null, cancellable: true }
          : { stage: name, done, total, file, cancellable: true }
      await yieldToIpc()
      if (cancelling) throw new ImportCancelled()
    }
  function preview(
    session: Session,
    command: Command,
    remarks: readonly OrgImportRemark[],
    candidates: readonly string[] = [],
  ): Outcome {
    pending = { ...session, command }
    const previousRows =
      command.group === 'org'
        ? orgRows(session.before.org)
        : command.group === 'segments'
          ? session.before.segments.filter((r) => command.data.files.some((f) => f.form === r.form))
              .length
          : session.before.stations.length
    return {
      status: 'preview',
      review: {
        token: session.token,
        editionId: session.editionId,
        group: command.group,
        files: command.data.files.map((f) => ({ name: f.name, form: f.form, rows: f.rowCount })),
        previousRows,
        incomingRows: command.group === 'org' ? orgRows(command.data) : command.data.rows.length,
        remarks: remarks.map(remarkText),
        exclusionCandidates: [...candidates],
      },
    }
  }
  async function run(
    request: Exclude<RequestOf<typeof channels.exportWizard>, { action: 'progress' | 'cancel' }>,
  ): Promise<Outcome> {
    if (request.action === 'discard') {
      if (pending?.token === request.token && pending.editionId === request.editionId)
        pending = undefined
      return { status: 'discarded' }
    }
    if (request.action !== 'choose') {
      const session = pending
      if (!session || session.token !== request.token || session.editionId !== request.editionId)
        return failure('Предпросмотр недействителен. Выберите файлы заново.')
      if (session.expires <= now().getTime()) {
        pending = undefined
        return failure('Время подтверждения истекло. Выберите файлы заново.')
      }
      if (request.action === 'review') {
        if (!session.org || session.command)
          return failure('Выбор подразделений уже завершён. Выберите файлы заново.')
        if (!request.selected.length) return failure('Отметьте действующие ПЧУ и ПД.')
        const command = prepareOrgImport(
          session.org.sources,
          session.org.files,
          session.before.edition.date,
          new Set(request.selected),
        )
        return command.ok
          ? preview(
              session,
              { group: 'org', data: { ...command.value, expectedEditionToken: session.snapshot } },
              command.value.files.flatMap((f) => f.warnings),
            )
          : failure(command.error.message)
      }
      if (!session.command)
        return failure('Сначала подтвердите выбор подразделений и просмотрите отчёт.')
      pending = undefined
      const command = session.command
      progress = { stage: 'saving', done: 0, total: 0, file: null, cancellable: false }
      const saved =
        command.group === 'org'
          ? await store.applyOrgImport(request.editionId, command.data)
          : command.group === 'segments'
            ? await store.applySegmentImport(request.editionId, command.data)
            : await store.applyStationImport(request.editionId, command.data)
      return saved.ok ? { status: 'applied' } : failure(saved.error.message)
    }
    pending = undefined
    const data = await store.editionData(request.editionId)
    if (!data.ok) return failure(data.error.message)
    if (data.value.edition.status !== 'draft')
      return failure('Импорт разрешён только в черновик редакции.')
    const paths = await dialogs.open(request.group)
    if (!paths?.length) return { status: 'cancelled' }
    if (paths.length > 1000) return failure('За один шаг выберите не более 1000 частей выгрузок.')
    const files: ExportFile[] = []
    const budget = new ExportReadBudget()
    const reading = stage('reading'),
      parsing = stage('parsing')
    for (const [index, path] of paths.entries()) {
      await reading(index, paths.length, basename(path))
      files.push(await selectedExportFile(path, budget))
    }
    const session: Session = {
      token: randomUUID(),
      editionId: request.editionId,
      expires: now().getTime() + 10 * 60 * 1000,
      before: data.value,
      snapshot: editionDataToken(data.value),
    }
    const importedAt = now().toISOString()
    if (request.group === 'org') {
      const org = await readOrgExports(files, importedAt, parsing)
      await stopIfRequested()
      if (!org.ok) return failure(org.error.message)
      // Проверка комплектности и неоднозначных кодов до выбора действующих.
      const valid = prepareOrgImport(
        org.value.sources,
        org.value.files,
        data.value.edition.date,
        new Set(),
      )
      if (!valid.ok) return failure(valid.error.message)
      pending = { ...session, org: org.value }
      return {
        status: 'choices',
        token: session.token,
        editionId: request.editionId,
        choices: subdivisionChoices(
          org.value.sources.subdivisions,
          org.value.sources.boundaries,
          data.value.edition.date,
        ).map((c) => ({ ...c, overlapsWith: [...c.overlapsWith] })),
      }
    }
    const input = { editionId: request.editionId, files, importedAt, step: parsing }
    if (request.group === 'segments') {
      const prepared = await prepareSegmentExports(store, input)
      await stopIfRequested()
      return prepared.ok
        ? preview(
            session,
            {
              group: 'segments',
              data: { ...prepared.value.command, expectedEditionToken: session.snapshot },
            },
            prepared.value.remarks,
          )
        : failure(prepared.error.message)
    }
    const prepared = await prepareStationExports(store, input)
    await stopIfRequested()
    return prepared.ok
      ? preview(
          session,
          {
            group: 'stations',
            data: { ...prepared.value.command, expectedEditionToken: session.snapshot },
          },
          prepared.value.remarks,
          prepared.value.exclusionCandidates,
        )
      : failure(prepared.error.message)
  }
  registerHandler(ipc, channels.exportWizard, async (request): Promise<Outcome> => {
    // Ход и остановка отвечают и во время операции: это не новая операция.
    if (request.action === 'progress')
      return busy && progress
        ? { status: 'progress', progress: { ...progress, cancelling } }
        : { status: 'idle' }
    if (request.action === 'cancel') {
      if (!busy || !progress?.cancellable) return { status: 'idle' }
      cancelling = true
      return { status: 'progress', progress: { ...progress, cancelling } }
    }
    if (busy) return failure('Дождитесь завершения операции импорта.')
    busy = true
    cancelling = false
    progress = undefined
    try {
      return await run(request)
    } catch (error) {
      pending = undefined
      if (error instanceof ImportCancelled) return { status: 'cancelled' }
      if (error instanceof ExportReadLimitError) return failure(error.message)
      return failure(
        'Не удалось прочитать или записать выгрузки. Проверьте доступ к файлам и подготовьте импорт заново.',
      )
    } finally {
      busy = false
      cancelling = false
      progress = undefined
    }
  })
}
