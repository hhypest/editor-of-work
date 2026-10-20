import type { AnyChannel, ResponseOf } from '@eow/ipc/contracts'
import type { z } from 'zod'

/** Узкий интерфейс ipcMain: достаточно для регистрации и для подмены в тестах. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
}

export type Handler<C extends AnyChannel> = (
  request: z.output<C['request']>,
) => Promise<ResponseOf<C>> | ResponseOf<C>

/** Ошибка проверки запроса или ответа канала. Текст не раскрывает данные запроса. */
export class IpcValidationError extends Error {
  constructor(channel: string, part: 'запрос' | 'ответ', issues: string) {
    super(`IPC ${channel}: неверный ${part} — ${issues}`)
    this.name = 'IpcValidationError'
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`).join('; ')
}

/**
 * Регистрирует обработчик канала: проверяет запрос схемой zod до вызова
 * обработчика и ответ — после. Лишние аргументы отклоняются.
 */
export function registerHandler<C extends AnyChannel>(
  ipc: IpcMainLike,
  channel: C,
  handler: Handler<C>,
): void {
  ipc.handle(channel.name, async (_event, ...args) => {
    if (args.length !== 1) {
      throw new IpcValidationError(
        channel.name,
        'запрос',
        `ожидался один аргумент, получено ${args.length}`,
      )
    }
    const request = channel.request.safeParse(args[0])
    if (!request.success)
      throw new IpcValidationError(channel.name, 'запрос', describeIssues(request.error))
    const result = await handler(request.data)
    const response = channel.response.safeParse(result)
    if (!response.success)
      throw new IpcValidationError(channel.name, 'ответ', describeIssues(response.error))
    return response.data as ResponseOf<C>
  })
}
