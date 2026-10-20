import type { z } from 'zod';

/**
 * Канал IPC «запрос — ответ» (ipcRenderer.invoke / ipcMain.handle).
 * Имя канала и схемы zod объявляются один раз здесь и используются
 * и в main (проверка), и в preload (проброс), и в renderer (типы).
 */
export interface Channel<Name extends string, Req extends z.ZodType, Res extends z.ZodType> {
  readonly name: Name;
  readonly request: Req;
  readonly response: Res;
}

export function defineChannel<Name extends string, Req extends z.ZodType, Res extends z.ZodType>(
  name: Name,
  request: Req,
  response: Res,
): Channel<Name, Req, Res> {
  return { name, request, response };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- обобщённый канал для отображений типов
export type AnyChannel = Channel<string, any, any>;

export type RequestOf<C extends AnyChannel> = z.input<C['request']>;
export type ResponseOf<C extends AnyChannel> = z.output<C['response']>;
