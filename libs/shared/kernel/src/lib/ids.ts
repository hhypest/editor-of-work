/** Брендированный тип: строки-идентификаторы разных сущностей не смешиваются. */
export type Brand<T, B extends string> = T & { readonly __brand: B }

/**
 * Источник новых идентификаторов. Домен и сценарии не создают их сами:
 * в программе это случайные UUID, в тестах — предсказуемая последовательность.
 */
export interface IdGenerator {
  next(): string
}

/** Генератор для тестов и примеров: «prefix-1», «prefix-2», … */
export function sequentialIds(prefix: string): IdGenerator {
  let n = 0
  return {
    next: () => {
      n += 1
      return `${prefix}-${n}`
    },
  }
}
