import { compareChainage, formatPlus, type Chainage } from '@eow/shared/kernel'

/** Технический предел обхода км одной строки, а не норматив длины направления. */
export const MAX_LENGTH_CHECK_KM = 100_000

export function lengthCheckProblem(row: {
  readonly from: Chainage
  readonly to: Chainage
}): string | undefined {
  if (
    [row.from, row.to].some(
      (p) => !Number.isSafeInteger(p.km) || !Number.isSafeInteger(p.m) || p.km < 0 || p.m < 0,
    )
  )
    return 'Километр и метр должны быть целыми неотрицательными числами в допустимом диапазоне.'
  if (compareChainage(row.from, row.to) >= 0) return 'Конец отрезка должен быть дальше начала.'
  if (row.to.km - row.from.km > MAX_LENGTH_CHECK_KM)
    return `Отрезок ${formatPlus(row.from)} – ${formatPlus(row.to)} превышает технический предел сверки ${MAX_LENGTH_CHECK_KM} км. Проверьте координаты в исходных данных.`
  return undefined
}
