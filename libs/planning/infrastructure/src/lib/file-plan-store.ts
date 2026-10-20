import { open, readFile, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { AnnualPlan } from '@eow/planning/domain'
import type { PlanStore, PlanStoreError } from '@eow/planning/application'
import { err, ok, type Result } from '@eow/shared/kernel'
import { decodePlan, encodePlan } from './plan-file'

export interface PlanFileIO {
  read(path: string): Promise<string | undefined>
  write(path: string, text: string): Promise<void>
  replace(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  modified(path: string): Promise<number | undefined>
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export const nodePlanFileIO: PlanFileIO = {
  async read(path) {
    try {
      return await readFile(path, 'utf8')
    } catch (e) {
      if (missing(e)) return undefined
      throw e
    }
  },
  async write(path, text) {
    const file = await open(path, 'wx')
    try {
      await file.writeFile(text, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
  },
  replace: rename,
  async remove(path) {
    await rm(path, { force: true })
  },
  async modified(path) {
    try {
      return (await stat(path)).mtimeMs
    } catch (e) {
      if (missing(e)) return undefined
      throw e
    }
  },
}

/**
 * Только main: путь приходит от системного диалога, а не от renderer.
 * Операции одного файла последовательны, чтобы таймер не столкнулся с ручной записью.
 */
export class FilePlanStore implements PlanStore {
  private pending: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly appVersion: string,
    private readonly io: PlanFileIO = nodePlanFileIO,
  ) {}

  private run<T>(
    action: () => Promise<Result<T, PlanStoreError>>,
  ): Promise<Result<T, PlanStoreError>> {
    const next = this.pending.then(action).catch((): Result<T, PlanStoreError> =>
      err({
        kind: 'io',
        message:
          'Не удалось прочитать или записать файл плана. Проверьте доступ к папке и свободное место.',
      }),
    )
    this.pending = next
    return next
  }

  private async atomicWrite(path: string, text: string): Promise<void> {
    const temp = `${path}.${randomUUID()}.tmp`
    try {
      await this.io.write(temp, text)
      // Временный файл рядом с целевым: переименование в пределах одного тома.
      await this.io.replace(temp, path)
    } finally {
      await this.io.remove(temp)
    }
  }

  load(): Promise<Result<AnnualPlan, PlanStoreError>> {
    return this.run(async () => {
      const text = await this.io.read(this.path)
      return text === undefined
        ? err({ kind: 'io', message: 'Файл плана не найден.' })
        : decodePlan(text)
    })
  }

  save(plan: AnnualPlan): Promise<Result<void, PlanStoreError>> {
    // Снимок берётся при вызове, до ожидания очереди.
    const encoded = encodePlan(plan, this.appVersion)
    return this.run(async () => {
      if (!encoded.ok) return encoded
      const previous = await this.io.read(this.path)
      if (previous !== undefined) {
        const checked = decodePlan(previous)
        if (!checked.ok) return checked
        for (let n = 5; n >= 2; n--) {
          const older = await this.io.read(this.backup(n - 1))
          if (older !== undefined) await this.atomicWrite(this.backup(n), older)
        }
        await this.atomicWrite(this.backup(1), previous)
      }
      await this.atomicWrite(this.path, encoded.value)
      await this.io.remove(`${this.path}.autosave`)
      return ok(undefined)
    })
  }

  private backup(n: number): string {
    return n === 1 ? `${this.path}.bak` : `${this.path}.${n}.bak`
  }

  autosave(plan: AnnualPlan): Promise<Result<void, PlanStoreError>> {
    const encoded = encodePlan(plan, this.appVersion)
    return this.run(async () => {
      if (!encoded.ok) return encoded
      // Даже автосохранение не должно затрагивать документ более новой версии.
      const previous = await this.io.read(this.path)
      if (previous !== undefined) {
        const checked = decodePlan(previous)
        if (!checked.ok) return checked
        const saved = encodePlan(checked.value, this.appVersion)
        if (saved.ok && saved.value === encoded.value) {
          await this.io.remove(`${this.path}.autosave`)
          return ok(undefined)
        }
      }
      await this.atomicWrite(`${this.path}.autosave`, encoded.value)
      return ok(undefined)
    })
  }

  recovery(): Promise<Result<AnnualPlan | undefined, PlanStoreError>> {
    return this.run(async () => {
      const path = `${this.path}.autosave`
      const text = await this.io.read(path)
      if (text === undefined) return ok(undefined)
      const originalTime = await this.io.modified(this.path)
      const autosaveTime = await this.io.modified(path)
      if (originalTime !== undefined && autosaveTime !== undefined && originalTime > autosaveTime)
        return ok(undefined)
      return decodePlan(text)
    })
  }

  discardRecovery(): Promise<Result<void, PlanStoreError>> {
    return this.run(async () => {
      await this.io.remove(`${this.path}.autosave`)
      return ok(undefined)
    })
  }
}
