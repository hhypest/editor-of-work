/** Сколько шагов отмены хранится (docs/architecture.md, раздел 7). */
export const HISTORY_LIMIT = 200

/**
 * История неизменяемого состояния для отмены и повтора. Снимки делят общие структуры:
 * сценарий меняет только затронутые объекты, остальные переходят в новую версию как есть.
 * Состояние — объект: так «нет снимка» не спутать со значением undefined.
 */
export interface History<T extends object> {
  readonly past: readonly T[]
  readonly present: T
  readonly future: readonly T[]
  /**
   * Открытая группа правок. Пока следующие правки приходят с тем же ключом
   * (перетаскивание мышью, набор текста в одном поле), они сливаются в один шаг.
   */
  readonly group: string | undefined
}

export function historyOf<T extends object>(present: T): History<T> {
  return { past: [], present, future: [], group: undefined }
}

export interface CommitOptions {
  /** Ключ группы: правки с одним ключом подряд отменяются одним шагом. */
  readonly group?: string
}

/** Новая версия состояния. Повтор после неё сбрасывается; правка без изменений — не шаг. */
export function commit<T extends object>(
  h: History<T>,
  next: T,
  options: CommitOptions = {},
): History<T> {
  if (Object.is(next, h.present)) return h
  const group = options.group
  if (group !== undefined && group === h.group) {
    return { past: h.past, present: next, future: [], group }
  }
  const past = [...h.past, h.present].slice(-HISTORY_LIMIT)
  return { past, present: next, future: [], group }
}

/** Закрыть группу: следующая правка с тем же ключом станет новым шагом. */
export function endGroup<T extends object>(h: History<T>): History<T> {
  return h.group === undefined ? h : { ...h, group: undefined }
}

export function canUndo<T extends object>(h: History<T>): boolean {
  return h.past.length > 0
}

export function canRedo<T extends object>(h: History<T>): boolean {
  return h.future.length > 0
}

export function undo<T extends object>(h: History<T>): History<T> {
  const previous = h.past.at(-1)
  if (previous === undefined) return h
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    group: undefined,
  }
}

export function redo<T extends object>(h: History<T>): History<T> {
  const [next, ...rest] = h.future
  if (next === undefined) return h
  return { past: [...h.past, h.present], present: next, future: rest, group: undefined }
}
